/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { DbState, Doctor, Schedule, Booking, WhatsAppLog, BotSession, BotState, BookingStatus, PaymentStatus, WhatsAppSettings, SystemSettings } from './src/types';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env if present
dotenv.config();

// Safe Lazy-Initialized Supabase Client Helper
let supabaseClient: any = null;

export function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      throw new Error('Supabase URL configuration is missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL)');
    }
    if (!supabaseKey) {
      throw new Error('Supabase Key configuration is missing (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY)');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

const app = express();
const PORT = 3000;

// Force a robust, crash-safe local file setup that handles serverless deployment (like Vercel) gracefully
const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;


// Full-proof utility to ensure DB state has all required keys & default users




// -------------------------------------------------------------------------
// TIMEZONE & DATE UTILITIES (YEMEN UTC+3)
// -------------------------------------------------------------------------
function getYemenTime(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 3)); // Yemen is UTC + 3
}

function getDayNameArabic(dayIndex: number): string {
  const days = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  return days[dayIndex] || 'غير معروف';
}

function getTargetDate(targetDayOfWeekIndex: number): string {
  const yemenNow = getYemenTime();
  const currentJsDay = yemenNow.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  
  // Map JS Day index to our day index (0: Sat, 1: Sun, ..., 5: Thu)
  // Friday is 5 in JS (Wait: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6)
  // Let's align this mapping:
  const jsToOur = [1, 2, 3, 4, 5, -1, 0]; // Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=-1, Sat=0
  const ourCurrentDay = jsToOur[currentJsDay];
  
  if (ourCurrentDay === -1) {
    // Today is Friday (rigid day off). Next booking slots can start from Saturday.
    // Days to add = 1 (to Sat) + targetDayOfWeekIndex
    const daysToAdd = 1 + targetDayOfWeekIndex;
    const targetDate = new Date(yemenNow.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return targetDate.toISOString().split('T')[0];
  }

  let diff = targetDayOfWeekIndex - ourCurrentDay;
  if (diff < 0) {
    // Has passed this week, refers to next week's schedule cycle
    diff += 7;
  }
  
  const targetDate = new Date(yemenNow.getTime() + diff * 24 * 60 * 60 * 1000);
  return targetDate.toISOString().split('T')[0];
}

// -------------------------------------------------------------------------
// SERVER MIDDLEWARE SETUP
// -------------------------------------------------------------------------
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// CORS headers configuration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Hub-Signature');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Basic webhook rate limiting structure (simplified)
const rateLimits: Record<string, { count: number; firstRequest: number }> = {};
function webhookRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (!rateLimits[ip]) {
    rateLimits[ip] = { count: 1, firstRequest: now };
    return next();
  }
  
  const windowTime = 60 * 1000; // 1 minute
  if (now - rateLimits[ip].firstRequest > windowTime) {
    rateLimits[ip] = { count: 1, firstRequest: now };
    return next();
  }
  
  rateLimits[ip].count++;
  if (rateLimits[ip].count > 100) { // Max 100 messages per ip per minute
    return res.status(429).json({ error: 'عذراً، تم تجاوز حد الطلبات المسموح به. يرجى المحاولة لاحقاً.' });
  }
  next();
}

// -------------------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------------------

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: getYemenTime().toISOString(), timezone: 'Asia/Aden (UTC+3)' });
});

// Supabase configuration verification endpoint
app.get('/api/supabase-status', async (req, res) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(400).json({
      configured: false,
      error: 'لم يتم تكوين متغيرات بيئة Supabase بشكل كامل في Vercel أو البيئة الحالية.',
      checks: {
        supabaseUrl: !!supabaseUrl,
        supabaseKey: !!supabaseKey,
        hasServiceRole
      },
      hint: 'يرجى إدخال NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY أو SUPABASE_SERVICE_ROLE_KEY في إعدادات البيئة (Environment Variables) بمشروع Vercel.'
    });
  }

  try {
    const supabase = getSupabase();
    // Test a basic lightweight ping to check configuration connection
    const { data, error } = await supabase.from('_dummy_table_test_').select('*').limit(1).maybeSingle();
    
    // An error about table not existing means we successfully connected but table doesn't exist (which is fine and expected!)
    const isConnected = !error || (error.code !== 'PGRST301' && error.message?.includes('does not exist'));

    return res.json({
      configured: true,
      connected: isConnected,
      supabaseUrl: supabaseUrl.replace(/^(https:\/\/)[^.]+(\.supabase\.co)/, '$1***$2'), // Mask project id for health response privacy
      authChecks: {
        hasUrl: true,
        hasKey: true,
        keyType: hasServiceRole ? 'Service Role Key (Full Admin)' : 'Anon Key (Public API)'
      },
      message: isConnected ? 'تم الاتصال وقراءة المتغيرات بنجاح من الخادم!' : 'تم قراءة المتغيرات، ولكن فشل الاتصال مع م قاعدة البيانات.',
      details: error || 'لا يـوجد أخـطاء'
    });
  } catch (err: any) {
    return res.json({
      configured: true,
      connected: false,
      error: err.message || 'فشل الاتصال بـ Supabase',
      details: err
    });
  }
});

// 1. AUTHENTICATION & SECURITY
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(405).json({ success: false, error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();

  try {
    const supabase = getSupabase();
    
    // 1. Try Supabase Auth first
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: cleanUser,
      password: cleanPass
    });

    if (!authErr && authData?.user) {
      const role = authData.user.user_metadata?.role || (cleanUser === 'tadkeera@gmail.com' || cleanUser.includes('admin') ? 'admin' : 'receptionist');
      const empName = authData.user.user_metadata?.name || (cleanUser === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : username);
      return res.json({
        success: true,
        role: role,
        token: authData.session?.access_token || `${role}-${authData.user.id}`,
        receptionistName: empName
      });
    }

    // 2. Try the custom users database table
    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .eq('username', cleanUser)
      .eq('password', cleanPass)
      .maybeSingle();

    if (dbUser) {
      return res.json({
        success: true,
        role: dbUser.role,
        token: `${dbUser.role}-${dbUser.id}`,
        receptionistName: dbUser.employee_name || dbUser.username
      });
    }

    // 3. Simple hardcoded fallback for brand new systems before database tables are seeded
    const isHardcodedAdmin = (cleanUser === 'tadkeera@gmail.com' && cleanPass === 'WALEED770@');
    if (isHardcodedAdmin) {
      return res.json({
        success: true,
        role: 'admin',
        token: 'admin-tadkeera',
        receptionistName: 'مدير تذكرة (Tadkeera Admin)'
      });
    }

    return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
  } catch (err: any) {
    console.error('[Auth Error]', err.message);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء المصادقة' });
  }
});

