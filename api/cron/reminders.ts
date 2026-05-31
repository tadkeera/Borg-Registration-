import { createClient } from '@supabase/supabase-js';

// Yemen (UTC+3) Time offset helper
function getYemenTomorrowStr(): string {
  const utcNow = new Date().getTime();
  const yemenOffset = 3 * 60 * 60 * 1000;
  const yemenTomorrow = new Date(utcNow + yemenOffset + (24 * 60 * 60 * 1000));
  return yemenTomorrow.toISOString().split('T')[0];
}

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

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    // Initialize clean standalone admin Supabase connection
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const tomorrowStr = getYemenTomorrowStr();
    console.log(`[Reminder Cron] Sweeping active bookings scheduled for: ${tomorrowStr}`);

    // Select confirmed bookings for tomorrow that haven't received a WhatsApp reminder yet
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name)')
      .eq('booking_date', tomorrowStr)
      .eq('status', 'confirmed')
      .eq('verified_by_whatsapp', false);

    if (error) throw error;

    if (!bookings || bookings.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending reminders for tomorrow.',
        date: tomorrowStr
      });
    }

    console.log(`[Reminder Cron] Sending reminders for ${bookings.length} booking(s).`);

    let sentCount = 0;
    for (const b of bookings) {
      const patientPhone = b.patient_phone;
      const patientName = b.patient_name;
      const doctorName = b.doctor ? b.doctor.name : 'الطبيب المختص';
      const queueNumber = b.queue_number;
      const shift = b.shift === 'Evening' ? 'المسائية' : 'الصباحية';

      // Clean Arabic Message Template
      const arabicMessage = `🚨 *تذكير بموعد حجز الطبيب*\n` +
        `مرحباً بك يا ${patientName}،\n\n` +
        `نود تذكيرك بموعد حجزك المؤكد غداً *(${tomorrowStr})* لدى مستشفى برج الأطباء:\n\n` +
        `👨‍⚕️ *الطبيب:* د. ${doctorName}\n` +
        `🔢 *رقم دورك في القائمة:* ${queueNumber}\n` +
        `⏰ *الفترة:* ${shift} (يرجى الحضور في الوقت المناسب وتأكيد تسليم الهوية بقسم الاستقبال)\n\n` +
        `نتمنى لكم دوام الصحة والعافية.\n` +
        `🏥 *مستشفى برج الأطباء - Borg Alatiba*`;

      let sentSuccess = false;
      const provider = process.env.WHATSAPP_PROVIDER || 'ultramsg';

      if (provider === 'whapi') {
        const whapiToken = process.env.WHAPI_TOKEN;
        // Whapi.cloud API Integration
        const resWhapi = await fetch('https://gate.whapi.cloud/messages/text', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            to: patientPhone.replace('+', ''), // standard number format without plus
            body: arabicMessage
          })
        });
        sentSuccess = resWhapi.ok;
      } else {
        // Default: Pure Ultramsg Integration
        const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
        const ultraToken = process.env.ULTRAMSG_TOKEN;
        
        const resUltra = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: ultraToken || '',
            to: patientPhone,
            body: arabicMessage
          })
        });
        sentSuccess = resUltra.ok;
      }

      if (sentSuccess) {
        // Mark as reminded so we never double notify
        await supabase
          .from('bookings')
          .update({ verified_by_whatsapp: true })
          .eq('id', b.id);
          
        sentCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Reminders sweep dispatched successfully!`,
      statistics: {
        totalToRemind: bookings.length,
        successfullySent: sentCount,
        date: tomorrowStr
      }
    });
  } catch (err: any) {
    console.error('[Reminder Sweep Exception]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
