import express from 'express';
import { serve } from '@upstash/workflow/express';
import { Client } from '@upstash/workflow';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Standalone safe Supabase Admin creator inside workflows step scopes
function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration is missing in workflow execution context.');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });
}

// Durable core function to dispatch WhatsApp messages using Hugging Face Custom gateway
async function sendWhatsAppMessage(to: string, message: string) {
  const url = 'https://waleedoo-borg-whatsapp-server-1.hf.space/api/send-message';
  const cleanPhone = to.startsWith('+') ? to : `+${to.trim()}`;

  console.log(`[Workflow Gateway] Dispatched message to [+${cleanPhone}] via Hugging Face Gateway...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: cleanPhone,
      message: message
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`WhatsApp custom gateway failed with status ${response.status}: ${errorText}`);
  }

  return await response.json().catch(() => ({ success: true }));
}


// -------------------------------------------------------------------------------------
// WORKFLOW 1: APPOINTMENT REMINDER (Sleeps until 24 hours prior to appointment)
// -------------------------------------------------------------------------------------
const appointmentReminderPost = serve<{ bookingId: string }>(async (context) => {
  const { bookingId } = context.requestPayload;

  // Step 1: Query booking metadata
  const booking = await context.run('get-booking-info', async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name), schedule:schedules(start_time)')
      .eq('id', bookingId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });

  if (!booking) {
    console.log(`[Workflow Reminder] Booking with identity ${bookingId} doesn't exist. Closing.`);
    return;
  }

  // Calculate target reminder time (24 hours prior to starting shift)
  const startTime = booking.schedule?.start_time || (booking.shift === 'Evening' ? '16:00' : '09:00');
  
  // Construct Date in Yemen Zone (UTC+3)
  const appointmentDateStr = `${booking.booking_date}T${startTime}:00+03:00`;
  const appointmentTime = new Date(appointmentDateStr).getTime();
  const targetReminderTime = appointmentTime - (24 * 60 * 60 * 1000); // 24 hours before

  const now = Date.now();
  if (targetReminderTime > now) {
    console.log(`[Workflow Reminder] Appointment is scheduled in future. Sleeping until date: ${new Date(targetReminderTime).toISOString()}`);
    await context.sleepUntil('sleep-until-24h-prior', new Date(targetReminderTime));
  } else {
    console.log(`[Workflow Reminder] Appointment is in less than 24h. Dispatching reminder message now.`);
  }

  // Step 2: Query active status of booking to check cancelations
  const activeBooking = await context.run('re-fetch-booking-status', async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)')
      .eq('id', bookingId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });

  if (!activeBooking || activeBooking.status === 'cancelled') {
    console.log(`[Workflow Reminder] Target booking ${bookingId} was cancelled in interim. Skipping reminder execution.`);
    return;
  }

  // Step 3: Dispatch the beautiful reminder template
  await context.run('trigger-whatsapp-reminder', async () => {
    const doctorName = activeBooking.doctor ? activeBooking.doctor.name : 'الطبيب المختص';
    const queueNumber = activeBooking.queue_number;
    const shift = activeBooking.shift === 'Evening' ? 'المسائية' : 'الصباحية';
    const patientName = activeBooking.patient_name;
    const patientPhone = activeBooking.patient_phone;
    const bookingDate = activeBooking.booking_date;

    const arabicMessage = `🚨 *تذكير بموعد حجز الطبيب*\n` +
      `مرحباً بك يا ${patientName}،\n\n` +
      `نود تذكيرك بموعد حجزك المؤكد غداً *(${bookingDate})* لدى مستشفى برج الأطباء:\n\n` +
      `👨‍⚕️ *الطبيب:* د. ${doctorName}\n` +
      `🔢 *رقم دورك في القائمة:* ${queueNumber}\n` +
      `⏰ *الفترة:* ${shift} (يرجى الحضور في الوقت المحدد وتأكيد حضوركم بجهة الاستقبال)\n\n` +
      `نتمنى لكم دوام الصحة والعافية.\n` +
      `🏥 *مستشفى برج الأطباء - Borg Alatiba*`;

    await sendWhatsAppMessage(patientPhone, arabicMessage);

    // Update DB flag
    const supabase = getSupabase();
    await supabase
      .from('bookings')
      .update({ verified_by_whatsapp: true })
      .eq('id', bookingId);

    return { sent: true };
  });
});


