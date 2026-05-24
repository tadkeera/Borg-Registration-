/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { DbState, Doctor, Schedule, Booking, WhatsAppLog, BotSession, BotState, BookingStatus, PaymentStatus } from './src/types';
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
const DB_FILE = path.join(process.cwd(), 'data', 'db.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(process.cwd(), 'data'))) {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
}

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
// DATABASE STORAGE ENGINE & SEEDING
// -------------------------------------------------------------------------
const defaultDb: DbState = {
  doctors: [],
  schedules: [],
  bookings: [],
  whatsapp_settings: {
    id: 1,
    webhook_verify_token: 'doctors_tower_verify_token_123',
    access_token: '',
    app_secret: '',
    phone_number_id: '',
    is_active: true
  },
  system_settings: {
    id: 1,
    receptionist_name_required: false,
    admin_password: '123'
  },
  bot_sessions: {},
  whatsapp_logs: [],
  users: [
    { id: 'u-tadkeera', username: 'tadkeera@gmail.com', password: 'WALEED770@', role: 'admin', employee_name: 'مدير تذكرة (Tadkeera Admin)' },
    { id: 'u-1', username: 'admin', password: '123', role: 'admin', employee_name: 'مدير النظام الرئيسي' },
    { id: 'u-2', username: 'receptionist', password: 'receptionist', role: 'receptionist', employee_name: 'موظف الاستقبال الافتراضي' }
  ]
};

// Initialize and Seed JSON Database file - Force a clean start as requested
fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');

// Helper to auto sync configuration user with Supabase Auth if credentials exist
async function syncAdminUserToSupabase(email: string, pass: string) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return; // Supabase not configured yet
    const supabase = getSupabase();
    
    // Check if user has auth module available or write a user to Auth
    // Since service role key can create users directly, we can try using admin API:
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
      if (!listError && listData && listData.users) {
        const userExists = listData.users.some((u: any) => u.email === email);
        if (!userExists) {
          console.log(`[SupabaseSync] Creating admin user ${email} in Supabase Auth via admin API...`);
          await supabase.auth.admin.createUser({
            email,
            password: pass,
            email_confirm: true,
            user_metadata: { role: 'admin', name: 'مدير تذكرة (Tadkeera Admin)' }
          });
        }
      }
    } else {
      // Direct signup fallback for Anon Key
      console.log(`[SupabaseSync] Attempting regular signup fallback for ${email}...`);
      await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: { role: 'admin', name: 'مدير تذكرة (Tadkeera Admin)' }
        }
      });
    }
  } catch (err) {
    console.warn('[SupabaseSync] Skipping automated Supabase Auth sync (expected if DB schema differs or credentials lack privileges):', err);
  }
}

// Run initial Sync in background
syncAdminUserToSupabase('tadkeera@gmail.com', 'WALEED770@').catch(() => {});

function readDb(): DbState {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const db = JSON.parse(data);
    if (!db.users) {
      db.users = [
        { id: 'u-tadkeera', username: 'tadkeera@gmail.com', password: 'WALEED770@', role: 'admin', employee_name: 'مدير تذكرة (Tadkeera Admin)' },
        { id: 'u-1', username: 'admin', password: '123', role: 'admin', employee_name: 'مدير النظام الرئيسي' },
        { id: 'u-2', username: 'receptionist', password: 'receptionist', role: 'receptionist', employee_name: 'موظف الاستقبال الافتراضي' }
      ];
    } else {
      const hasTadkeera = db.users.some((u: any) => u.username.trim().toLowerCase() === 'tadkeera@gmail.com');
      if (!hasTadkeera) {
        db.users.push({ id: 'u-tadkeera', username: 'tadkeera@gmail.com', password: 'WALEED770@', role: 'admin', employee_name: 'مدير تذكرة (Tadkeera Admin)' });
      }
      db.users = db.users.map((u: any) => {
        if (!u.employee_name) {
          u.employee_name = u.role === 'admin' ? (u.username === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : 'مدير النظام الرئيسي') : 'موظف الاستقبال الافتراضي';
        }
        return u;
      });
    }
    return db;
  } catch (err) {
    console.error('Error reading database file, returning default schema:', err);
    return defaultDb;
  }
}

function writeDb(db: DbState) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write database file:', err);
  }
}