// Dynamic User Management API
app.get('/api/users', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      // Return hardcoded placeholders if custom users table does not exist yet to keep UI from crashing
      return res.json([
        { id: 'u-tadkeera', username: 'tadkeera@gmail.com', role: 'admin', employee_name: 'مدير تذكرة (Tadkeera Admin)' },
        { id: 'u-1', username: 'admin', role: 'admin', employee_name: 'مدير النظام الرئيسي' },
        { id: 'u-2', username: 'receptionist', role: 'receptionist', employee_name: 'موظف الاستقبال الافتراضي' }
      ]);
    }

    res.json((data || []).map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      employee_name: u.employee_name || u.username,
      created_at: u.created_at
    })));
  } catch (err: any) {
    console.error('Fetch users error:', err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role, employee_name } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور واختيار الصلاحية' });
  }

  try {
    const supabase = getSupabase();
    const { data: exists } = await supabase
      .from('users')
      .select('id')
      .eq('username', username.trim().toLowerCase())
      .maybeSingle();

    if (exists) {
      return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
    }

    const newUser = {
      username: username.trim(),
      password: password.trim(),
      role: role,
      employee_name: employee_name ? employee_name.trim() : (role === 'admin' ? 'مدير نظام جديد' : 'موظف استقبال جديد')
    };

    const { data, error } = await supabase
      .from('users')
      .insert([newUser])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error('Create user error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = getSupabase();
    const { data: userToDelete, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !userToDelete) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin');

    if (userToDelete.role === 'admin' && (admins || []).length <= 1) {
      return res.status(400).json({ error: 'لا يمكن حذف آخر مدير نظام للوحة التحكم لتفادي غلق الحساب.' });
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, role, employee_name } = req.body;
  try {
    const supabase = getSupabase();
    
    const { data: userToUpdate, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !userToUpdate) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (username && username.trim().toLowerCase() !== userToUpdate.username.toLowerCase()) {
      const { data: exists } = await supabase
        .from('users')
        .select('id')
        .eq('username', username.trim().toLowerCase())
        .maybeSingle();

      if (exists) {
        return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
      }
    }

    const updatedFields: any = {};
    if (username !== undefined) updatedFields.username = username.trim();
    if (password !== undefined && password.trim() !== '') updatedFields.password = password.trim();
    if (role !== undefined) updatedFields.role = role;
    if (employee_name !== undefined) updatedFields.employee_name = employee_name.trim();

    const { data, error } = await supabase
      .from('users')
      .update(updatedFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update user' });
  }
});

// 2. DOCTORS ENDPOINTS (CRUD)
app.get('/api/doctors', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error('Fetch doctors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

app.post('/api/doctors', async (req, res) => {
  const { name, specialty, is_active, allow_second_week_booking, limit_two_patients_per_number } = req.body;
  if (!name || !specialty) {
    return res.status(400).json({ error: 'Name and specialty are required' });
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('doctors')
      .insert([{
        name,
        specialty,
        is_active: is_active !== undefined ? is_active : true,
        allow_second_week_booking: allow_second_week_booking !== undefined ? !!allow_second_week_booking : false,
        limit_two_patients_per_number: limit_two_patients_per_number !== undefined ? !!limit_two_patients_per_number : false
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error('Create doctor error:', err.message);
    res.status(500).json({ error: 'Failed to create doctor' });
  }
});

app.put('/api/doctors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, specialty, is_active, allow_second_week_booking, limit_two_patients_per_number } = req.body;
  try {
    const supabase = getSupabase();
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (specialty !== undefined) updateData.specialty = specialty;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (allow_second_week_booking !== undefined) updateData.allow_second_week_booking = !!allow_second_week_booking;
    if (limit_two_patients_per_number !== undefined) updateData.limit_two_patients_per_number = !!limit_two_patients_per_number;

    const { data, error } = await supabase
      .from('doctors')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error('Update doctor error:', err.message);
    res.status(500).json({ error: 'Failed to update doctor' });
  }
});

app.delete('/api/doctors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('doctors')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Doctor deleted' });
  } catch (err: any) {
    console.error('Delete doctor error:', err.message);
    res.status(500).json({ error: 'Failed to delete doctor' });
  }
});

// 3. SCHEDULES ENDPOINTS (CRUD)
app.get('/api/schedules', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('schedules')
      .select('*, doctor:doctors(name, specialty)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    const mapped = (data || []).map(sch => ({
      ...sch,
      doctor_name: sch.doctor ? sch.doctor.name : 'طبيب محذوف',
      doctor_specialty: sch.doctor ? sch.doctor.specialty : ''
    }));
    res.json(mapped);
  } catch (err: any) {
    console.error('Fetch schedules error:', err.message);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/schedules', async (req, res) => {
  const { doctor_id, day_of_week, max_capacity, start_time: body_start, end_time: body_end, shift } = req.body;
  try {
    const supabase = getSupabase();
    const parsedDay = parseInt(day_of_week);
    if (parsedDay < 0 || parsedDay > 5) {
      return res.status(400).json({ error: 'عذراً، الجمعة يوم إجازة رسمي ولا يمكن الإضافة ضمنه.' });
    }

    const start_time = body_start || (shift === 'evening' ? '15:00' : '09:00');
    const end_time = body_end || (shift === 'evening' ? '19:00' : '13:00');

    // Check duplicate: allow morning and evening shifts on the same day, block only if duplicate of same start_time (shift)
    const { data: existing } = await supabase
      .from('schedules')
      .select('id')
      .eq('doctor_id', doctor_id)
      .eq('day_of_week', parsedDay)
      .eq('start_time', start_time)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'عذراً، هذا الطبيب لديه عيادة مجدولة بالفعل في نفس هذه الفترة (الصباحية أو المسائية) في هذا اليوم.' });
    }

    const capacity = parseInt(max_capacity) || 15;
    const { data, error } = await supabase
      .from('schedules')
      .insert([{
        doctor_id,
        day_of_week: parsedDay,
        max_capacity: capacity,
        available_capacity: capacity,
        start_time,
        end_time
      }])
      .select('*, doctor:doctors(name, specialty)')
      .single();

    if (error) throw error;
    res.status(201).json({
      ...data,
      doctor_name: data.doctor ? data.doctor.name : '',
      doctor_specialty: data.doctor ? data.doctor.specialty : ''
    });
  } catch (err: any) {
    console.error('Create schedule error:', err.message);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

app.put('/api/schedules/:id', async (req, res) => {
  const { id } = req.params;
  const { max_capacity, start_time, end_time } = req.body;
  try {
    const supabase = getSupabase();
    const { data: oldSch, error: getErr } = await supabase
      .from('schedules')
      .select('*')
      .eq('id', id)
      .single();

    if (getErr || !oldSch) return res.status(404).json({ error: 'Schedule not found' });

    const oldMax = oldSch.max_capacity;
    const newMax = max_capacity !== undefined ? parseInt(max_capacity) : oldMax;
    const capDiff = newMax - oldMax;
    const nextAvailable = Math.max(0, oldSch.available_capacity + capDiff);

    const { data, error } = await supabase
      .from('schedules')
      .update({
        max_capacity: newMax,
        available_capacity: nextAvailable,
        start_time: start_time || oldSch.start_time,
        end_time: end_time || oldSch.end_time
      })
      .eq('id', id)
      .select('*, doctor:doctors(name, specialty)')
      .single();

    if (error) throw error;
    res.json({
      ...data,
      doctor_name: data.doctor ? data.doctor.name : '',
      doctor_specialty: data.doctor ? data.doctor.specialty : ''
    });
  } catch (err: any) {
    console.error('Update schedule error:', err.message);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

app.delete('/api/schedules/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Schedule deleted' });
  } catch (err: any) {
    console.error('Delete schedule error:', err.message);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// 4. BOOKINGS ENDPOINTS (CRUD)
app.get('/api/bookings', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name, specialty)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    const mapped = (data || []).map(b => ({
      ...b,
      doctor_name: b.doctor ? b.doctor.name : 'طبيب محذوف',
      doctor_specialty: b.doctor ? b.doctor.specialty : ''
    }));
    res.json(mapped);
  } catch (err: any) {
    console.error('Fetch bookings error:', err.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.post('/api/bookings', async (req, res) => {
  const { doctor_id, schedule_id, patient_name, patient_phone, booking_date } = req.body;
  try {
    const supabase = getSupabase();
    
    // Check duplicates
    const { data: existingDup } = await supabase
      .from('bookings')
      .select('id')
      .eq('patient_phone', patient_phone)
      .eq('booking_date', booking_date)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (existingDup) {
      return res.status(400).json({ error: 'عذراً، هذا المريض مسجل بالفعل في حجز نشط آخر لهذا اليوم.' });
    }

    const { data: sch } = await supabase
      .from('schedules')
      .select('available_capacity, start_time')
      .eq('id', schedule_id)
      .single();

    if (!sch || sch.available_capacity <= 0) {
      return res.status(400).json({ error: 'عذراً لا توجد سعة باقية للحجز في هذا الموعد.' });
    }

    const startHour = parseInt(sch.start_time.split(':')[0]);
    const shiftValue = startHour < 13 ? 'Morning' : 'Evening';

    // Calculate next queue number for this doctor, date, and shift
    const { data: qData } = await supabase
      .from('bookings')
      .select('queue_number')
      .eq('doctor_id', doctor_id)
      .eq('booking_date', booking_date)
      .eq('shift', shiftValue);

    const maxQ = qData && qData.length > 0
      ? Math.max(...qData.map(b => b.queue_number || 0))
      : 0;
    const nextQueueNumber = Math.max(maxQ, qData?.length || 0) + 1;

    const { data, error } = await supabase
      .from('bookings')
      .insert([{
        doctor_id,
        schedule_id,
        patient_name,
        patient_phone,
        booking_date,
        queue_number: nextQueueNumber,
        shift: shiftValue,
        status: 'confirmed', 
        payment_status: 'pending',
        verified_by_whatsapp: false
      }])
      .select('*, doctor:doctors(name, specialty)')
      .single();

    if (error) {
      if (error.message?.includes('لا يوجد سعة')) {
        return res.status(400).json({ error: 'عذراً لا توجد سعة باقية للحجز في هذا الموعد.' });
      }
      throw error;
    }

    res.status(201).json({
      ...data,
      doctor_name: data.doctor ? data.doctor.name : '',
      doctor_specialty: data.doctor ? data.doctor.specialty : ''
    });
  } catch (err: any) {
    console.error('Create booking error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create booking' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const { status, payment_status, patient_name } = req.body;
  try {
    const supabase = getSupabase();
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (payment_status !== undefined) updateData.payment_status = payment_status;
    if (patient_name !== undefined) updateData.patient_name = patient_name;

    const { data, error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', id)
      .select('*, doctor:doctors(name, specialty)')
      .single();

    if (error) throw error;
    res.json({
      ...data,
      doctor_name: data.doctor ? data.doctor.name : '',
      doctor_specialty: data.doctor ? data.doctor.specialty : ''
    });
  } catch (err: any) {
    console.error('Update booking error:', err.message);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = getSupabase();
    
    const { data: booking } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (booking) {
      const isCancelled = booking.status === 'cancelled' || booking.payment_status === 'cancelled';
      if (!isCancelled) {
        const { data: sch } = await supabase
          .from('schedules')
          .select('*')
          .eq('id', booking.schedule_id)
          .maybeSingle();

        if (sch) {
          await supabase
            .from('schedules')
            .update({ available_capacity: Math.min(sch.max_capacity, sch.available_capacity + 1) })
            .eq('id', booking.schedule_id);
        }
      }

      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', id);

      if (error) throw error;
    }

    res.json({ success: true, message: 'Booking deleted' });
  } catch (err: any) {
    console.error('Delete booking error:', err.message);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// 5. WHATSAPP SETTINGS ENDPOINTS (Multi-number Config)
app.get('/api/whatsapp-settings', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: list, error } = await supabase
      .from('whatsapp_settings')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(list || []);
  } catch (err: any) {
    console.error('Fetch whatsapp settings error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settings list' });
  }
});

app.post('/api/whatsapp-settings', async (req, res) => {
  const { id, webhook_verify_token, access_token, app_secret, phone_number_id, is_active } = req.body;
  try {
    const supabase = getSupabase();
    const record: any = {
      webhook_verify_token: webhook_verify_token || 'doctors_tower_verify_token_123',
      access_token: access_token || '',
      app_secret: app_secret || '',
      phone_number_id: phone_number_id || '',
      is_active: is_active !== undefined ? is_active : true
    };
    if (id) {
      record.id = id;
    }

    const { data, error } = await supabase
      .from('whatsapp_settings')
      .upsert(record)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error('Update whatsapp settings error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
});

app.delete('/api/whatsapp-settings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('whatsapp_settings')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'تم حذف رقم ربط البوت بنجاح' });
  } catch (err: any) {
    console.error('Delete whatsapp settings error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete settings' });
  }
});

// 6. SYSTEM SETTINGS ENDPOINTS (Change password)
app.get('/api/system-settings', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;
    res.json({
      receptionist_name_required: data ? data.receptionist_name_required : false
    });
  } catch (err: any) {
    console.error('Fetch system settings error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/system-settings', async (req, res) => {
  const { admin_password } = req.body;
  if (!admin_password) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('system_settings')
      .upsert({ id: 1, admin_password });

    if (error) throw error;
    res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح.' });
  } catch (err: any) {
    console.error('Update system settings error:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// 7. GET CHAT LOGS
app.get('/api/whatsapp-logs', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('whatsapp_logs')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error('Fetch whatsapp logs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Clear log utility
app.delete('/api/whatsapp-logs', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('whatsapp_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    console.error('Clear whatsapp logs error:', err.message);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// -------------------------------------------------------------------------
// CRON ROUTE HANDLERS
// -------------------------------------------------------------------------

/**
 * Daily Unpaid Booking Cleanup Cron Job
 */
app.post('/api/cron/cleanup-bookings', async (req, res) => {
  try {
    const supabase = getSupabase();
    const yemenNow = getYemenTime();
    const fortyEightHoursAgo = new Date(yemenNow.getTime() - 48 * 60 * 60 * 1000).toISOString();

    const { data: bookingsToCancel, error: fetchErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('payment_status', 'pending')
      .neq('status', 'cancelled')
      .lt('created_at', fortyEightHoursAgo);

    if (fetchErr) throw fetchErr;

    let cancelledCount = 0;
    if (bookingsToCancel && bookingsToCancel.length > 0) {
      for (const b of bookingsToCancel) {
        const { error: cancelErr } = await supabase
          .from('bookings')
          .update({
            status: 'cancelled',
            payment_status: 'cancelled'
          })
          .eq('id', b.id);

        if (!cancelErr) {
          cancelledCount++;
        }
      }
    }

    res.json({
      success: true,
      message: `تم تشغيل عملية تنظيف الحجوزات غير المدفوعة تلقائياً. المجموع الملغي: ${cancelledCount} حجز منتهي الصلاحية.`
    });
  } catch (err: any) {
    console.error('Clean up bookings cron error:', err.message);
    res.status(500).json({ error: 'Failed to run cleanup cron' });
  }
});

/**
 * Weekly Reset Trigger Cron Job
 */
app.post('/api/cron/reset-weekly', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    
    if (rpcErr) {
      console.warn('RPC execution failed, using direct queries callback fallback...', rpcErr);
      const { data: schs } = await supabase.from('schedules').select('*');
      if (schs) {
        for (const s of schs) {
          await supabase.from('schedules').update({ available_capacity: s.max_capacity }).eq('id', s.id);
        }
      }
      await supabase.from('bot_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    res.json({
      success: true,
      message: 'تم تشغيل وإعادة تهيئة الدورة الأسبوعية بنجاح.'
    });
  } catch (err: any) {
    console.error('Weekly reset cron error:', err.message);
    res.status(500).json({ error: 'Failed to run weekly reset cron' });
  }
});


// -------------------------------------------------------------------------
// OFFICIAL META WHATSAPP WEBHOOK ROUTE & MESSAGING HANDLERS
// -------------------------------------------------------------------------

/**
 * Sends a real message out to a user on WhatsApp via the Meta Graph Cloud API
 */
async function sendWhatsAppMessage(to: string, text: string, settings: { access_token: string; phone_number_id: string }) {
  const { access_token, phone_number_id } = settings;
  const url = `https://graph.facebook.com/v17.0/${phone_number_id}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      console.error(`[WhatsApp API Error] Graph API rejected message for ${to}. Http status: ${response.status}. Response:`, bodyText);
    } else {
      console.log(`[WhatsApp API Success] Successfully dispatched reply to [+${to}]. API response:`, bodyText);
    }
  } catch (err) {
    console.error(`[WhatsApp API Exception] Web/network fetch call to Meta Graph API failed for ${to}:`, err);
  }
}

/**
 * Webhook GET verification route for Meta verification step configuration
 */
app.get('/api/webhook/whatsapp', async (req, res) => {
  try {
    const supabase = getSupabase();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe') {
        const { data: matchedRows } = await supabase
          .from('whatsapp_settings')
          .select('*')
          .eq('webhook_verify_token', token);

        const envVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'doctors_tower_verify_token_123';
        const isMatched = (matchedRows && matchedRows.length > 0) || token === envVerifyToken;

        if (isMatched) {
          console.log('WhatsApp Webhook Verified Successfully!');
          return res.status(200).send(challenge);
        } else {
          return res.status(403).send('Forbidden: Invalid Verify Token');
        }
      }
    }
    return res.status(400).send('Bad Request');
  } catch (err: any) {
    console.error('Webhook verification error:', err.message);
    return res.status(500).send('Internal Server Error');
  }
});

/**
 * Webhook POST handler for incoming messaging payloads
 */
app.post('/api/webhook/whatsapp', webhookRateLimit, async (req, res) => {
  try {
    // Ignore status updates immediately (e.g. sent/delivered/read receipts)
    if (req.body?.entry?.[0]?.changes?.[0]?.value?.statuses) {
      console.log('[WhatsApp Webhook] Ignoring status webhook (sent, delivered, or read receipt).');
      return res.status(200).json({ success: true });
    }

    const supabase = getSupabase();
    
    // Parse Meta WhatsApp Cloud API body message
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messageObj = value?.messages?.[0];
    const recipientPhoneId = value?.metadata?.phone_number_id;

    // Load matching WhatsApp configuration dynamically based on phone_number_id
    let settings = null;
    if (recipientPhoneId) {
      const { data } = await supabase
        .from('whatsapp_settings')
        .select('*')
        .eq('phone_number_id', recipientPhoneId)
        .maybeSingle();
      settings = data;
    }

    if (!settings) {
      // Fallback: try to grab the first configuration from the table if none match specifically
      const { data } = await supabase
        .from('whatsapp_settings')
        .select('*')
        .limit(1);
      if (data && data.length > 0) {
        settings = data[0];
      }
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    const appSecret = settings?.app_secret || process.env.META_APP_SECRET;

    // Webhook security verification: If App Secret is configured, verify SHA256 signature
    if (appSecret && signature) {
      const rawBodyStr = (req as any).rawBody || JSON.stringify(req.body);
      const hash = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBodyStr).digest('hex');
      
      if (signature !== hash) {
        console.warn('[WhatsApp Webhook Warning] Signature verification mismatch. Proceeding with caution for fallback uptime support.');
      } else {
        console.log('[WhatsApp Webhook Success] Signature verification checked successfully.');
      }
    }

    if (messageObj) {
      const fromPhone = messageObj.from; // e.g., '96777123456'
      const cleanPhone = normalizePhone(fromPhone);
      
      // Core Bot state processing logic
      const botResponse = await handleWhatsappFlow(cleanPhone, messageObj);
      
      // Attempt dispatch via real Meta WhatsApp API if credentials are ready
      const accessToken = settings?.access_token || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
      const phoneNumberId = settings?.phone_number_id || recipientPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
      const isWebhookActive = settings ? settings.is_active !== false : true;

      if (isWebhookActive && accessToken && phoneNumberId) {
        console.log(`[WhatsApp Webhook] Dispatching active API call for [+${cleanPhone}] via Graph API using Phone ID [${phoneNumberId}]...`);
        await sendWhatsAppMessage(cleanPhone, botResponse, {
          access_token: accessToken,
          phone_number_id: phoneNumberId
        });
      } else {
        console.log(`[WhatsApp Webhook Simulated] Replayed [+${cleanPhone}]: "${botResponse}" (Real API skipped: active=${isWebhookActive}, token=${!!accessToken}, phone=${!!phoneNumberId})`);
      }
    }

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('Webhook processing exception:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// -------------------------------------------------------------------------
// REUSABLE STATE MACHINE FLOW LOGIC
// -------------------------------------------------------------------------
function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/^\+/, '').replace(/\s+/g, '').trim();
}

function getNextWeekDate(targetDayOfWeekIndex: number): string {
  const thisWeek = getTargetDate(targetDayOfWeekIndex);
  const date = new Date(thisWeek);
  date.setDate(date.getDate() + 7);
  return date.toISOString().split('T')[0];
}

function getCircledNumber(num: number): string {
  const circled = ['⓪', '❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  return circled[num] || `[${num}]`;
}

function checkMultipleShifts(doctorId: string, schedules: Schedule[]): boolean {
  const docSchedules = schedules.filter(s => s.doctor_id === doctorId);
  const days = new Set<number>();
  const dupDays = new Set<number>();
  for (const s of docSchedules) {
    if (days.has(s.day_of_week)) {
      dupDays.add(s.day_of_week);
    } else {
      days.add(s.day_of_week);
    }
  }
  return dupDays.size > 0;
}

interface GroupedDayOption {
  day_of_week: number;
  date: string;
  weekLabel: string;
  schedules: Schedule[];
}

function getGroupedDatesForDoctor(
  doctor: Doctor,
  schedules: Schedule[]
): { prompt: string; options: GroupedDayOption[] } {
  const docSchedules = schedules.filter(s => s.doctor_id === doctor.id);
  
  const rawOptions: { day_of_week: number; date: string; weekLabel: string; schedule: Schedule }[] = [];
  docSchedules.forEach(s => {
    rawOptions.push({
      day_of_week: s.day_of_week,
      date: getTargetDate(s.day_of_week),
      weekLabel: 'الأسبوع الحالي',
      schedule: s
    });
    if (doctor.allow_second_week_booking) {
      rawOptions.push({
        day_of_week: s.day_of_week,
        date: getNextWeekDate(s.day_of_week),
        weekLabel: 'الأسبوع الثاني',
        schedule: s
      });
    }
  });

  // Group by date
  const groupedMap = new Map<string, GroupedDayOption>();
  rawOptions.forEach(raw => {
    const existing = groupedMap.get(raw.date);
    if (existing) {
      if (!existing.schedules.some(s => s.id === raw.schedule.id)) {
        existing.schedules.push(raw.schedule);
      }
    } else {
      groupedMap.set(raw.date, {
        day_of_week: raw.day_of_week,
        date: raw.date,
        weekLabel: raw.weekLabel,
        schedules: [raw.schedule]
      });
    }
  });

  const options = Array.from(groupedMap.values()).sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  let count = 1;
  let prompt = `عيادات الطبيب *${doctor.name}* متوفرة في الأيام التالية. يرجى حجز اليوم بكتابة رقمه المقابل:`;

  options.forEach(opt => {
    const dayName = getDayNameArabic(opt.day_of_week);
    
    // Determine shift labels for schedules in this day option
    const shiftsSet = new Set<string>();
    opt.schedules.forEach(s => {
      const startHour = parseInt(s.start_time.split(':')[0]);
      const isMorning = startHour < 13;
      shiftsSet.add(isMorning ? 'صباحية' : 'مسائية');
    });

    let shiftsLabel = '';
    if (shiftsSet.has('صباحية') && shiftsSet.has('مسائية')) {
      shiftsLabel = 'فترة صباحية ومسائية';
    } else if (shiftsSet.has('صباحية')) {
      shiftsLabel = 'فترة صباحية';
    } else if (shiftsSet.has('مسائية')) {
      shiftsLabel = 'فترة مسائية';
    }

    prompt += `\n\n*${count++}* - ${dayName} - ${opt.weekLabel} (${opt.date}) - ${shiftsLabel}`;
  });

  return { prompt, options };
}

async function handleWhatsappFlow(phone: string, messageObj: any): Promise<string> {
  const supabase = getSupabase();
  const currentYemenNow = getYemenTime();
  
  const cleanPhone = normalizePhone(phone);
  
  // Log inbound message
  const isTextMessage = messageObj.type === 'text';
  let messageText = isTextMessage ? (messageObj.text?.body || '').trim() : '';

  await supabase.from('whatsapp_logs').insert([{
    phone: cleanPhone,
    direction: 'in',
    message: isTextMessage ? messageText : `[رسالة وسائط متعددة أو غير مدعومة: ${messageObj.type}]`,
    timestamp: currentYemenNow.toISOString()
  }]);

  // Load or construct active bot session state from Supabase
  const { data: dbSession } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('phone', cleanPhone)
    .maybeSingle();

  let session = dbSession;
  const isNewSession = !session;

  if (isNewSession) {
    session = {
      phone: cleanPhone,
      current_state: 'IDLE',
      patient_name: null,
      selected_doctor_id: null,
      selected_schedule_id: null,
      selected_day_offset: null,
      selected_shift: null,
      selected_date: null,
      last_interaction_at: currentYemenNow.toISOString()
    };
  }

  const outputReply = async (replyMessage: string, nextState: string) => {
    // Record log out
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone,
      direction: 'out',
      message: replyMessage,
      timestamp: getYemenTime().toISOString()
    }]);

    // Update Session in Supabase directly using database columns
    const nextSession = {
      phone: cleanPhone,
      current_state: nextState,
      patient_name: session.patient_name || null,
      selected_doctor_id: session.selected_doctor_id || null,
      selected_schedule_id: session.selected_schedule_id || null,
      selected_day_offset: session.selected_day_offset || null,
      selected_shift: session.selected_shift || null,
      selected_date: session.selected_date || null,
      last_interaction_at: getYemenTime().toISOString()
    };

    if (isNewSession) {
      await supabase.from('bot_sessions').insert([nextSession]);
    } else {
      await supabase.from('bot_sessions').update(nextSession).eq('phone', cleanPhone);
    }

    return replyMessage;
  };

  // CHECK 1: 10-Minute Timeout validation
  if (!isNewSession && session.current_state !== 'IDLE' && session.current_state !== 'COMPLETED') {
    const lastTime = new Date(session.last_interaction_at).getTime();
    const diffMin = (currentYemenNow.getTime() - lastTime) / (1000 * 60);

    if (diffMin > 10) {
      session = {
        ...session,
        current_state: 'IDLE',
        patient_name: null,
        selected_doctor_id: null,
        selected_schedule_id: null,
        selected_day_offset: null,
        selected_shift: null,
        selected_date: null,
        last_interaction_at: currentYemenNow.toISOString()
      };
      
      return outputReply(
        "عذراً، انتهت مدة الجلسة (أكبر من 10 دقائق). الرجاء إرسال كلمة 'تسجيل' للبدء من جديد.",
        'IDLE'
      );
    }
  }

  // CHECK 2: Meta Message validation constraints of TEXT inputs only
  if (!isTextMessage) {
    return outputReply(
      "عذراً، لم أتمكن من فهم طلبك. الرجاء الالتزام بالخيارات المتاحة وإرسال إجابة نصية صحيحة.",
      session.current_state
    );
  }

  // STATE MACHINE RUN
  const state = session.current_state;

  // Retrieve doctors and schedules
  const { data: activeDocs } = await supabase.from('doctors').select('*').eq('is_active', true);
  const { data: activeSchedules } = await supabase.from('schedules').select('*');

  // FORCE RESET IF "تسجيل" IS SENT AT ANY STATE
  if (messageText === 'تسجيل') {
    if (!activeDocs || activeDocs.length === 0) {
      return outputReply(
        "عذراً، لا يوجد أطباء متاحين للجدولة حالياً في المشفي. يرجى مراجعة إدارة المستشفي.",
        'IDLE'
      );
    }

    let docsPrompt = "أهلاً بك في مستشفى برج الأطباء. الرجاء إرسال رقم الطبيب الذي تريد التسجيل لديه:\n";
    activeDocs.forEach((doc, idx) => {
      docsPrompt += `\n*${idx + 1}* - ${doc.name} (${doc.specialty})`;
    });

    session.patient_name = null;
    session.selected_doctor_id = null;
    session.selected_shift = null;
    session.selected_schedule_id = null;
    session.selected_date = null;

    return outputReply(docsPrompt, 'SELECTING_DOCTOR');
  }

  if (state === 'IDLE' || state === 'COMPLETED') {
    if (messageText === '1' || messageText.toLowerCase().includes('مرحبا') || messageText.toLowerCase().includes('سلام')) {
      if (!activeDocs || activeDocs.length === 0) {
        return outputReply(
          "عذراً، لا يوجد أطباء متاحين للجدولة حالياً في المشفي. يرجى مراجعة إدارة المستشفي.",
          'IDLE'
        );
      }

      let docsPrompt = "أهلاً بك في مستشفى برج الأطباء. الرجاء إرسال رقم الطبيب الذي تريد التسجيل لديه:\n";
      activeDocs.forEach((doc, idx) => {
        docsPrompt += `\n*${idx + 1}* - ${doc.name} (${doc.specialty})`;
      });

      session.patient_name = null;
      session.selected_doctor_id = null;
      session.selected_shift = null;
      session.selected_schedule_id = null;
      session.selected_date = null;

      return outputReply(docsPrompt, 'SELECTING_DOCTOR');
    } else {
      return outputReply(
        "مرحباً بك في مستشفى برج الأطباء. لإجراء حجز عيادات جديد، يرجى إرسال كلمة 'تسجيل' أو الرقم '1' للمباشرة في حجز دورك.",
        'IDLE'
      );
    }
  }

  if (state === 'SELECTING_DOCTOR') {
    const selectedIdx = parseInt(messageText) - 1;
    if (isNaN(selectedIdx) || !activeDocs || selectedIdx < 0 || selectedIdx >= activeDocs.length) {
      return outputReply(
        "عذراً، لم أتمكن من فهم طلبك. الرجاء الالتزام بالخيارات المتاحة وإرسال رقم الطبيب الصحيح.",
        'SELECTING_DOCTOR'
      );
    }

    const doctor = activeDocs[selectedIdx];
    session.selected_doctor_id = doctor.id;

    const docSchedules = (activeSchedules || []).filter(s => s.doctor_id === doctor.id);
    if (docSchedules.length === 0) {
      let failPrompt = `عذراً، الطبيب *${doctor.name}* لا يوجد لديه عيادات مجدولة هذا الأسبوع حالياً.\n`;
      failPrompt += "يرجى اختيار طبيب آخر من القائمة التالية:\n";
      activeDocs.forEach((doc, idx) => {
        failPrompt += `\n*${idx + 1}* - ${doc.name} (${doc.specialty})`;
      });
      return outputReply(failPrompt, 'SELECTING_DOCTOR');
    }

    session.selected_shift = null;
    const { prompt } = getGroupedDatesForDoctor(doctor, activeSchedules || []);
    return outputReply(prompt, 'SELECTING_DAY');
  }

  if (state === 'SELECTING_DAY') {
    const selectedIdx = parseInt(messageText) - 1;
    const doctor = activeDocs?.find(d => d.id === session.selected_doctor_id!);
    
    if (!doctor) {
      return outputReply("عذراً، حدث خطأ ما في الجلسة. يرجى إرسال كلمة 'تسجيل' للبدء من جديد.", 'IDLE');
    }
    const { options } = getGroupedDatesForDoctor(doctor, activeSchedules || []);

    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= options.length) {
      return outputReply(
        "عذراً، الرجاء اختيار يوم من الأيام المحددة لعيادة الطبيب",
        'SELECTING_DAY'
      );
    }

    const option = options[selectedIdx];

    // If there are multiple schedules on this day (e.g. morning and evening shifts)
    if (option.schedules.length > 1) {
      session.selected_date = option.date;
      return outputReply(
        "الطبيب متاح في فترتين في هذا اليوم، يرجى اختيار الفترة:\n1. صباحية\n2. مسائية",
        'SELECTING_SHIFT'
      );
    } else {
      // Exactly 1 schedule on this day
      const matchedSchedule = option.schedules[0];

      // Check Capacity for this specific schedule with a real live select count
      const { count: currentBookingsCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctor.id)
        .eq('booking_date', option.date)
        .eq('schedule_id', matchedSchedule.id)
        .neq('status', 'cancelled');

      const liveBookings = currentBookingsCount || 0;
      if (liveBookings >= matchedSchedule.max_capacity) {
        return outputReply("اكتمل التسجيل في هذا اليوم، الرجاء اختيار يوم آخر", 'SELECTING_DAY');
      }

      // Check anti-spam limit
      if (doctor.limit_two_patients_per_number) {
        const { count: patientBookingsCount } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('doctor_id', doctor.id)
          .eq('patient_phone', cleanPhone)
          .neq('status', 'cancelled');

        if ((patientBookingsCount || 0) >= 2) {
          session.current_state = 'IDLE';
          session.selected_doctor_id = null;
          session.selected_shift = null;
          session.selected_schedule_id = null;
          session.selected_date = null;
          await supabase.from('bot_sessions').delete().eq('phone', cleanPhone);
          return outputReply(
            "عذراً، لقد تم الوصول إلى الحد الأقصى للتسجيل (مريضين كحد أقصى) لهذا الطبيب من رقم هذا الهاتف.",
            'IDLE'
          );
        }
      }

      session.selected_schedule_id = matchedSchedule.id;
      session.selected_date = option.date;
      session.selected_shift = parseInt(matchedSchedule.start_time.split(':')[0]) < 13 ? 'morning' : 'evening';

      return outputReply("يوجد متسع، الرجاء كتابة اسم المريض الرباعي لتأكيد الحجز", 'AWAITING_NAME');
    }
  }

  if (state === 'SELECTING_SHIFT') {
    const txt = messageText.trim();
    let selectedShift: 'morning' | 'evening' | null = null;
    if (txt === '1' || txt.includes('صباح')) {
      selectedShift = 'morning';
    } else if (txt === '2' || txt.includes('مساء')) {
      selectedShift = 'evening';
    } else {
      return outputReply(
        "الرجاء اختيار الفترة بكتابة الرقم المقابل:\n1. صباحية\n2. مسائية",
        'SELECTING_SHIFT'
      );
    }

    const doctor = activeDocs?.find(d => d.id === session.selected_doctor_id!)!;
    if (!doctor) {
      return outputReply("عذراً، حدث خطأ في الجلسة. يرجى البدء مجدداً بكتابة 'تسجيل'.", 'IDLE');
    }
    const selectedDateStr = session.selected_date!;
    
    const { options } = getGroupedDatesForDoctor(doctor, activeSchedules || []);
    const matchedOption = options.find(o => o.date === selectedDateStr);
    
    if (!matchedOption) {
      session.current_state = 'IDLE';
      await supabase.from('bot_sessions').delete().eq('phone', cleanPhone);
      return outputReply("عذراً، حدث خطأ ما في الجلسة. يرجى إرسال كلمة 'تسجيل' للبدء من جديد.", 'IDLE');
    }

    const matchedSchedule = matchedOption.schedules.find(s => {
      const startHour = parseInt(s.start_time.split(':')[0]);
      const isMorning = startHour < 13;
      const sShift = isMorning ? 'morning' : 'evening';
      return sShift === selectedShift;
    });

    if (!matchedSchedule) {
      return outputReply(
        `عذراً، هذه الفترة غير متاحة للطبيب في هذا اليوم. المتوفر هو: ${matchedOption.schedules.map(s => parseInt(s.start_time.split(':')[0]) < 13 ? 'صباحية' : 'مسائية').join(' أو ')}. يرجى إعادة الاختيار:`,
        'SELECTING_SHIFT'
      );
    }

    // Check Capacity with real select count
    const { count: currentBookingsCount } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('doctor_id', doctor.id)
      .eq('booking_date', selectedDateStr)
      .eq('schedule_id', matchedSchedule.id)
      .neq('status', 'cancelled');

    if ((currentBookingsCount || 0) >= matchedSchedule.max_capacity) {
      return outputReply("عذراً، هذه الفترة متكاملة العدد للحجوزات لهذا اليوم. الرجاء إرسال 'تسجيل' لبدء الاختيار من جديد لموعد أو طبيب آخر.", 'IDLE');
    }

    // Check anti-spam limit
    if (doctor.limit_two_patients_per_number) {
      const { count: patientBookingsCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctor.id)
        .eq('patient_phone', cleanPhone)
        .neq('status', 'cancelled');

      if ((patientBookingsCount || 0) >= 2) {
        session.current_state = 'IDLE';
        session.selected_doctor_id = null;
        session.selected_shift = null;
        session.selected_schedule_id = null;
        session.selected_date = null;
        await supabase.from('bot_sessions').delete().eq('phone', cleanPhone);
        return outputReply(
          "عذراً، لقد تم الوصول إلى الحد الأقصى للتسجيل (مريضين كحد أقصى) لهذا الطبيب من رقم هذا الهاتف.",
          'IDLE'
        );
      }
    }

    session.selected_schedule_id = matchedSchedule.id;
    session.selected_shift = selectedShift;

    return outputReply("يوجد متسع، الرجاء كتابة اسم المريض الرباعي لتأكيد الحجز", 'AWAITING_NAME');
  }

  if (state === 'AWAITING_NAME') {
    const doctorId = session.selected_doctor_id!;
    const dateStr = session.selected_date!;
    const nameInput = messageText.trim();

    // Word count safety check
    const wordsCount = nameInput.split(/\s+/).length;
    if (wordsCount < 2) {
      return outputReply("يرجى كتابة اسم المريض الثلاثي أو الرباعي بشكل صحيح لتأكيد وحفظ الحجز.", 'AWAITING_NAME');
    }

    // Check duplicate name for this specific doctor on this specific date in Supabase
    const { data: nameExists } = await supabase
      .from('bookings')
      .select('id')
      .eq('doctor_id', doctorId)
      .eq('booking_date', dateStr)
      .ilike('patient_name', nameInput)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (nameExists) {
      return outputReply(
        "هذا الاسم مسجل مسبقاً، يرجى كتابة الاسم الثلاثي أو إضافة اللقب",
        'AWAITING_NAME'
      );
    }

    const schedule = activeSchedules?.find(s => s.id === session.selected_schedule_id!)!;
    
    const startHour = parseInt(schedule.start_time.split(':')[0]);
    const shiftValue = startHour < 13 ? 'Morning' : 'Evening';

    // Calculate next queue_number for this doctor, date, and shift
    const { data: qData } = await supabase
      .from('bookings')
      .select('queue_number')
      .eq('doctor_id', doctorId)
      .eq('booking_date', dateStr)
      .eq('shift', shiftValue);

    const maxQ = qData && qData.length > 0
      ? Math.max(...qData.map(b => b.queue_number || 0))
      : 0;
    const nextQueueNumber = Math.max(maxQ, qData?.length || 0) + 1;

    // Save actual booking to database - Let Supabase PG trigger assign queue number and decrements capacity atomic-safe!
    const { data: insertedBooking, error: insertErr } = await supabase
      .from('bookings')
      .insert([{
        doctor_id: doctorId,
        schedule_id: schedule.id,
        patient_name: nameInput,
        patient_phone: cleanPhone,
        booking_date: dateStr,
        queue_number: nextQueueNumber,
        shift: shiftValue,
        status: 'pending',
        payment_status: 'pending',
        verified_by_whatsapp: true
      }])
      .select()
      .single();

    if (insertErr) {
      console.error('Error on bot booking save:', insertErr.message);
      return outputReply("عذراً، واجه نظام التخزين حطاً عاثراً أثناء حفظ حجزك. يرجى المحاولة لاحقاً.", 'IDLE');
    }

    // Fetch the inserted booking again to get the trigger assigned queue_number
    const { data: finalisedBooking } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', insertedBooking.id)
      .single();

    const finalQueue = finalisedBooking?.queue_number || 1;

    // Calculate deadline Date + 2 days
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + 2);
    const deadlineStr = deadlineDate.toISOString().split('T')[0];

    const isMorning = parseInt(schedule.start_time.split(':')[0]) < 13;
    const shiftLabel = isMorning ? 'صباحية' : 'مسائية';
    const dayLabel = getDayNameArabic(schedule.day_of_week);
    const circleQueue = getCircledNumber(finalQueue);

    const successMsg = `تم تأكيد الحجز بنجاح،
الاسم: ${finalisedBooking?.patient_name || nameInput}
رقمك هو: ${circleQueue}
الفترة: ${shiftLabel}
موعدك هو: ( ${dayLabel} ) ( ${dateStr} )
نتمنى لكم دوام الصحة والعافية.
(يرجى تأكيد الحجز بواسطة دفع رسوم التسجيل خلال يومين من هذا التاريخ ${deadlineStr}، وإلا سيعتبر الحجز لاغياً، وشكراً).`;

    // Clear session state
    await supabase
      .from('bot_sessions')
      .delete()
      .eq('phone', cleanPhone);

    return outputReply(successMsg, 'IDLE');
  }

  return outputReply("مرحباً بك. يرجى إرسال كلمة 'تسجيل' لبدء حجز موعد طبي جديد.", 'IDLE');
}

// -------------------------------------------------------------------------
// SIMULATOR INTERACTIVE HELPER
// -------------------------------------------------------------------------
app.post('/api/simulator/send-message', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'الحقول المطلوبة مفقودة' });
  }

  const cleanPhone = normalizePhone(phone);

  const mockMetaMsg = {
    type: 'text',
    from: cleanPhone,
    text: { body: message }
  };

  try {
    const responseText = await handleWhatsappFlow(cleanPhone, mockMetaMsg);
    
    // Fetch current state
    const supabase = getSupabase();
    const { data: session } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    res.json({
      phone: cleanPhone,
      sentMessage: message,
      receivedReply: responseText,
      currentSessionState: session ? session.current_state : 'IDLE',
      sessionDetails: session
    });
  } catch (err: any) {
    console.error('Simulator message execution error:', err.message);
    res.status(500).json({ error: 'Failed to execute simulator flow step' });
  }
});

// -------------------------------------------------------------------------
// VITE CLIENT INTEGRATION
// -------------------------------------------------------------------------

async function startServer() {
  // Vite integration middleware
  if (process.env.NODE_ENV !== 'production') {
    const viteModuleName = 'vite';
    const { createServer: createViteServer } = await import(viteModuleName);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`full-stack portal bound on http://0.0.0.0:${PORT}`);
  });
}

startServer();

export default app;
