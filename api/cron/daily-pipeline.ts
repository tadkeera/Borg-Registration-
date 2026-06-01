import { createClient } from '@supabase/supabase-js';

// Yemen (UTC+3) Time offset helper
function getYemenTomorrowStr(): string {
  const utcNow = new Date().getTime();
  const yemenOffset = 3 * 60 * 60 * 1000;
  const yemenTomorrow = new Date(utcNow + yemenOffset + (24 * 60 * 60 * 1000));
  return yemenTomorrow.toISOString().split('T')[0];
}

export default async function handler(req: any, res: any) {
  // Support both GET (Vercel Cron standard) and POST triggers
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Guard with Vercel Cron Secret in production
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // 0. Load Active WhatsApp settings
    const { data: wsData } = await supabase
      .from('whatsapp_settings')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    let dailyRemindersEnabled = true;
    if (wsData && 'daily_reminders_enabled' in wsData) {
      dailyRemindersEnabled = !!wsData.daily_reminders_enabled;
    }

    console.log(`[Daily Pipeline Log] Checked setting. WhatsApp output enabled: ${dailyRemindersEnabled}`);

    const resultsSummary: any = {};

    // -------------------------------------------------------------------------
    // PHASE 1: Auto-Cancellation (The 48-Hour / 2-Day Expiry)
    // -------------------------------------------------------------------------
    const threshold48 = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    console.log(`[Daily Pipeline Phase 1] Sweeping outstanding pending bookings before: ${threshold48}`);

    const { data: expiredList, error: expiredErr } = await supabase
      .from('bookings')
      .select('id, patient_name, status, payment_status')
      .lte('created_at', threshold48);

    if (expiredErr) throw expiredErr;

    const toCancel = (expiredList || []).filter(b => b.status === 'pending' || b.payment_status === 'pending');
    let cancelledCount = 0;

    for (const b of toCancel) {
      const { error: cancelErr } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', payment_status: 'cancelled' })
        .eq('id', b.id);
      if (!cancelErr) {
        cancelledCount++;
      }
    }

    resultsSummary.cancelled = {
      totalFound: toCancel.length,
      successfullyCancelled: cancelledCount
    };

    // -------------------------------------------------------------------------
    // AUXILIARY HUGGING FACE DISPATCH SENDER
    // -------------------------------------------------------------------------
    const hfUrl = 'https://waleedoo-borg-whatsapp-server-1.hf.space/api/send-message';
    const sendHFMessage = async (phone: string, text: string) => {
      try {
        const response = await fetch(hfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, message: text })
        });
        return { phone, ok: response.ok, status: response.status };
      } catch (err: any) {
        return { phone, ok: false, error: err.message };
      }
    };

    // -------------------------------------------------------------------------
    // PHASE 2: Pending Grace Reminder (The 24-Hour Alert after Booking)
    // -------------------------------------------------------------------------
    const threshold24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: graceList, error: graceErr } = await supabase
      .from('bookings')
      .select('id, patient_name, patient_phone, status, payment_status')
      .lte('created_at', threshold24)
      .gt('created_at', threshold48);

    if (graceErr) throw graceErr;

    const toRemindGrace = (graceList || []).filter(b => b.status === 'pending' || b.payment_status === 'pending');
    let graceSentCount = 0;

    if (dailyRemindersEnabled && toRemindGrace.length > 0) {
      const graceMessage = `⏳ *تذكير هام بشأن حجزكم المعلق:*\n\nعزيزنا المريض، نفيدكم علماً بأنه متبقي *يوم واحد فقط (24 ساعة)* لتأكيد حجزكم ودفع رسوم التسجيل المقررة عبر الحسابات الرسمية للمستشفى.\n\nيرجى التكرم بإتمام عملية السداد لتفادي إلغاء الحجز تلقائياً بنهاية اليوم وإتاحة المقعد لمرضى آخرين.\n\n*إدارة مستشفى برج الاطباء *`;

      const promises = toRemindGrace.map(b => sendHFMessage(b.patient_phone, graceMessage));
      const results = await Promise.allSettled(promises);

      for (let i = 0; i < results.length; i++) {
        const resVal = results[i];
        if (resVal.status === 'fulfilled' && resVal.value.ok) {
          graceSentCount++;
          // Log inside whatsapp_logs for full transparency
          try {
            await supabase.from('whatsapp_logs').insert([{
              phone: toRemindGrace[i].patient_phone,
              direction: 'out',
              message: graceMessage
            }]);
          } catch (_) {}
        }
      }
    }

    resultsSummary.graceReminders = {
      totalEligible: toRemindGrace.length,
      successfullyDispatched: graceSentCount,
      skippedDueToConfig: !dailyRemindersEnabled
    };

    // -------------------------------------------------------------------------
    // PHASE 3: Confirmed Medical Reminder (24 Hours Before Appointment)
    // -------------------------------------------------------------------------
    const tomorrowStr = getYemenTomorrowStr();
    const { data: confirmedTomorrow, error: tomorrowErr } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)')
      .eq('booking_date', tomorrowStr)
      .eq('status', 'confirmed')
      .eq('verified_by_whatsapp', false);

    if (tomorrowErr) throw tomorrowErr;

    let confirmedSentCount = 0;

    if (dailyRemindersEnabled && confirmedTomorrow && confirmedTomorrow.length > 0) {
      const getConfirmedText = (b: any) => {
        const patientName = b.patient_name || 'العزيز';
        const docName = b.doctor ? b.doctor.name : 'طبيب العيادة';
        const queueNum = b.queue_number;
        const shiftText = b.shift === 'Evening' ? 'المسائية (مساءً)' : 'الصباحية (صباحاً)';

        return `🚨 *تذكير بموعد حجز الطبيب*\n\n` +
          `عزيزنا المريض: *${patientName}* المحترم،\n\n` +
          `نود تذكيركم بأن لديكم موعداً مؤكداً غداً لدى مستشفى برج الأطباء:\n\n` +
          `👨‍⚕️ *الطبيب المختص:* د. ${docName}\n` +
          `🔢 *رقم دوركم في القائمة:* ${queueNum}\n` +
          `⏰ *الفترة:* ${shiftText} (يرجى الحضور في الوقت المحدد وتأكيد حضوركم بجهة الاستقبال)\n\n` +
          `نتمنى لكم دوام الصحة والعافية.\n` +
          `🏥 *مستشفى برج الأطباء - Borg Alatiba*`;
      };

      const promises = confirmedTomorrow.map(b => sendHFMessage(b.patient_phone, getConfirmedText(b)));
      const results = await Promise.allSettled(promises);

      for (let i = 0; i < results.length; i++) {
        const resVal = results[i];
        if (resVal.status === 'fulfilled' && resVal.value.ok) {
          confirmedSentCount++;
          // Mark as informed
          await supabase
            .from('bookings')
            .update({ verified_by_whatsapp: true })
            .eq('id', confirmedTomorrow[i].id);

          // Log inside whatsapp_logs
          try {
            await supabase.from('whatsapp_logs').insert([{
              phone: confirmedTomorrow[i].patient_phone,
              direction: 'out',
              message: getConfirmedText(confirmedTomorrow[i])
            }]);
          } catch (_) {}
        }
      }
    }

    resultsSummary.confirmedReminders = {
      totalEligible: confirmedTomorrow?.length || 0,
      successfullyDispatched: confirmedSentCount,
      skippedDueToConfig: !dailyRemindersEnabled,
      targetDate: tomorrowStr
    };

    return res.status(200).json({
      success: true,
      message: 'Unified Daily Automation pipeline executed successfully!',
      timestamp: new Date().toISOString(),
      resultsSummary
    });

  } catch (err: any) {
    console.error('[Daily Pipeline Exception]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