// -------------------------------------------------------------------------
// SERVER MIDDLEWARE SETUP
// -------------------------------------------------------------------------
app.use(express.json());

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
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(405).json({ success: false, error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  }

  const db = readDb();
  const users = db.users || [];

  const foundUser = users.find(
    u => u.username.trim().toLowerCase() === username.trim().toLowerCase() && u.password.trim() === password.trim()
  );

  if (!foundUser) {
    return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
  }

  const empName = foundUser.employee_name || foundUser.username;

  return res.json({
    success: true,
    role: foundUser.role,
    token: `${foundUser.role}-${foundUser.id}`,
    receptionistName: empName
  });
});

// Dynamic User Management API
app.get('/api/users', (req, res) => {
  const db = readDb();
  const usersList = (db.users || []).map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    employee_name: u.employee_name || u.username,
    created_at: u.created_at
  }));
  res.json(usersList);
});

app.post('/api/users', (req, res) => {
  const { username, password, role, employee_name } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور واختيار الصلاحية' });
  }

  const db = readDb();
  if (!db.users) db.users = [];

  const exists = db.users.some(u => u.username.trim().toLowerCase() === username.trim().toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
  }

  const newUser = {
    id: `user-${Date.now()}`,
    username: username.trim(),
    password: password.trim(),
    role: role,
    employee_name: employee_name ? employee_name.trim() : (role === 'admin' ? 'مدير نظام جديد' : 'موظف استقبال جديد'),
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDb(db);

  res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role, employee_name: newUser.employee_name });
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (!db.users) db.users = [];

  const userToDelete = db.users.find(u => u.id === id);
  if (!userToDelete) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }

  const admins = db.users.filter(u => u.role === 'admin');
  if (userToDelete.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'لا يمكن حذف آخر مدير نظام للوحة التحكم لتفادي غلق الحساب.' });
  }

  db.users = db.users.filter(u => u.id !== id);
  writeDb(db);
  res.json({ success: true });
});

// 2. DOCTORS ENDPOINTS (CRUD)
app.get('/api/doctors', (req, res) => {
  const db = readDb();
  res.json(db.doctors);
});

app.post('/api/doctors', (req, res) => {
  const { name, specialty, is_active, allow_second_week_booking, limit_two_patients_per_number } = req.body;
  const db = readDb();
  const newDoc: Doctor = {
    id: `doc-${Date.now()}`,
    name,
    specialty,
    is_active: is_active !== undefined ? is_active : true,
    allow_second_week_booking: allow_second_week_booking !== undefined ? !!allow_second_week_booking : false,
    limit_two_patients_per_number: limit_two_patients_per_number !== undefined ? !!limit_two_patients_per_number : false
  };
  db.doctors.push(newDoc);
  writeDb(db);
  res.status(201).json(newDoc);
});

app.put('/api/doctors/:id', (req, res) => {
  const { id } = req.params;
  const { name, specialty, is_active, allow_second_week_booking, limit_two_patients_per_number } = req.body;
  const db = readDb();
  const idx = db.doctors.findIndex(d => d.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Doctor not found' });
  
  db.doctors[idx] = {
    ...db.doctors[idx],
    name: name !== undefined ? name : db.doctors[idx].name,
    specialty: specialty !== undefined ? specialty : db.doctors[idx].specialty,
    is_active: is_active !== undefined ? is_active : db.doctors[idx].is_active,
    allow_second_week_booking: allow_second_week_booking !== undefined ? !!allow_second_week_booking : !!db.doctors[idx].allow_second_week_booking,
    limit_two_patients_per_number: limit_two_patients_per_number !== undefined ? !!limit_two_patients_per_number : !!db.doctors[idx].limit_two_patients_per_number
  };
  writeDb(db);
  res.json(db.doctors[idx]);
});

app.delete('/api/doctors/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.doctors = db.doctors.filter(d => d.id !== id);
  db.schedules = db.schedules.filter(s => s.doctor_id !== id);
  db.bookings = db.bookings.filter(b => b.doctor_id !== id);
  writeDb(db);
  res.json({ success: true, message: 'Doctor deleted' });
});

// 3. SCHEDULES ENDPOINTS (CRUD)
app.get('/api/schedules', (req, res) => {
  const db = readDb();
  const schedulesWithJoins = db.schedules.map(sch => {
    const doc = db.doctors.find(d => d.id === sch.doctor_id);
    return {
      ...sch,
      doctor_name: doc ? doc.name : 'طبيب محذوف',
      doctor_specialty: doc ? doc.specialty : ''
    };
  });
  res.json(schedulesWithJoins);
});

