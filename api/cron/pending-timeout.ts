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

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Compute the 48-hour timestamp threshold (Older than 48 hours is stale)
    const thresholdDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    console.log(`[Pending Timeout Cron] Sweeping bookings created before: ${thresholdDate} that are still 'pending'`);

    // Fetch dirty expired pending bookings
    const { data: expiredBookings, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, schedule_id, patient_name, status')
      .eq('status', 'pending')
      .lt('created_at', thresholdDate);

    if (fetchErr) throw fetchErr;

    if (!expiredBookings || expiredBookings.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No expired pending bookings found to release.'
      });
    }

    console.log(`[Pending Timeout Cron] Found ${expiredBookings.length} expired booking(s) to remove.`);

    let releasedCount = 0;
    for (const b of expiredBookings) {
      // 1. Manually increment the available capacity of the specific schedule associated with this booking
      // (Since physical row deletion doesn't fire update triggers, we handle the capacity recovery manually)
      const { data: schedule } = await supabase
        .from('schedules')
        .select('available_capacity, max_capacity')
        .eq('id', b.schedule_id)
        .single();

      if (schedule) {
        const nextCapacity = Math.min(schedule.max_capacity, schedule.available_capacity + 1);
        await supabase
          .from('schedules')
          .update({ available_capacity: nextCapacity })
          .eq('id', b.schedule_id);
      }

      // 2. Erase the booking from the database to liberate the queue slot
      const { error: deleteErr } = await supabase
        .from('bookings')
        .delete()
        .eq('id', b.id);

      if (!deleteErr) {
        releasedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Pending booking timeout cycle executed successfully!',
      statistics: {
        totalFound: expiredBookings.length,
        successfullyReleased: releasedCount
      }
    });
  } catch (err: any) {
    console.error('[Pending Timeout Exception]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
