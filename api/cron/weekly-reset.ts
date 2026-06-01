import { createClient } from '@supabase/supabase-js';

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

    const resendApiKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_REPORT_EMAIL || 'waleedsaleemmohammed@gmail.com';

    // 1. Fetch total counts/breakdowns before wipe
    const { data: bookings, error: fetchErr } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)');

    if (fetchErr) throw fetchErr;

    const totalBookings = bookings?.length || 0;
    const confirmedCount = bookings?.filter(b => b.status === 'confirmed').length || 0;
    const pendingCount = bookings?.filter(b => b.status === 'pending').length || 0;
    const cancelledCount = bookings?.filter(b => b.status === 'cancelled').length || 0;
    const paidCount = bookings?.filter(b => b.payment_status === 'paid').length || 0;

    const doctorStats: Record<string, number> = {};
    bookings?.forEach(b => {
      const docName = b.doctor ? b.doctor.name : 'طبيب محذوف';
      doctorStats[docName] = (doctorStats[docName] || 0) + 1;
    });

    let doctorHtmlList = '';
    for (const [name, count] of Object.entries(doctorStats)) {
      doctorHtmlList += `<li>👨‍⚕️ د. ${name}: ${count} حجز</li>`;
    }

    // 2. Erase Bookings records from Supabase
    const { error: deleteErr } = await supabase
      .from('bookings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteErr) throw deleteErr;

    // Reset weekly capacity using DB RPC trigger
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    if (rpcErr) {
      console.warn('RPC execution missed, performing direct DB fallbacks...', rpcErr);
      const { data: schedules } = await supabase.from('schedules').select('*');
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ available_capacity: s.max_capacity }).eq('id', s.id);
        }
      }
      await supabase.from('bot_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // Save report in whatsapp_sessions under space_server_id 'weekly_report_cache' for the front-end dashboard to show!
    const savedReport = {
      timestamp: new Date().toISOString(),
      stats: {
        totalBookings,
        confirmedCount,
        pendingCount,
        cancelledCount,
        paidCount
      },
      doctorStats
    };

    try {
      await supabase
        .from('whatsapp_sessions')
        .upsert({
          space_server_id: 'weekly_report_cache',
          session_data: JSON.stringify(savedReport),
          updated_at: new Date().toISOString()
        });
    } catch (upsertErr: any) {
      console.error('Failed to cache weekly report:', upsertErr.message);
    }

    // 3. Resend Dispatch
    let emailStatus = 'Skipped (Missing RESEND_API_KEY)';
    if (resendApiKey) {
      const emailBody = `
        <div style="direction: rtl; text-align: right; font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 550px; margin: 0 auto; background-color: #ffffff;">
          <h2 style="color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px;">📊 تقرير الحجوزات الأسبوعي - مستشفى برج الأطباء</h2>
          <p>تحية طيبة وبعد، لقد تم الانتهاء من عملية الضبط والتنظيف الأسبوعية المقررة بنحو تلقائي.</p>
          <p>📋 <strong>تفاصيل إحصائيات الأسبوع المنصرم:</strong></p>
          <ul>
            <li>إجمالي الطلبات: <strong>${totalBookings} حجز</strong></li>
            <li>الحجوزات المؤكدة: <strong>${confirmedCount}</strong></li>
            <li>الحجوزات قيد الانتظار: <strong>${pendingCount}</strong></li>
            <li>الحجوزات الملغاة: <strong>${cancelledCount}</strong></li>
            <li>المدفوعات المكتملة: <strong>${paidCount}</strong></li>
          </ul>
          <h4 style="color: #1d4ed8;">🩺 تفصيل الحجوزات حسب العيادات الطبية:</h4>
          <ul>
            ${doctorHtmlList || '<li>لا توجد حجوزات عيادية هذا الأسبوع.</li>'}
          </ul>
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 30px;">نظام إدارة حجز مستشفى برج الأطباء التلقائي</p>
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
          subject: '📊 التقرير الأسبوعي للحجوزات - مستشفى برج الأطباء',
          html: emailBody
        })
      });

      emailStatus = resEmail.ok ? 'Sent successfully' : `Resend failed. Code: ${resEmail.status}`;
    }

    return res.status(200).json({
      success: true,
      message: 'Weekly schedule & capacity setup cleaned successfully!',
      statistics: {
        totalBookings,
        confirmedCount,
        pendingCount,
        cancelledCount,
        paidCount
      },
      emailStatus
    });

  } catch (err: any) {
    console.error('[Weekly Reset Exception]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