app.post('/api/schedules', (req, res) => {
  const { doctor_id, day_of_week, max_capacity, start_time: body_start, end_time: body_end, shift } = req.body;
  const db = readDb();
  
  // Valid working days constraint Sat-Thu (0-5)
  if (day_of_week < 0 || day_of_week > 5) {
    return res.status(400).json({ error: 'عذراً، الجمعة يوم إجازة رسمي ولا بمكن الإضافة ضمنه.' });
  }

  // Map shift to start and end times
  const start_time = body_start || (shift === 'evening' ? '15:00' : '09:00');
  const end_time = body_end || (shift === 'evening' ? '19:00' : '13:00');

  // Check unique constraints: (doctor_id, day_of_week, start_time)
  const isDuplicate = db.schedules.some(s => 
    s.doctor_id === doctor_id && 
    s.day_of_week === parseInt(day_of_week) && 
    s.start_time === start_time
  );
  if (isDuplicate) {
    return res.status(400).json({ error: 'عذراً، هذا الطبيب لديه عيادة مجدولة بالفعل في نفس هذه الفترة (الصباحية أو المسائية) في هذا اليوم.' });
  }

  const capacity = parseInt(max_capacity) || 15;
  const newSch: Schedule = {
    id: `sch-${Date.now()}`,
    doctor_id,
    day_of_week: parseInt(day_of_week),
    max_capacity: capacity,
    available_capacity: capacity,
    start_time,
    end_time
  };
  db.schedules.push(newSch);
  writeDb(db);
  
  const doc = db.doctors.find(d => d.id === doctor_id);
  res.status(201).json({
    ...newSch,
    doctor_name: doc ? doc.name : '',
    doctor_specialty: doc ? doc.specialty : ''
  });
});

app.put('/api/schedules/:id', (req, res) => {
  const { id } = req.params;
  const { max_capacity, start_time, end_time } = req.body;
  const db = readDb();
  const idx = db.schedules.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Schedule not found' });
  
  const oldMax = db.schedules[idx].max_capacity;
  const newMax = max_capacity !== undefined ? parseInt(max_capacity) : oldMax;
  const capDiff = newMax - oldMax;
  
  // Adjust available capacity based on the difference
  const nextAvailable = Math.max(0, db.schedules[idx].available_capacity + capDiff);

  db.schedules[idx] = {
    ...db.schedules[idx],
    max_capacity: newMax,
    available_capacity: nextAvailable,
    start_time: start_time || db.schedules[idx].start_time,
    end_time: end_time || db.schedules[idx].end_time
  };
  writeDb(db);
  res.json(db.schedules[idx]);
});

app.delete('/api/schedules/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.schedules = db.schedules.filter(s => s.id !== id);
  db.bookings = db.bookings.filter(b => b.schedule_id !== id);
  writeDb(db);
  res.json({ success: true, message: 'Schedule deleted' });
});

// 4. BOOKINGS ENDPOINTS (CRUD)
app.get('/api/bookings', (req, res) => {
  const db = readDb();
  const bookingsWithJoins = db.bookings.map(b => {
    const doc = db.doctors.find(d => d.id === b.doctor_id);
    return {
      ...b,
      doctor_name: doc ? doc.name : 'طبيب محذوف',
      doctor_specialty: doc ? doc.specialty : ''
    };
  });
  res.json(bookingsWithJoins);
});

// Add a direct Dashboard manually booked patient
app.post('/api/bookings', (req, res) => {
  const { doctor_id, schedule_id, patient_name, patient_phone, booking_date } = req.body;
  const db = readDb();
  
  // Find schedule
  const schIdx = db.schedules.findIndex(s => s.id === schedule_id);
  if (schIdx === -1) return res.status(404).json({ error: 'Schedule not found' });
  
  const sch = db.schedules[schIdx];
  if (sch.available_capacity <= 0) {
    return res.status(400).json({ error: 'عذراً لا توجد سعة باقية للحجز في هذا الموعد.' });
  }

  // Calculate sequential queue number for doctor and date
  const dateBookings = db.bookings.filter(b => b.doctor_id === doctor_id && b.booking_date === booking_date);
  const nextQueue = dateBookings.length > 0 ? Math.max(...dateBookings.map(b => b.queue_number)) + 1 : 1;

  // Check double/duplicate booking helper constraint
  const doubleBooked = db.bookings.some(b => b.patient_phone === patient_phone && b.booking_date === booking_date && b.status !== 'cancelled');
  if (doubleBooked) {
    return res.status(400).json({ error: 'عذراً، هذا المريض مسجل بالفعل في حجز نشط آخر لهذا اليوم.' });
  }

  const newBooking: Booking = {
    id: `book-${Date.now()}`,
    doctor_id,
    schedule_id,
    patient_name,
    patient_phone,
    booking_date,
    queue_number: nextQueue,
    status: 'confirmed', // Manually added are approved
    payment_status: 'pending', // Starts pending payment
    verified_by_whatsapp: false,
    created_at: getYemenTime().toISOString()
  };

  db.bookings.push(newBooking);
  db.schedules[schIdx].available_capacity -= 1;
  writeDb(db);

  const doc = db.doctors.find(d => d.id === doctor_id);
  res.status(201).json({
    ...newBooking,
    doctor_name: doc ? doc.name : '',
    doctor_specialty: doc ? doc.specialty : ''
  });
});