// -------------------------------------------------------------------------------------
// WORKFLOW 2: WEEKLY SYSTEM RESET & ADMIN REPORTING
// -------------------------------------------------------------------------------------
const weeklyCleanupPost = serve(async (context) => {
  // Step 1: Extract statistics and usage metrics before database wipe
  const stats = await context.run('compile-reporting-statistics', async () => {
    const supabase = getSupabase();
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)');

    if (error) throw error;

    const totalBookings = bookings?.length || 0;
    const confirmedCount = bookings?.filter(b => b.status === 'confirmed').length || 0;
    const pendingCount = bookings?.filter(b => b.status === 'pending').length || 0;
    const cancelledCount = bookings?.filter(b => b.status === 'cancelled').length || 0;
    const paidCount = bookings?.filter(b => b.payment_status === 'paid').length || 0;

    // Compile clinic breakdown
    const doctorStats: Record<string, number> = {};
    bookings?.forEach(b => {
      const docName = b.doctor ? b.doctor.name : 'طبيب محذوف';
      doctorStats[docName] = (doctorStats[docName] || 0) + 1;
    });

    let doctorHtmlList = '';
    for (const [name, count] of Object.entries(doctorStats)) {
      doctorHtmlList += `<li style="margin-bottom: 8px;">👨‍⚕️ <strong>د. ${name}:</strong> ${count} حجز مسجل</li>`;
    }

    return {
      totalBookings,
      confirmedCount,
      pendingCount,
      cancelledCount,
      paidCount,
      doctorHtmlList
    };
  });

  // Step 2: Trigger beautiful styled statistics report email via Resend
  await context.run('dispatch-admin-email', async () => {
    const resendApiKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_REPORT_EMAIL || 'waleedsaleemmohammed@gmail.com';

    if (!resendApiKey) {
      console.warn('[Workflow Reset] Resend API Key is missing. Skipping email distribution.');
      return { status: 'skipped', reason: 'Missing RESEND_API_KEY' };
    }

    const emailBody = `
      <div style="direction: rtl; text-align: right; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 600px; margin: 20px auto; color: #1e293b; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="text-align: center; border-bottom: 3px solid #1d4ed8; padding-bottom: 20px; margin-bottom: 25px;">
          <h2 style="color: #1d4ed8; margin: 0; font-size: 24px;">مستشفى برج الأطباء</h2>
          <p style="font-size: 14px; color: #64748b; margin: 6px 0 0 0;">📊 نظام الحجوزات الأسبوعي - تقرير الإحصائيات الأسبوعي الشامل</p>
        </div>
        
        <h3 style="color: #0f172a; margin-top: 0;">الزملاء في قسم الإدارة والتشغيل،</h3>
        <p style="font-size: 15px; line-height: 1.6; color: #334155;">تحية طيبة وبعد، تم تشغيل دورة التنظيف والفرز التلقائي الأسبوعي بنجاح عبر نظام Workflow المتين. لقد تم تصفير جميع الحجوزات النشطة وتهيئة عيادات الأطباء للاستقبال للأسبوع الجديد.</p>
        
        <h4 style="color: #1d4ed8; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 25px; margin-bottom: 15px;">📋 ملخص الإحصائيات الحركية للأسبوع المنصرم:</h4>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; width: 60%;">مجموع الطلبات المسجلة:</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #1d4ed8; font-weight: bold;">${stats.totalBookings} حجز</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">✅ حجوزات مؤكدة بنجاح:</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #15803d; font-weight: bold;">${stats.confirmedCount}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">⏳ حجوزات بقيت قيد الانتظار:</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #b45309;">${stats.pendingCount}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">❌ حجوزات تم إلغاؤها:</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #b91c1c;">${stats.cancelledCount}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">💳 مدفوعات الرشيد المكتملة:</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #15803d; font-weight: bold;">${stats.paidCount}</td>
          </tr>
        </table>
        
        <h4 style="color: #1d4ed8; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 25px;">📊 تفاعل المرضى حسب عيادات الأطباء:</h4>
        <ul style="padding-right: 20px; font-size: 14px; line-height: 1.8; color: #475569;">
          ${stats.doctorHtmlList || '<li style="color: #64748b;">لا توجد حجوزات عيادية مسجلة هذا الأسبوع.</li>'}
        </ul>
        
        <div style="background-color: #f0fdf4; border-right: 4px solid #16a34a; padding: 15px; border-radius: 6px; margin-top: 25px; font-size: 14px; color: #14532d;">
          💡 <strong>تنبيه إداري:</strong> تم إعادة ضبط عيادات الأطباء (Available Capacities) بنجاح غداً للمباشرة في حجز الأسبوع المقبل.
        </div>
        
        <div style="margin-top: 35px; padding-top: 20px; border-top: 1px solid #edf2f7; text-align: center; font-size: 11px; color: #94a3b8;">
          تقرير فني تلقائي - تم الإنشاء عبر وظيفة Vercel Workflows المتينة لمستشفى برج الأطباء.
        </div>
      </div>
    `;

    const resEmail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'نظام برج الأطباء <reports@resend.dev>',
        to: [adminEmail],
        subject: '📊 التقرير الأسبوعي الشامل وعملية ضبط الشواغر - مستشفى برج الأطباء',
        html: emailBody
      })
    });

    if (!resEmail.ok) {
      throw new Error(`Resend distribution failed: ${resEmail.status}`);
    }

    return { sent: true };
  });

  // Step 3: Wipe historic booking data and trigger atomic RPC schedule resets
  await context.run('database-restructures-cleanup', async () => {
    const supabase = getSupabase();

    // Reset Bookings secure wildcard deletion
    const { error: deleteErr } = await supabase
      .from('bookings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteErr) throw deleteErr;

    // Reset weekly capacity using DB RPC trigger
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    if (rpcErr) {
      console.warn('RPC execution missed in workflow sandbox context, doing direct DB fallbacks...', rpcErr);
      const { data: schedules } = await supabase.from('schedules').select('*');
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ available_capacity: s.max_capacity }).eq('id', s.id);
        }
      }
      await supabase.from('bot_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    return { resetCompleted: true };
  });
});


