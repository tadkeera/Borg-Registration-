import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  // Enable support for both GET (Vercel Cron standard) and POST triggers
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Guard with Vercel Cron Secret in production to secure endpoints from anonymous traffic
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_REPORT_EMAIL || 'waleedsaleemmohammed@gmail.com';

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    console.log('[Weekly Reset Cron] Compiling bookings stats before clearing records...');

    // 1. Compile stats from current bookings
    const { data: bookings, error: fetchErr } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)');

    if (fetchErr) throw fetchErr;

    const totalBookings = bookings?.length || 0;
    const confirmedCount = bookings?.filter(b => b.status === 'confirmed').length || 0;
    const pendingCount = bookings?.filter(b => b.status === 'pending').length || 0;
    const cancelledCount = bookings?.filter(b => b.status === 'cancelled').length || 0;
    const paidCount = bookings?.filter(b => b.payment_status === 'paid').length || 0;

    // Doctor usage breakdown
    const doctorStats: Record<string, number> = {};
    bookings?.forEach(b => {
      const docName = b.doctor ? b.doctor.name : 'طبيب محذوف';
      doctorStats[docName] = (doctorStats[docName] || 0) + 1;
    });

    let doctorHtmlList = '';
    for (const [name, count] of Object.entries(doctorStats)) {
      doctorHtmlList += `<li style="margin-bottom: 8px;">👨‍⚕️ <strong>د. ${name}:</strong> ${count} حجز مسجل</li>`;
    }

    // 2. Clear bookings and reset weekly capacities
    console.log('[Weekly Reset Cron] Deleting bookings records from Supabase...');
    const { error: deleteErr } = await supabase
      .from('bookings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // secure wildcard safe deletion

    if (deleteErr) throw deleteErr;

    // Call Supabase RPC to restore schedule available_capacities back to max & clear active sessions
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    if (rpcErr) {
      console.warn('RPC execution failed, performing manual database table fallback...', rpcErr);
      const { data: schedules } = await supabase.from('schedules').select('*');
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ available_capacity: s.max_capacity }).eq('id', s.id);
        }
      }
      await supabase.from('bot_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // 3. Send beautifully styled HTML report with Resend
    let emailStatus = 'Skipped (Missing RESEND_API_KEY)';
    if (resendApiKey) {
      console.log(`[Weekly Reset Cron] Sending Resend statistic report email to: ${adminEmail}`);

      const emailBody = `
        <div style="direction: rtl; text-align: right; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 600px; margin: 20px auto; color: #1e293b; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <div style="text-align: center; border-bottom: 3px solid #1d4ed8; padding-bottom: 20px; margin-bottom: 25px;">
            <h2 style="color: #1d4ed8; margin: 0; font-size: 24px;">مستشفى برج الأطباء</h2>
            <p style="font-size: 14px; color: #64748b; margin: 6px 0 0 0;">📊 نظام الحجوزات الأسبوعي - تقرير الإحصائيات الأسبوعي الشامل</p>
          </div>
          
          <h3 style="color: #0f172a; margin-top: 0;">الزملاء في قسم الإدارة والتشغيل،</h3>
          <p style="font-size: 15px; line-height: 1.6; color: #334155;">تحية طيبة وبعد، تم تشغيل دورة التنظيف والفرز التلقائي الأسبوعي بنجاح. لقد تم تصفير جميع الحجوزات النشطة وتهيئة عيادات الأطباء لاستقبال التسجيل للأسبوع الجديد.</p>
          
          <h4 style="color: #1d4ed8; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 25px; margin-bottom: 15px;">📋 ملخص الإحصائيات الحركية للأسبوع المنصرم:</h4>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; width: 60%;">مجموع الطلبات المسجلة:</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #1d4ed8; font-weight: bold;">${totalBookings} حجز</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">✅ حجوزات مؤكدة بنجاح:</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #15803d; font-weight: bold;">${confirmedCount}</td>
            </tr>
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">⏳ حجوزات بقيت قيد الانتظار:</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #b45309;">${pendingCount}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">❌ حجوزات تم إلغاؤها:</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #b91c1c;">${cancelledCount}</td>
            </tr>
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">💳 مدفوعات الرشيد المكتملة:</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #15803d; font-weight: bold;">${paidCount}</td>
            </tr>
          </table>
          
          <h4 style="color: #1d4ed8; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 25px;">📊 تفاعل المرضى حسب عيادات الأطباء:</h4>
          <ul style="padding-right: 20px; font-size: 14px; line-height: 1.8; color: #475569;">
            ${doctorHtmlList || '<li style="color: #64748b;">لا توجد حجوزات عيادية مسجلة هذا الأسبوع.</li>'}
          </ul>
          
          <div style="background-color: #f0fdf4; border-right: 4px solid #16a34a; padding: 15px; border-radius: 6px; margin-top: 25px; font-size: 14px; color: #14532d;">
            💡 <strong>تنبيه إداري:</strong> تم إعادة ضبط وإفراغ جميع ساعات السعة القياسية للأطباء (Available Capacities) بنجاح غداً للمباشرة في حجز الأسبوع المقبل.
          </div>
          
          <div style="margin-top: 35px; padding-top: 20px; border-top: 1px solid #edf2f7; text-align: center; font-size: 11px; color: #94a3b8;">
            تقرير فني تلقائي - تم الإنشاء عبر وظيفة Vercel Serverless مجدولة في مستشفى برج الأطباء.
          </div>
        </div>
      `;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'نظام برج الأطباء <reports@resend.dev>',
          to: [adminEmail],
          subject: '📊 التقرير الأسبوعي الشامل وعملية الترسيت - مستشفى برج الأطباء',
          html: emailBody
        })
      });

      if (response.ok) {
        emailStatus = 'Sent successfully';
      } else {
        const errorText = await response.text();
        emailStatus = `Failed to send email. Code: ${response.status}. Response: ${errorText}`;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Weekly stats compiled, bookings deleted, schedules reset, and report generated.',
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