app.put('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { status, payment_status, patient_name } = req.body;
  const db = readDb();
  const idx = db.bookings.findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  
  const oldBooking = db.bookings[idx];
  
  // Manage capacity adjustment logic
  let capacityAdjust = 0;
  
  const wasCancelled = oldBooking.status === 'cancelled' || oldBooking.payment_status === 'cancelled';
  const isCancelledNow = status === 'cancelled' || payment_status === 'cancelled';

  if (!wasCancelled && isCancelledNow) {
    // Increment capacity (freed resource)
    capacityAdjust = 1;
  } else if (wasCancelled && !isCancelledNow) {
    // Decrement capacity
    capacityAdjust = -1;
  }

  db.bookings[idx] = {
    ...db.bookings[idx],
    patient_name: patient_name !== undefined ? patient_name : oldBooking.patient_name,
    status: status !== undefined ? status : oldBooking.status,
    payment_status: payment_status !== undefined ? payment_status : oldBooking.payment_status
  };

  if (capacityAdjust !== 0) {
    const schIdx = db.schedules.findIndex(s => s.id === oldBooking.schedule_id);
    if (schIdx !== -1) {
      db.schedules[schIdx].available_capacity = Math.max(
        0,
        Math.min(
          db.schedules[schIdx].max_capacity,
          db.schedules[schIdx].available_capacity + capacityAdjust
        )
      );
    }
  }

  writeDb(db);
  
  const doc = db.doctors.find(d => d.id === db.bookings[idx].doctor_id);
  res.json({
    ...db.bookings[idx],
    doctor_name: doc ? doc.name : '',
    doctor_specialty: doc ? doc.specialty : ''
  });
});

app.delete('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const booking = db.bookings.find(b => b.id === id);
  
  if (booking) {
    // If deleted booking was active, free capacity
    const isCancelled = booking.status === 'cancelled' || booking.payment_status === 'cancelled';
    if (!isCancelled) {
      const schIdx = db.schedules.findIndex(s => s.id === booking.schedule_id);
      if (schIdx !== -1) {
        db.schedules[schIdx].available_capacity = Math.min(
          db.schedules[schIdx].max_capacity,
          db.schedules[schIdx].available_capacity + 1
        );
      }
    }
    db.bookings = db.bookings.filter(b => b.id !== id);
    writeDb(db);
  }
  
  res.json({ success: true, message: 'Booking deleted' });
});

// 5. WHATSAPP SETTINGS ENDPOINTS
app.get('/api/whatsapp-settings', (req, res) => {
  const db = readDb();
  res.json(db.whatsapp_settings);
});

app.post('/api/whatsapp-settings', (req, res) => {
  const { webhook_verify_token, access_token, app_secret, phone_number_id, is_active } = req.body;
  const db = readDb();
  db.whatsapp_settings = {
    ...db.whatsapp_settings,
    webhook_verify_token: webhook_verify_token !== undefined ? webhook_verify_token : db.whatsapp_settings.webhook_verify_token,
    access_token: access_token !== undefined ? access_token : db.whatsapp_settings.access_token,
    app_secret: app_secret !== undefined ? app_secret : db.whatsapp_settings.app_secret,
    phone_number_id: phone_number_id !== undefined ? phone_number_id : db.whatsapp_settings.phone_number_id,
    is_active: is_active !== undefined ? is_active : db.whatsapp_settings.is_active
  };
  writeDb(db);
  res.json(db.whatsapp_settings);
});

// 6. SYSTEM SETTINGS ENDPOINTS (Change password)
app.get('/api/system-settings', (req, res) => {
  const db = readDb();
  // Safe return: omit Password from JSON response to clients
  res.json({
    receptionist_name_required: db.system_settings.receptionist_name_required
  });
});

app.post('/api/system-settings', (req, res) => {
  const { admin_password } = req.body;
  if (!admin_password) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
  
  const db = readDb();
  db.system_settings.admin_password = admin_password;
  writeDb(db);
  res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح.' });
});

// 7. GET CHAT LOGS
app.get('/api/whatsapp-logs', (req, res) => {
  const db = readDb();
  // Sort logs by timestamp desc
  const sorted = [...db.whatsapp_logs].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(sorted);
});