// -------------------------------------------------------------------------------------
// WORKFLOW 3: PENDING BOOKING TIMEOUT (48-Hour Auto-Cancellation & Notification)
// -------------------------------------------------------------------------------------
const pendingTimeoutPost = serve<{ bookingId: string }>(async (context) => {
  const { bookingId } = context.requestPayload;

  console.log(`[Workflow Pending Timeout] Initialised for booking: ${bookingId}. Sleeping for 48 hours.`);

  // Sleep for exactly 48 Hours
  await context.sleep('wait-for-48-hour-limit', '48h');

  // Step 2: Query booking data to verify status
  const currentBooking = await context.run('retrieve-latest-status', async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });

  if (!currentBooking) {
    console.log(`[Workflow Pending Timeout] Booking ${bookingId} not found. Exiting.`);
    return;
  }

  // If status is still PENDING (meaning unpaid, unconfirmed by receptionist), release slot!
  if (currentBooking.status === 'pending') {
    await context.run('execute-cancellation-and-inform', async () => {
      const supabase = getSupabase();

      // Update status to 'cancelled' (which triggers safe-restore PG triggers)
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', payment_status: 'cancelled' })
        .eq('id', bookingId);

      if (updateErr) throw updateErr;

      // Send polite WhatsApp warning
      const arabicCancelWarning = `⚠️ *إلغاء حجز تلقائي*\n\nعزيزنا المريض، نود إحاطتكم بأنه تم إلغاء حجزكم قيد الانتظار لمستشفى برج الأطباء تلقائياً لعدم تأكيد الحجز ودفع الرسوم خلال فترة الصلاحية المحددة (48 ساعة).\n\nيسعد بخدمتكم مجدداً وتنسيق موعد جديد في أي وقت.`;

      try {
        await sendWhatsAppMessage(currentBooking.patient_phone, arabicCancelWarning);
      } catch (err: any) {
        console.error(`[Workflow Pending Timeout] WhatsApp notice failed: ${err.message}`);
      }

      return { autoCancelled: true };
    });
  } else {
    console.log(`[Workflow Pending Timeout] Booking ${bookingId} current status is [${currentBooking.status}]. Auto-cancellation skipped.`);
  }
});


// -------------------------------------------------------------------------------------
// ROUTER ASSIGNMENT & INTEGRATIONS
// -------------------------------------------------------------------------------------
router.use('/api/workflow/appointment-reminder', appointmentReminderPost);
router.use('/api/workflow/weekly-cleanup', weeklyCleanupPost);
router.use('/api/workflow/pending-timeout', pendingTimeoutPost);

// -------------------------------------------------------------------------------------
// PROGRAMMATIC WORKFLOW TRIGGERS
// -------------------------------------------------------------------------------------
export async function triggerAppointmentReminderWorkflow(bookingId: string) {
  try {
    const qstashToken = process.env.UPSTASH_TOKEN || process.env.QSTASH_TOKEN;
    if (!qstashToken) {
      console.warn('[Workflow Trigger] QSTASH_TOKEN / UPSTASH_TOKEN is missing. Workflow 1 trigger skipped.');
      return;
    }
    const client = new Client({ token: qstashToken });
    const appUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : (process.env.DEVELOPMENT_APP_URL || 'http://localhost:3000');
    
    await client.trigger({
      url: `${appUrl}/api/workflow/appointment-reminder`,
      body: { bookingId }
    });
    console.log(`[Workflow Trigger 1] Triggered appointment reminder workflow for booking: ${bookingId}`);
  } catch (err: any) {
    console.error(`[Workflow Trigger 1 Error] Failed to trigger reminder: ${err.message}`);
  }
}

export async function triggerPendingTimeoutWorkflow(bookingId: string) {
  try {
    const qstashToken = process.env.UPSTASH_TOKEN || process.env.QSTASH_TOKEN;
    if (!qstashToken) {
      console.warn('[Workflow Trigger] QSTASH_TOKEN / UPSTASH_TOKEN is missing. Workflow 3 trigger skipped.');
      return;
    }
    const client = new Client({ token: qstashToken });
    const appUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : (process.env.DEVELOPMENT_APP_URL || 'http://localhost:3000');

    await client.trigger({
      url: `${appUrl}/api/workflow/pending-timeout`,
      body: { bookingId }
    });
    console.log(`[Workflow Trigger 3] Triggered pending timeout workflow for booking: ${bookingId}`);
  } catch (err: any) {
    console.error(`[Workflow Trigger 3 Error] Failed to trigger timeout: ${err.message}`);
  }
}

export default router;