// Clear log utility
app.delete('/api/whatsapp-logs', (req, res) => {
  const db = readDb();
  db.whatsapp_logs = [];
  writeDb(db);
  res.json({ success: true });
});

// -------------------------------------------------------------------------
// CRON ROUTE HANDLERS
// -------------------------------------------------------------------------

/**
 * Daily Unpaid Booking Cleanup Cron Job
 * Matches requirement: Cleanup bookings where payment_status is 'pending' AND 48 hours have passed since booking creation date.
 */
app.post('/api/cron/cleanup-bookings', (req, res) => {
  const db = readDb();
  const yemenNow = getYemenTime();
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;
  let cancelledCount = 0;

  db.bookings = db.bookings.map(booking => {
    if (booking.payment_status === 'pending' && booking.status !== 'cancelled') {
      const createdTime = new Date(booking.created_at || booking.booking_date).getTime();
      const diffMs = yemenNow.getTime() - createdTime;

      if (diffMs > fortyEightHoursMs) {
        cancelledCount++;
        // Update booking to cancelled
        const updated = {
          ...booking,
          status: 'cancelled' as BookingStatus,
          payment_status: 'cancelled' as PaymentStatus
        };
        
        // Restore schedule capacity
        const schIdx = db.schedules.findIndex(s => s.id === booking.schedule_id);
        if (schIdx !== -1) {
          db.schedules[schIdx].available_capacity = Math.min(
            db.schedules[schIdx].max_capacity,
            db.schedules[schIdx].available_capacity + 1
          );
        }
        return updated;
      }
    }
    return booking;
  });

  if (cancelledCount > 0) {
    writeDb(db);
  }

  res.json({
    success: true,
    message: `تم تشغيل عملية تنظيف الحجوزات غير المدفوعة تلقائياً. المجموع الملغي: ${cancelledCount} حجز منتهي الصلاحية (مر عليها أكثر من 48 ساعة).`
  });
});

/**
 * Weekly Reset Trigger Cron Job
 * configured via vercel.json / Thursday 10:00 PM Yemen Time.
 * Resets capacities back to max, clear bot sessions to start new week fresh.
 */
app.post('/api/cron/reset-weekly', (req, res) => {
  const db = readDb();
  
  // Reset all capacities
  db.schedules = db.schedules.map(sch => ({
    ...sch,
    available_capacity: sch.max_capacity
  }));

  // Clear running bot sessions
  const activeSessionKeysCount = Object.keys(db.bot_sessions).length;
  db.bot_sessions = {};

  writeDb(db);

  res.json({
    success: true,
    message: `تم تشغيل وإعادة تهيئة الدورة الأسبوعية بنجاح. الاستعادة لـ ${db.schedules.length} جداول أطباء، وتصفير ${activeSessionKeysCount} جلسات حجز جارية.`
  });
});


// -------------------------------------------------------------------------
// OFFICIAL META WHATSAPP WEBHOOK ROUTE
// -------------------------------------------------------------------------

/**
 * Webhook GET verification route for Meta verification step configuration
 */
app.get('/api/webhook/whatsapp', (req, res) => {
  const db = readDb();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = db.whatsapp_settings.webhook_verify_token || process.env.WHATSAPP_VERIFY_TOKEN || 'doctors_tower_verify_token_123';

  if (mode && token) {
    if (mode === 'subscribe' && token === expectedToken) {
      console.log('WhatsApp Webhook Verified Successfully!');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Forbidden: Invalid Verify Token');
    }
  }
  return res.status(400).send('Bad Request');
});

/**
 * Webhook POST handler for incoming messaging payloads
 */
app.post('/api/webhook/whatsapp', webhookRateLimit, (req, res) => {
  const db = readDb();
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = db.whatsapp_settings.app_secret || process.env.META_APP_SECRET;

  // Webhook security verification: If App Secret is configured, verify SHA256 signature
  if (appSecret && signature) {
    const backupSecret = appSecret;
    const bodyStr = JSON.stringify(req.body);
    const hash = 'sha256=' + crypto.createHmac('sha256', backupSecret).update(bodyStr).digest('hex');
    
    if (signature !== hash) {
      console.error('Invalid signature webhook payload warning.');
      return res.status(401).send('Signature Verification Failed');
    }
  }

  // Parse Meta WhatsApp Cloud API body message
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messageObj = value?.messages?.[0];

  if (messageObj) {
    const fromPhone = messageObj.from; // e.g., '96777123456'
    
    // Core Bot state processing logic
    const botResponse = handleWhatsappFlow(fromPhone, messageObj);
    
    // In actual setup, we trigger HTTPS request to Meta Graph API here
    // axios.post(`https://graph.facebook.com/v17.0/${db.whatsapp_settings.phone_number_id}/messages`...)
    console.log(`Webhook Bot Action: To [+${fromPhone}] -> Reply: "${botResponse}"`);
  }

  res.status(200).json({ success: true });
});


// -------------------------------------------------------------------------
// REUSABLE STATE MACHINE FLOW LOGIC
// -------------------------------------------------------------------------
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

function getDatesPromptForDoctor(
  doctor: Doctor,
  shift: 'morning' | 'evening' | null,
  schedules: Schedule[],
  bookings: Booking[]
): { prompt: string; options: { schedule: Schedule; date: string }[] } {
  const docSchedules = schedules.filter(s => s.doctor_id === doctor.id);
  
  const filtered = docSchedules.filter(s => {
    if (!shift) return true;
    const startHour = parseInt(s.start_time.split(':')[0]);
    const isMorning = startHour < 13;
    return shift === 'morning' ? isMorning : !isMorning;
  }).sort((a,b) => a.day_of_week - b.day_of_week);

  const options: { schedule: Schedule; date: string }[] = [];
  let count = 1;
  let prompt = `عيادات الطبيب *${doctor.name}* متوفرة في الأيام التالية. يرجى حجز اليوم بكتابة رقمه المقابل:`;
  
  filtered.forEach(s => {
    const dayName = getDayNameArabic(s.day_of_week);
    const date1 = getTargetDate(s.day_of_week);
    
    // Calculate available capacity for date1
    const bkCount1 = bookings.filter(b => b.doctor_id === doctor.id && b.booking_date === date1 && b.status !== 'cancelled').length;
    const cap1 = Math.max(0, s.max_capacity - bkCount1);
    
    options.push({ schedule: s, date: date1 });
    prompt += `\n\n*${count++}* - ${dayName} - الأسبوع الحالي (${date1}) [المقاعد المتبقية: ${cap1}/${s.max_capacity}]`;

    if (doctor.allow_second_week_booking) {
      const date2 = getNextWeekDate(s.day_of_week);
      const bkCount2 = bookings.filter(b => b.doctor_id === doctor.id && b.booking_date === date2 && b.status !== 'cancelled').length;
      const cap2 = Math.max(0, s.max_capacity - bkCount2);
      
      options.push({ schedule: s, date: date2 });
      prompt += `\n*${count++}* - ${dayName} - الأسبوع الثاني (${date2}) [المقاعد المتبقية: ${cap2}/${s.max_capacity}]`;
    }
  });
  
  return { prompt, options };
}

function handleWhatsappFlow(phone: string, messageObj: any): string {
  const db = readDb();
  const currentYemenNow = getYemenTime();
  
  // Log inbound message
  const isTextMessage = messageObj.type === 'text';
  let messageText = isTextMessage ? (messageObj.text?.body || '').trim() : '';

  const incomingLog: WhatsAppLog = {
    id: `log-${Date.now()}-in`,
    phone,
    direction: 'in',
    message: isTextMessage ? messageText : `[رسالة وسائط متعددة أو غير مدعومة: ${messageObj.type}]`,
    timestamp: currentYemenNow.toISOString()
  };
  db.whatsapp_logs.push(incomingLog);

  // Load or construct active bot session state
  let session: BotSession = db.bot_sessions[phone];
  const isNewSession = !session;

  if (isNewSession) {
    session = {
      id: `sess-${Date.now()}`,
      phone,
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

  const outputReply = (replyMessage: string, nextState: BotState) => {
    // Record log out
    const outgoingLog: WhatsAppLog = {
      id: `log-${Date.now()}-out`,
      phone,
      direction: 'out',
      message: replyMessage,
      timestamp: getYemenTime().toISOString()
    };
    db.whatsapp_logs.push(outgoingLog);

    // Update Session
    session.current_state = nextState;
    session.last_interaction_at = getYemenTime().toISOString();
    db.bot_sessions[phone] = session;

    writeDb(db);
    return replyMessage;
  };

  // CHECK 1: 10-Minute Timeout validation
  if (!isNewSession && session.current_state !== 'IDLE' && session.current_state !== 'COMPLETED') {
    const lastTime = new Date(session.last_interaction_at).getTime();
    const diffMin = (currentYemenNow.getTime() - lastTime) / (1000 * 60);

    if (diffMin > 10) {
      // CLEAR State and trigger timeout feedback
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

  if (state === 'IDLE' || state === 'COMPLETED') {
    if (messageText === 'تسجيل' || messageText === '1' || messageText.toLowerCase().includes('مرحبا') || messageText.toLowerCase().includes('سلام')) {
      const activeDocs = db.doctors.filter(d => d.is_active);
      if (activeDocs.length === 0) {
        return outputReply(
          "عذراً، لا يوجد أطباء متاحين للجدولة حالياً في المشفي. يرجى مراجعة إدارة المستشفي.",
          'IDLE'
        );
      }

      let docsPrompt = "أهلاً بك في مستشفى برج الأطباء. الرجاء إرسال رقم الطبيب الذي تريد التسجيل لديه:\n";
      activeDocs.forEach((doc, idx) => {
        docsPrompt += `\n*${idx + 1}* - ${doc.name} (${doc.specialty})`;
      });

      // Reset session values for selection clean slate
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
    const activeDocs = db.doctors.filter(d => d.is_active);

    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= activeDocs.length) {
      return outputReply(
        "عذراً، لم أتمكن من فهم طلبك. الرجاء الالتزام بالخيارات المتاحة وإرسال رقم الطبيب الصحيح.",
        'SELECTING_DOCTOR'
      );
    }

    const doctor = activeDocs[selectedIdx];
    session.selected_doctor_id = doctor.id;

    const docSchedules = db.schedules.filter(s => s.doctor_id === doctor.id);
    if (docSchedules.length === 0) {
      let failPrompt = `عذراً، الطبيب *${doctor.name}* لا يوجد لديه عيادات مجدولة هذا الأسبوع حالياً.\n`;
      failPrompt += "يرجى اختيار طبيب آخر من القائمة التالية:\n";
      activeDocs.forEach((doc, idx) => {
        failPrompt += `\n*${idx + 1}* - ${doc.name} (${doc.specialty})`;
      });
      return outputReply(failPrompt, 'SELECTING_DOCTOR');
    }

    // Step 2: Check multi shift on same day
    const hasMultipleShifts = checkMultipleShifts(doctor.id, db.schedules);
    if (hasMultipleShifts) {
      session.selected_shift = null;
      return outputReply(
        "الطبيب متاح في فترتين، يرجى اختيار الفترة:\n1. صباحية\n2. مسائية",
        'SELECTING_SHIFT'
      );
    } else {
      // Skip to Day selection
      session.selected_shift = null;
      const { prompt } = getDatesPromptForDoctor(doctor, null, db.schedules, db.bookings);
      return outputReply(prompt, 'SELECTING_DAY');
    }
  }

  if (state === 'SELECTING_SHIFT') {
    const txt = messageText.trim();
    if (txt === '1' || txt.includes('صباح')) {
      session.selected_shift = 'morning';
    } else if (txt === '2' || txt.includes('مساء')) {
      session.selected_shift = 'evening';
    } else {
      return outputReply(
        "الطبيب متاح في فترتين، يرجى اختيار الفترة:\n1. صباحية\n2. مسائية",
        'SELECTING_SHIFT'
      );
    }

    const doctor = db.doctors.find(d => d.id === session.selected_doctor_id!)!;
    const { prompt } = getDatesPromptForDoctor(doctor, session.selected_shift, db.schedules, db.bookings);
    return outputReply(prompt, 'SELECTING_DAY');
  }

  if (state === 'SELECTING_DAY') {
    const selectedIdx = parseInt(messageText) - 1;
    const doctor = db.doctors.find(d => d.id === session.selected_doctor_id!)!;
    
    const { options } = getDatesPromptForDoctor(doctor, session.selected_shift, db.schedules, db.bookings);

    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= options.length) {
      return outputReply(
        "عذراً، الرجاء اختيار يوم من الأيام المحددة لعيادة الطبيب",
        'SELECTING_DAY'
      );
    }

    const option = options[selectedIdx];

    // Constraint B (Capacity Check)
    const currentBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.booking_date === option.date && b.status !== 'cancelled').length;
    if (currentBookings >= option.schedule.max_capacity) {
      return outputReply("اكتمل التسجيل في هذا اليوم، الرجاء اختيار يوم آخر", 'SELECTING_DAY');
    }

    // Constraint C (Anti-Spam / Limit Check)
    if (doctor.limit_two_patients_per_number) {
      const patientBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.patient_phone === phone && b.status !== 'cancelled').length;
      if (patientBookings >= 2) {
        // Reset state and reply apology
        session.current_state = 'IDLE';
        session.selected_doctor_id = null;
        session.selected_shift = null;
        session.selected_schedule_id = null;
        session.selected_date = null;
        db.bot_sessions[phone] = session;
        writeDb(db);
        return outputReply(
          "عذراً، لقد تم الوصول إلى الحد الأقصى للتسجيل (مريضين كحد أقصى) لهذا الطبيب من رقم هذا الهاتف.",
          'IDLE'
        );
      }
    }

    // Passed! Go to AWAITING_NAME
    session.selected_schedule_id = option.schedule.id;
    session.selected_date = option.date;

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

    // Check duplicate name for this specific doctor on this specific date
    const nameExists = db.bookings.some(b => 
      b.doctor_id === doctorId && 
      b.booking_date === dateStr && 
      b.patient_name.trim().toLowerCase() === nameInput.toLowerCase() && 
      b.status !== 'cancelled'
    );

    if (nameExists) {
      return outputReply(
        "هذا الاسم مسجل مسبقاً، يرجى كتابة الاسم الثلاثي أو إضافة اللقب",
        'AWAITING_NAME'
      );
    }

    const schedule = db.schedules.find(s => s.id === session.selected_schedule_id!)!;
    
    // Assign Sequential Queue Number
    const existingBookings = db.bookings.filter(b => b.doctor_id === doctorId && b.booking_date === dateStr && b.status !== 'cancelled');
    const nextQueue = existingBookings.length > 0 ? Math.max(...existingBookings.map(b => b.queue_number)) + 1 : 1;

    // Save actual booking to database (Supabase mockup db state)
    const newBooking: Booking = {
      id: `book-${Date.now()}`,
      doctor_id: doctorId,
      schedule_id: schedule.id,
      patient_name: nameInput,
      patient_phone: phone,
      booking_date: dateStr,
      queue_number: nextQueue,
      status: 'pending', // Starts pending payment validation
      payment_status: 'pending',
      verified_by_whatsapp: true,
      created_at: getYemenTime().toISOString()
    };

    db.bookings.push(newBooking);

    // Decrement capacity
    const schIdx = db.schedules.findIndex(s => s.id === schedule.id);
    if (schIdx !== -1) {
      db.schedules[schIdx].available_capacity = Math.max(0, db.schedules[schIdx].available_capacity - 1);
    }

    // Calculate deadline Date + 2 days
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + 2);
    const deadlineStr = deadlineDate.toISOString().split('T')[0];

    const isMorning = parseInt(schedule.start_time.split(':')[0]) < 13;
    const shiftLabel = isMorning ? 'صباحية' : 'مسائية';
    const dayLabel = getDayNameArabic(schedule.day_of_week);
    const circleQueue = getCircledNumber(nextQueue);

    const successMsg = `تم تأكيد الحجز بنجاح،
الاسم: ${nameInput}
رقمك هو: ${circleQueue}
الفترة: ${shiftLabel}
موعدك هو: ( ${dayLabel} ) ( ${dateStr} )
نتمنى لكم دوام الصحة والعافية.
(يرجى تأكيد الحجز بواسطة دفع رسوم التسجيل خلال يومين من هذا التاريخ ${deadlineStr}، وإلا سيعتبر الحجز لاغياً، وشكراً).`;

    // Clear session state
    db.bot_sessions[phone] = {
      ...session,
      current_state: 'IDLE',
      patient_name: null,
      selected_doctor_id: null,
      selected_shift: null,
      selected_schedule_id: null,
      selected_date: null,
      last_interaction_at: getYemenTime().toISOString()
    };

    writeDb(db);
    return outputReply(successMsg, 'IDLE');
  }

  return outputReply("مرحباً بك. يرجى إرسال كلمة 'تسجيل' لبدء حجز موعد طبي جديد.", 'IDLE');
}

// -------------------------------------------------------------------------
// SIMULATOR INTERACTIVE HELPER
// -------------------------------------------------------------------------
app.post('/api/simulator/send-message', (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'الحقول المطلوبة مفقودة' });
  }

  const mockMetaMsg = {
    type: 'text',
    from: phone,
    text: { body: message }
  };

  const responseText = handleWhatsappFlow(phone, mockMetaMsg);
  const db = readDb();
  const session = db.bot_sessions[phone] || null;

  res.json({
    phone,
    sentMessage: message,
    receivedReply: responseText,
    currentSessionState: session ? session.current_state : 'IDLE',
    sessionDetails: session
  });
});

// -------------------------------------------------------------------------
// VITE CLIENT INTEGRATION
// -------------------------------------------------------------------------

async function startServer() {
  // Vite integration middleware
  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`Persisting DB to: ${DB_FILE}`);
  });
}

startServer();
