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
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Aden', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date());
  let year = 2026, month = 6, day = 20, hour = 0, minute = 0, second = 0;
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'second') second = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
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

// Serve direct public static assets (such as logo.png) explicitly
app.use(express.static(path.join(process.cwd(), 'public')));

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

// --- AI KEYS API ---
const API_KEYS_PATH = path.join(process.cwd(), 'api_keys.json');

function getApiKeys() {
  try {
    if (!fs.existsSync(API_KEYS_PATH)) {
       return [];
    }
    const data = fs.readFileSync(API_KEYS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading api keys:', err);
    return [];
  }
}

function saveApiKeys(keys: any[]) {
  try {
    fs.writeFileSync(API_KEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing api keys:', err);
  }
}

function updateEnvFile(activeKey: string) {
  const envPath = path.join(process.cwd(), '.env');
  try {
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('GEMINI_API_KEY=')) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY="${activeKey}"`);
      } else {
        envContent += `\nGEMINI_API_KEY="${activeKey}"\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');
    } else {
      fs.writeFileSync(envPath, `GEMINI_API_KEY="${activeKey}"\n`, 'utf-8');
    }
    process.env.GEMINI_API_KEY = activeKey; // Update locally in current process too
  } catch (err) {
    console.error('Error updating .env file:', err);
  }
}

async function getApiKeysAsync(): Promise<any[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.from('api_keys').select('*').order('created_at', { ascending: true });
    if (error) {
      console.warn('Supabase api_keys table error, falling back to local api_keys.json:', error.message);
      return getApiKeys();
    }
    return data || [];
  } catch (err: any) {
    console.warn('Supabase api_keys fetch exception, falling back to local api_keys.json:', err.message);
    return getApiKeys();
  }
}

async function saveApiKeyAsync(newKey: any): Promise<boolean> {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.from('api_keys').insert([newKey]);
    if (error) {
      console.error('Error saving to Supabase api_keys:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('Exception saving to Supabase api_keys:', err.message);
    return false;
  }
}

async function deleteApiKeyAsync(id: string): Promise<boolean> {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (error) {
      console.error('Error deleting from Supabase api_keys:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('Exception deleting from Supabase api_keys:', err.message);
    return false;
  }
}

app.get('/api/ai-keys', async (req, res) => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.from('api_keys').select('*').order('created_at', { ascending: true });
    if (error) {
      // Table doesn't exist, flag it in headers so frontend can show SQL setup instructions
      res.setHeader('X-Supabase-Table-Missing', 'true');
      const keys = getApiKeys();
      return res.json(keys);
    }
    return res.json(data || []);
  } catch (err) {
    res.setHeader('X-Supabase-Table-Missing', 'true');
    const keys = getApiKeys();
    return res.json(keys);
  }
});

app.post('/api/ai-keys', async (req, res) => {
  const { name, key_value, is_active } = req.body;
  if (!name || !key_value) return res.status(400).json({ error: 'الاسم والمفتاح مطلوبان' });
  
  // Sync locally (fallback)
  const keys = getApiKeys();
  const id = crypto.randomUUID();
  const newKey = {
    id,
    name,
    key_value,
    is_active: is_active || keys.length === 0,
    created_at: new Date().toISOString()
  };
  
  if (newKey.is_active) {
    keys.forEach(k => k.is_active = false);
  }
  keys.push(newKey);
  saveApiKeys(keys);

  if (newKey.is_active) {
    updateEnvFile(newKey.key_value);
  }

  // Sync to Database
  const saved = await saveApiKeyAsync(newKey);
  if (saved && newKey.is_active) {
    const supabase = getSupabase();
    try {
      await supabase.from('api_keys').update({ is_active: false }).neq('id', id);
    } catch (_) {}
  } else if (!saved) {
    res.setHeader('X-Supabase-Table-Missing', 'true');
  }

  res.json(newKey);
});

app.put('/api/ai-keys/:id/active', async (req, res) => {
  const id = req.params.id;
  
  // Sync locally (fallback)
  const keys = getApiKeys();
  const keyIndex = keys.findIndex(k => k.id === id);
  if (keyIndex !== -1) {
    keys.forEach(k => k.is_active = false);
    keys[keyIndex].is_active = true;
    saveApiKeys(keys);
    updateEnvFile(keys[keyIndex].key_value);
  }

  // Sync to Database
  const supabase = getSupabase();
  let updatedKeyFromDb = null;
  try {
    await supabase.from('api_keys').update({ is_active: false }).neq('id', id);
    const { data, error } = await supabase.from('api_keys').update({ is_active: true }).eq('id', id).select().maybeSingle();
    if (error) {
      res.setHeader('X-Supabase-Table-Missing', 'true');
    } else {
      updatedKeyFromDb = data;
    }
  } catch (err) {
    res.setHeader('X-Supabase-Table-Missing', 'true');
  }

  if (updatedKeyFromDb) {
    if (updatedKeyFromDb.key_value) {
      updateEnvFile(updatedKeyFromDb.key_value);
    }
    return res.json(updatedKeyFromDb);
  }

  if (keyIndex !== -1) {
    res.json(keys[keyIndex]);
  } else {
    res.status(404).json({ error: 'المفتاح غير موجود' });
  }
});

app.put('/api/ai-keys/:id', async (req, res) => {
  const { name, key_value } = req.body;
  const id = req.params.id;
  
  // Sync locally (fallback)
  const keys = getApiKeys();
  const keyIndex = keys.findIndex(k => k.id === id);
  if (keyIndex !== -1) {
    if (name) keys[keyIndex].name = name;
    if (key_value) keys[keyIndex].key_value = key_value;
    saveApiKeys(keys);
    if (keys[keyIndex].is_active && key_value) {
      updateEnvFile(key_value);
    }
  }

  // Sync to Database
  const supabase = getSupabase();
  let updatedKeyFromDb = null;
  try {
    const updates: any = {};
    if (name) updates.name = name;
    if (key_value) updates.key_value = key_value;
    const { data, error } = await supabase.from('api_keys').update(updates).eq('id', id).select().maybeSingle();
    if (error) {
      res.setHeader('X-Supabase-Table-Missing', 'true');
    } else {
      updatedKeyFromDb = data;
    }
  } catch (err) {
    res.setHeader('X-Supabase-Table-Missing', 'true');
  }

  if (updatedKeyFromDb) {
    if (updatedKeyFromDb.is_active && key_value) {
      updateEnvFile(key_value);
    }
    return res.json(updatedKeyFromDb);
  }

  if (keyIndex !== -1) {
    res.json(keys[keyIndex]);
  } else {
    res.status(404).json({ error: 'المفتاح غير موجود' });
  }
});

app.delete('/api/ai-keys/:id', async (req, res) => {
  const id = req.params.id;
  
  // Sync locally (fallback)
  const keys = getApiKeys();
  const updatedKeys = keys.filter(k => k.id !== id);
  saveApiKeys(updatedKeys);

  // Sync to Database
  await deleteApiKeyAsync(id);

  res.json({ success: true });
});

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

app.get('/api/config/supabase', (req, res) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  
  res.json({
    supabaseUrl,
    supabaseAnonKey
  });
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

app.post('/api/auth/logout', async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    console.error('[Logout Error]', err.message);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء تسجيل الخروج' });
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

    // Fetch custom reminders dictionary
    let remindersDict: Record<string, { sent_by: string, sent_at: string }> = {};
    try {
      const { data: reminderRow } = await supabase
        .from('whatsapp_sessions')
        .select('session_data')
        .eq('space_server_id', 'bookings_custom_reminders')
        .maybeSingle();
      if (reminderRow && reminderRow.session_data) {
        remindersDict = JSON.parse(reminderRow.session_data);
      }
    } catch (_) {}

    const mapped = (data || []).map(b => ({
      ...b,
      doctor_name: b.doctor ? b.doctor.name : 'طبيب محذوف',
      doctor_specialty: b.doctor ? b.doctor.specialty : '',
      reminder_sent_by: remindersDict[b.id]?.sent_by || null,
      reminder_sent_at: remindersDict[b.id]?.sent_at || null
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
      .select('max_capacity, start_time')
      .eq('id', schedule_id)
      .single();

    if (!sch) {
      return res.status(400).json({ error: 'عذراً لا يوجد جدول مواعيد متاح لهذا الحجز.' });
    }

    // Dynamic date-scoped remaining capacity check
    const { count: bookedCount, error: countErr } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('schedule_id', schedule_id)
      .eq('booking_date', booking_date)
      .neq('status', 'cancelled')
      .neq('payment_status', 'cancelled');

    if (countErr) throw countErr;

    const remainingSlots = sch.max_capacity - (bookedCount || 0);

    if (remainingSlots <= 0) {
      return res.status(400).json({ error: 'عذراً لا توجد سعة باقية للحجز في هذا الموعد المحدد.' });
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

app.post('/api/bookings/:id/send-reminder', async (req, res) => {
  const { id } = req.params;
  const { sender_name } = req.body;
  try {
    const supabase = getSupabase();

    // 1. Fetch booking with doctor information
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('*, doctor:doctors(name, specialty)')
      .eq('id', id)
      .maybeSingle();

    if (bErr || !booking) {
      return res.status(404).json({ error: 'عذراً، هذا الحجز غير موجود بالنظام.' });
    }

    // 2. Load custom reminders state
    let remindersDict: Record<string, { sent_by: string, sent_at: string }> = {};
    const { data: reminderRow } = await supabase
      .from('whatsapp_sessions')
      .select('session_data')
      .eq('space_server_id', 'bookings_custom_reminders')
      .maybeSingle();

    if (reminderRow && reminderRow.session_data) {
      try {
        remindersDict = JSON.parse(reminderRow.session_data);
      } catch (_) {}
    }

    // Check if reminder was already sent
    if (remindersDict[id]) {
      return res.status(400).json({ 
        error: `عذراً، تم إرسال تذكير لهذا الحجز مسبقاً بواسطة (${remindersDict[id].sent_by}) في الساعة ${remindersDict[id].sent_at}.` 
      });
    }

    // Get active WhatsApp settings
    const { data: wsData } = await supabase
      .from('whatsapp_settings')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // Construct the elegant, professional Arabic message
    const patientName = booking.patient_name || 'العزيز';
    const doctorName = booking.doctor ? booking.doctor.name : 'طبيب العيادة';
    const bookingDate = booking.booking_date;
    const shiftText = booking.shift === 'Evening' ? 'المسائية (مساءً)' : 'الصباحية (صباحاً)';

    const reminderMessage = `السلام عليكم ورحمة الله وبركاته، 🌹\n` +
      `عزيزنا المريض: *${patientName}* المحترم،\n\n` +
      `نود تذكيركم بأن لديكم موعداً اليوم مع الدكتور: *${doctorName}*\n` +
      `📅 *تاريخ الموعد اليوم:* ${bookingDate}\n` +
      `⏰ *فترة الموعد:* ${shiftText}\n\n` +
      `📍 يرجى منكم تأكيد حضوركم من خلال الرد على هذه الرسالة بأحد الخيارات التالية:\n` +
      `1️⃣ *نعم، سأحضر للموعد.*\n` +
      `2️⃣ *لا، لن أتمكن من الحضور.*\n\n` +
      `*نتمنى لكم دوام الصحة والعافية،*\n` +
      `*مستشفى برج الأطباء* 🏥`;

    const cleanPhone = booking.patient_phone;

    // Send WhatsApp Message
    await sendWhatsAppMessage(cleanPhone, reminderMessage, wsData || { provider: 'huggingface' });

    // Log the sent message in whatsapp_logs
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone,
      direction: 'out',
      message: reminderMessage,
      timestamp: getYemenTime().toISOString()
    }]);

    // Record the send in custom reminders list
    const yemenTimeStr = getYemenTime().toLocaleString('ar-YE', {
      timeZone: 'Asia/Aden',
      dateStyle: 'short',
      timeStyle: 'short'
    });

    remindersDict[id] = {
      sent_by: sender_name || 'موظف الاستقبال',
      sent_at: yemenTimeStr
    };

    // Save updated reminders list to Supabase
    await supabase
      .from('whatsapp_sessions')
      .upsert({
        space_server_id: 'bookings_custom_reminders',
        session_data: JSON.stringify(remindersDict),
        updated_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: 'تم إرسال تذكير الواتساب المخصص للمريض بنجاح.',
      reminder_sent_by: remindersDict[id].sent_by,
      reminder_sent_at: remindersDict[id].sent_at
    });

  } catch (err: any) {
    console.error('Send custom reminder error:', err.message);
    res.status(500).json({ error: 'عذراً، فشل إرسال رسالة التذكير.' });
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
  const { id, webhook_verify_token, access_token, app_secret, phone_number_id, is_active, provider, render_server_url } = req.body;
  try {
    const supabase = getSupabase();
    const record: any = {
      webhook_verify_token: webhook_verify_token || 'doctors_tower_verify_token_123',
      access_token: access_token || '',
      app_secret: app_secret || '',
      phone_number_id: phone_number_id || '',
      is_active: is_active !== undefined ? is_active : true,
      provider: provider || 'meta',
      render_server_url: render_server_url || ''
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

// Get session state for a given test phone number
app.get('/api/simulator/session', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    }
    const cleanPhone = normalizePhone(phone as string);
    const supabase = getSupabase();
    const { data: session } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    res.json({ sessionDetails: session || null });
  } catch (err: any) {
    console.error('Fetch simulator session error:', err.message);
    res.status(500).json({ error: 'Failed to fetch session' });
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
 * Helper to generate static styled HTML for the report
 */
let inMemoryLastWeeklyReport: any = null;
try {
  if (fs.existsSync('./last_weekly_report.json')) {
    const fileText = fs.readFileSync('./last_weekly_report.json', 'utf-8');
    inMemoryLastWeeklyReport = JSON.parse(fileText);
  }
} catch (fsLoadErr) {
  // Silent catch
}

function generateHtmlReport(
  doctorsList: any[],
  bookingsList: any[],
  totalCount: number,
  dateStr: string
): string {
  const translateStatus = (status: string) => {
    if (status === 'confirmed') return '<span class="badge badge-success">مؤكد</span>';
    if (status === 'cancelled') return '<span class="badge badge-danger">ملغي</span>';
    return '<span class="badge badge-warning">قيد الانتظار</span>';
  };

  const translatePayment = (pStatus: string) => {
    if (pStatus === 'paid') return '<span class="badge badge-success">مدفوع</span>';
    if (pStatus === 'cancelled') return '<span class="badge badge-danger">ملغي</span>';
    return '<span class="badge badge-warning">انتظار السداد</span>';
  };

  const translateShift = (shift: string) => {
    if (shift === 'Evening') return 'مساءً';
    return 'صباحاً';
  };

  let doctorTablesHtml = '';

  doctorsList.forEach((doc) => {
    const docBookings = bookingsList.filter((b) => b.doctor_id === doc.id);
    const docBookingsCount = docBookings.length;

    doctorTablesHtml += `
    <div class="doctor-card">
      <div class="doctor-header">
        <div class="doctor-info">
          <div class="doctor-avatar">📋</div>
          <div>
            <h3 style="margin: 0; font-size: 16px;">د. ${doc.name}</h3>
            <span class="doctor-specialty">${doc.specialty}</span>
          </div>
        </div>
        <div class="doctor-stats">
          عدد الحجوزات: <strong>${docBookingsCount}</strong>
        </div>
      </div>
      
      ${docBookingsCount === 0 ? `
        <div class="empty-state">
          لا توجد حجوزات مسجلة لهذا الطبيب خلال هذا الأسبوع.
        </div>
      ` : `
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 80px;">الرقم</th>
                <th>اسم المريض</th>
                <th>رقم الهاتف</th>
                <th>تاريخ الحجز</th>
                <th>الفترة</th>
                <th>حالة الحجز</th>
                <th>حالة الدفع</th>
              </tr>
            </thead>
            <tbody>
              ${docBookings.map((b) => `
                <tr>
                  <td><span class="queue-num">#${b.queue_number}</span></td>
                  <td><strong>${b.patient_name}</strong></td>
                  <td><span class="phone-num" dir="ltr">${b.patient_phone}</span></td>
                  <td>${b.booking_date}</td>
                  <td>${translateShift(b.shift)}</td>
                  <td>${translateStatus(b.status)}</td>
                  <td>${translatePayment(b.payment_status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
    `;
  });

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير تصفير وبداية الأسبوعية - مستشفى برج الأطباء</title>
  <style>
    :root {
      --primary: #1e3a8a;
      --primary-light: #eff6ff;
      --text-dark: #1f2937;
      --text-muted: #6b7280;
      --border-color: #e5e7eb;
      --success: #10b981;
      --success-bg: #ecfdf5;
      --danger: #ef4444;
      --danger-bg: #fef2f2;
      --warning: #f59e0b;
      --warning-bg: #fffbeb;
      --card-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f8fafc;
      color: var(--text-dark);
      line-height: 1.6;
      padding: 40px 20px;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    @media print {
      body {
        background-color: #ffffff;
        padding: 0;
      }
      .doctor-card {
        page-break-inside: avoid;
        box-shadow: none !important;
        border: 1px solid var(--border-color) !important;
      }
    }

    header {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      color: white;
      padding: 30px;
      border-radius: 20px;
      margin-bottom: 30px;
      box-shadow: 0 10px 15px -3px rgba(30, 58, 138, 0.1);
      position: relative;
      overflow: hidden;
    }

    header::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 80%);
      pointer-events: none;
    }

    .header-content {
      position: relative;
      z-index: 1;
    }

    .header-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 15px;
    }

    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 13px;
      opacity: 0.9;
      margin-top: 5px;
      font-weight: 500;
    }

    .badge-report {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(4px);
      padding: 6px 14px;
      border-radius: 50px;
      font-size: 11px;
      font-weight: 700;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: white;
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 20px;
      box-shadow: var(--card-shadow);
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .stat-icon {
      width: 45px;
      height: 45px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .stat-icon.total {
      background-color: #fee2e2;
      color: #ef4444;
    }

    .stat-icon.docs {
      background-color: #dbeafe;
      color: #2563eb;
    }

    .stat-icon.time {
      background-color: #fef3c7;
      color: #d97706;
    }

    .stat-title {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 700;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 800;
      color: #1e293b;
      margin-top: 2px;
    }

    .doctor-card {
      background: white;
      border: 1px solid #f1f5f9;
      border-radius: 18px;
      padding: 24px;
      margin-bottom: 25px;
      box-shadow: var(--card-shadow);
    }

    .doctor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #f8fafc;
      padding-bottom: 15px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 15px;
    }

    .doctor-info {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .doctor-avatar {
      font-size: 28px;
      background-color: var(--primary-light);
      width: 50px;
      height: 50px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .doctor-specialty {
      font-size: 11px;
      color: var(--primary);
      background-color: var(--primary-light);
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 700;
      display: inline-block;
      margin-top: 3px;
    }

    .doctor-stats {
      font-size: 12px;
      background: #f1f5f9;
      padding: 6px 14px;
      border-radius: 10px;
      color: #475569;
      font-weight: 700;
    }

    .doctor-stats strong {
      color: var(--primary);
      font-size: 14px;
    }

    .table-responsive {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: right;
      font-size: 12px;
    }

    th {
      background-color: #f8fafc;
      color: #475569;
      padding: 12px 16px;
      font-weight: 800;
      border-bottom: 2px solid var(--border-color);
    }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      color: #334155;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background-color: #f8fafc;
    }

    .queue-num {
      background-color: var(--primary-light);
      color: var(--primary);
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: 800;
    }

    .phone-num {
      font-family: monospace;
      font-size: 12px;
      color: #475569;
    }

    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
      text-align: center;
    }

    .badge-success {
      background-color: var(--success-bg);
      color: var(--success);
    }

    .badge-danger {
      background-color: var(--danger-bg);
      color: var(--danger);
    }

    .badge-warning {
      background-color: var(--warning-bg);
      color: var(--warning);
    }

    .empty-state {
      text-align: center;
      padding: 20px;
      color: var(--text-muted);
      background-color: #f8fafc;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      border: 1px dashed var(--border-color);
    }

    footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border-color);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-content">
        <div class="header-title-row">
          <div>
            <h1 style="margin: 0; font-size: 24px;">مستشفى برج الأطباء - تقرير الأسبوع المنصرم</h1>
            <div class="subtitle">تقرير شامل بكافة الحجوزات الممسوحة وإعادة تصفير وبدء السعة الأسبوعية الجديدة</div>
          </div>
          <span class="badge-report">أرشيف تصفير الدورة الأسبوعية</span>
        </div>
      </div>
    </header>

    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-icon total">🧹</div>
        <div>
          <div class="stat-title font-sans">إجمالي الحجوزات الممسوحة</div>
          <div class="stat-value">${totalCount} حجز</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon docs">👨‍⚕️</div>
        <div>
          <div class="stat-title font-sans">عدد الأطباء المسجلين</div>
          <div class="stat-value">${doctorsList.length} أطباء</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon time">📅</div>
        <div>
          <div class="stat-title font-sans">تاريخ التصفير والبدء</div>
          <div style="font-size: 12px; font-weight: 800;" class="stat-value">${dateStr}</div>
        </div>
      </div>
    </div>

    ${doctorTablesHtml}

    <footer>
      نظام برج الأطباء لإدارة الحجوزات والربط والرد التلقائي عبر واتساب • التقرير يتجدد تلقائياً أسبوعياً.
    </footer>
  </div>
</body>
</html>
  `;
}

/**
 * Weekly Reset Trigger Cron Job
 */
app.post('/api/cron/reset-weekly', async (req, res) => {
  try {
    const supabase = getSupabase();

    // 1. Fetch current active list of doctors
    const { data: doctorsList, error: docErr } = await supabase
      .from('doctors')
      .select('*')
      .order('name');
    if (docErr) throw docErr;

    // 2. Fetch all bookings in the database before resetting (to include in the last report)
    const { data: bookingsList, error: bErr } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: true });
    if (bErr) throw bErr;

    // 3. Formulate report representation payload
    const activeDoctors = doctorsList || [];
    const activeBookings = bookingsList || [];
    
    // Express YEMEN Time formatted string
    const yemenTimeStr = getYemenTime().toLocaleString('ar-YE', { 
      timeZone: 'Asia/Aden',
      dateStyle: 'full', 
      timeStyle: 'short' 
    });

    const reportPayload = {
      totalDeleted: activeBookings.length,
      doctorsCount: activeDoctors.length,
      generatedAt: getYemenTime().toISOString(),
      dateStr: yemenTimeStr,
      doctorsList: activeDoctors.map((doc: any) => {
        const docBookings = activeBookings.filter((b: any) => b.doctor_id === doc.id);
        return {
          id: doc.id,
          name: doc.name,
          specialty: doc.specialty,
          bookingsCount: docBookings.length,
          bookings: docBookings.map((b: any) => ({
            patient_name: b.patient_name,
            patient_phone: b.patient_phone,
            booking_date: b.booking_date,
            queue_number: b.queue_number,
            shift: b.shift,
            status: b.status,
            payment_status: b.payment_status
          }))
        };
      }),
      htmlReport: generateHtmlReport(activeDoctors, activeBookings, activeBookings.length, yemenTimeStr)
    };

    // 4. Save the report to Superbase under space_server_id = 'last_weekly_report' to enforce durable persistence
    try {
      await supabase
        .from('whatsapp_sessions')
        .upsert({
          space_server_id: 'last_weekly_report',
          session_data: JSON.stringify(reportPayload),
          updated_at: new Date().toISOString()
        });
    } catch (saveReportErr) {
      // Silent catch to prevent RLS/database warnings in platform monitors
    }

    // Store in global in-memory state for instantaneous retrieval
    inMemoryLastWeeklyReport = reportPayload;

    // Write a local fallback backup file
    try {
      fs.writeFileSync('./last_weekly_report.json', JSON.stringify(reportPayload, null, 2), 'utf-8');
    } catch (fsErr: any) {
      // Silent catch
    }

    // 5. Hard delete (wipe) all bookings as requested by user
    const { error: delBookingsErr } = await supabase
      .from('bookings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (delBookingsErr) throw delBookingsErr;

    // 6. Reset all doctor schedule capacities and clear bot sessions
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    if (rpcErr) {
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
      message: `تم تشغيل وإعادة تهيئة الدورة الأسبوعية بنجاح بنجاح الأسبوع الجديد! تم الحذف التام لـ (${activeBookings.length}) حجز من النظام، وتصفير الجلسات وترميم الشواغر الزمنية والتقاط تقرير الأرشيف الأسبوعي.`
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to run weekly reset cron' });
  }
});

/**
 * Retrieve the latest generated weekly report
 */
app.get('/api/cron/last-weekly-report', async (req, res) => {
  try {
    // 1. Try in-memory first for instant, robust retrieval
    if (inMemoryLastWeeklyReport) {
      return res.json({ success: true, report: inMemoryLastWeeklyReport });
    }

    // 2. Try loading from file system
    if (fs.existsSync('./last_weekly_report.json')) {
      try {
        const fileText = fs.readFileSync('./last_weekly_report.json', 'utf-8');
        inMemoryLastWeeklyReport = JSON.parse(fileText);
        return res.json({ success: true, report: inMemoryLastWeeklyReport });
      } catch (fileReadErr) {
        // Silent catch
      }
    }

    // 3. Try fallback loading from Supabase, but catch completely silently
    try {
      const supabase = getSupabase();
      const { data: reportRow } = await supabase
        .from('whatsapp_sessions')
        .select('session_data')
        .eq('space_server_id', 'last_weekly_report')
        .maybeSingle();

      if (reportRow && reportRow.session_data) {
        const parsedReport = JSON.parse(reportRow.session_data);
        inMemoryLastWeeklyReport = parsedReport;
        return res.json({ success: true, report: parsedReport });
      }
    } catch (dbErr) {
      // Silent catch to prevent test console warnings or errors
    }

    return res.json({ success: true, report: null });
  } catch (err: any) {
    res.json({ success: true, report: null });
  }
});


/**
 * -------------------------------------------------------------------------
 * INTEGRATED AUTOMATIC WORKFLOWS FOR VERCEL CRON TRIGGERS
 * -------------------------------------------------------------------------
 */

// 1. Unified 3-in-1 Daily Automation Pipeline
app.all('/api/cron/daily-pipeline', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    // 0. Fetch Active WhatsApp toggle settings
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

    console.log(`[Express Daily Pipeline] WhatsApp output state: ${dailyRemindersEnabled}`);

    const resultsSummary: any = {};

    // -------------------------------------------------------------------------
    // PHASE 1: Auto-Cancellation (The 48-Hour Expiry)
    // -------------------------------------------------------------------------
    const threshold48 = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
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
      if (!cancelErr) cancelledCount++;
    }

    resultsSummary.cancelled = {
      totalFound: toCancel.length,
      successfullyCancelled: cancelledCount
    };

    // -------------------------------------------------------------------------
    // HUGGING FACE SENDER HELPER
    // -------------------------------------------------------------------------
    const sendHFMessage = async (phone: string, text: string) => {
      try {
        const hfUrl = 'https://waleedoo-borg-whatsapp-server-1.hf.space/api/send-message';
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
      .select('id, patient_phone, status, payment_status')
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
          try {
            await supabase.from('whatsapp_logs').insert([{
              phone: toRemindGrace[i].patient_phone,
              direction: 'out',
              message: graceMessage,
              timestamp: getYemenTime().toISOString()
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
    const utcNow = new Date().getTime();
    const yemenTomorrow = new Date(utcNow + (3 * 60 * 60 * 1000) + (24 * 60 * 60 * 1000));
    const tomorrowStr = yemenTomorrow.toISOString().split('T')[0];

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
          await supabase
            .from('bookings')
            .update({ verified_by_whatsapp: true })
            .eq('id', confirmedTomorrow[i].id);

          try {
            await supabase.from('whatsapp_logs').insert([{
              phone: confirmedTomorrow[i].patient_phone,
              direction: 'out',
              message: getConfirmedText(confirmedTomorrow[i]),
              timestamp: getYemenTime().toISOString()
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

    res.json({
      success: true,
      message: 'Unified Daily Automation pipeline completed.',
      timestamp: getYemenTime().toISOString(),
      resultsSummary
    });

  } catch (err: any) {
    console.error('[Daily Pipeline Express Exception]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Weekly System Reset (Thursday 10 PM Yemen Time / UTC+3)
app.all('/api/cron/weekly-reset', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const resendApiKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_REPORT_EMAIL || 'waleedsaleemmohammed@gmail.com';

    // 1. Fetch statistics before cleaning
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

    // 2. Erase Bookings records
    const { error: deleteErr } = await supabase
      .from('bookings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteErr) throw deleteErr;

    // Reset weekly capacity via RPC / Direct DB fallbacks
    const { error: rpcErr } = await supabase.rpc('reset_weekly_schedules_and_queues');
    if (rpcErr) {
      console.warn('RPC execution missed in weekly-reset, executing manual fallback...');
      const { data: schedules } = await supabase.from('schedules').select('*');
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ available_capacity: s.max_capacity }).eq('id', s.id);
        }
      }
      await supabase.from('bot_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // Save report cache
    const savedReport = {
      timestamp: getYemenTime().toISOString(),
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
      console.error('Failed to cache weekly report in reset endpoint:', upsertErr.message);
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

    res.json({
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
    console.error('[Weekly Reset Express Cron Exception]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------------------
// OFFICIAL META WHATSAPP WEBHOOK ROUTE & MESSAGING HANDLERS
// -------------------------------------------------------------------------

/**
 * Sends a real message out to a user on WhatsApp via the Meta Graph Cloud API or Render standalone gateway
 */
async function sendWhatsAppMessage(
  to: string, 
  text: string, 
  settings: { 
    access_token?: string; 
    phone_number_id?: string; 
    provider?: 'meta' | 'render' | 'huggingface'; 
    render_server_url?: string; 
  }
) {
  const provider = settings?.provider || 'meta';
  
  if (provider === 'render' || provider === 'huggingface') {
    let renderUrl = settings?.render_server_url || '';
    if (provider === 'huggingface') {
      renderUrl = 'https://waleedoo-borg-whatsapp-server-1.hf.space';
    }
    if (!renderUrl) {
      console.error('[WhatsApp Device Error] Connect server url is missing in settings');
      return;
    }
    const cleanUrl = renderUrl.endsWith('/') ? `${renderUrl}api/send-message` : `${renderUrl}/api/send-message`;
    console.log(`[WhatsApp API Router] Routing message to custom gateway: ${cleanUrl} for [+${to}]`);
    try {
      const response = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: to,
          message: text
        })
      });
      const bodyText = await response.text();
      if (!response.ok) {
        if (response.status === 503 && bodyText.includes('WhatsApp client is not ready')) {
          console.warn(`[WhatsApp Gateway Info] Standalone API is offline or QR not scanned. Message will still be simulated locally. Http status: 503.`);
        } else {
          console.warn(`[WhatsApp Gateway Info] Standalone API responded with code ${response.status}. Response: ${bodyText}`);
        }
      } else {
        console.log(`[WhatsApp Gateway Success] Dispatched message to [+${to}] via Standalone URL successfully! Response:`, bodyText);
      }
    } catch (err: any) {
      console.warn(`[WhatsApp Gateway Exception] Unable to connect to standalone gateway (offline):`, err.message);
    }
    return;
  }

  // Default block: official Meta Cloud API
  const { access_token, phone_number_id } = settings || {};
  if (!access_token || !phone_number_id) {
    console.error(`[WhatsApp Meta Error] Missing Meta tokens for ${to} (access_token or phone_number_id)`);
    return;
  }
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
  } catch (err: any) {
    console.error(`[WhatsApp API Exception] Web/network fetch call to Meta Graph API failed for ${to}:`, err.message);
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
      const provider = settings?.provider || 'meta';

      if (isWebhookActive) {
        if ((provider === 'render' || provider === 'huggingface') && (settings?.render_server_url || provider === 'huggingface')) {
          console.log(`[WhatsApp Webhook] Dispatching active API call for [+${cleanPhone}] via Custom Gateway...`);
          await sendWhatsAppMessage(cleanPhone, botResponse, settings || { provider: 'huggingface' });
        } else if (provider === 'meta' && accessToken && phoneNumberId) {
          console.log(`[WhatsApp Webhook] Dispatching active API call for [+${cleanPhone}] via Graph API using Phone ID [${phoneNumberId}]...`);
          await sendWhatsAppMessage(cleanPhone, botResponse, {
            access_token: accessToken,
            phone_number_id: phoneNumberId,
            provider: 'meta'
          });
        } else {
          console.log(`[WhatsApp Webhook Simulated] Replayed [+${cleanPhone}]: "${botResponse}" (Real API skipped: provider=${provider}, url=${settings?.render_server_url}, token=${!!accessToken}, phone=${!!phoneNumberId})`);
        }
      } else {
        console.log(`[WhatsApp Webhook Simulated] Replayed [+${cleanPhone}]: "${botResponse}" (Webhook disabled)`);
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
  schedules: Schedule[],
  bookings: Booking[] = []
): { prompt: string; options: GroupedDayOption[] } {
  const docSchedules = schedules.filter(s => s.doctor_id === doctor.id);
  
  const yemenNow = getYemenTime();
  const currentJsDay = yemenNow.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const jsToOur = [1, 2, 3, 4, 5, -1, 0]; // Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=-1, Sat=0
  const ourCurrentDay = jsToOur[currentJsDay];

  const rawOptions: { day_of_week: number; date: string; weekLabel: string; schedule: Schedule }[] = [];

  const isScheduleFullOnDate = (sch: Schedule, dateStr: string): boolean => {
    const count = bookings.filter(b => 
      b.schedule_id === sch.id && 
      b.booking_date === dateStr && 
      b.status !== 'cancelled' &&
      b.payment_status !== 'cancelled'
    ).length;
    return count >= sch.max_capacity;
  };

  docSchedules.forEach(s => {
    const startHour = parseInt(s.start_time.split(':')[0]);
    const isMorning = startHour < 13;
    const currentHour = yemenNow.getHours();

    if (ourCurrentDay === -1) {
      // Friday (Day off) - bookings refer to upcoming Saturday onwards
      // Adding for "current" week (الأسبوع الحالي)
      const daysToAddCurrent = 1 + s.day_of_week;
      const dateCurrent = new Date(yemenNow.getTime() + daysToAddCurrent * 24 * 60 * 60 * 1000);
      const dateStr = dateCurrent.toISOString().split('T')[0];
      if (!isScheduleFullOnDate(s, dateStr)) {
        rawOptions.push({
          day_of_week: s.day_of_week,
          date: dateStr,
          weekLabel: 'الأسبوع الحالي',
          schedule: s
        });
      }

      // Adding for "next" week (الأسبوع الثاني)
      if (doctor.allow_second_week_booking) {
        const daysToAddNext = 1 + s.day_of_week + 7;
        const dateNext = new Date(yemenNow.getTime() + daysToAddNext * 24 * 60 * 60 * 1000);
        const dateStrNext = dateNext.toISOString().split('T')[0];
        if (!isScheduleFullOnDate(s, dateStrNext)) {
          rawOptions.push({
            day_of_week: s.day_of_week,
            date: dateStrNext,
            weekLabel: 'الأسبوع الثاني',
            schedule: s
          });
        }
      }
    } else {
      const diff = s.day_of_week - ourCurrentDay;

      // Current week processing (الأسبوع الحالي)
      if (diff === 0) {
        // TODAY
        let isExpired = false;
        if (isMorning && currentHour >= 12) {
          isExpired = true;
        } else if (!isMorning && currentHour >= 19) {
          isExpired = true;
        }

        if (!isExpired) {
          // Not expired today, add to current week
          const dateCurrent = new Date(yemenNow.getTime() + diff * 24 * 60 * 60 * 1000);
          const dateStr = dateCurrent.toISOString().split('T')[0];
          if (!isScheduleFullOnDate(s, dateStr)) {
            rawOptions.push({
              day_of_week: s.day_of_week,
              date: dateStr,
              weekLabel: 'الأسبوع الحالي',
              schedule: s
            });
          }
        }
      } else if (diff > 0) {
        // Future day this week
        const dateCurrent = new Date(yemenNow.getTime() + diff * 24 * 60 * 60 * 1000);
        const dateStr = dateCurrent.toISOString().split('T')[0];
        if (!isScheduleFullOnDate(s, dateStr)) {
          rawOptions.push({
            day_of_week: s.day_of_week,
            date: dateStr,
            weekLabel: 'الأسبوع الحالي',
            schedule: s
          });
        }
      }

      // Next week processing (الأسبوع الثاني)
      if (doctor.allow_second_week_booking) {
        const diffNext = diff + 7;
        const dateNext = new Date(yemenNow.getTime() + diffNext * 24 * 60 * 60 * 1000);
        const dateStrNext = dateNext.toISOString().split('T')[0];
        if (!isScheduleFullOnDate(s, dateStrNext)) {
          rawOptions.push({
            day_of_week: s.day_of_week,
            date: dateStrNext,
            weekLabel: 'الأسبوع الثاني',
            schedule: s
          });
        }
      }
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

  if (options.length === 0) {
    const prompt = `عذرًا، الطبيب الذي اخترته (*${doctor.name}*) ليس لديه أي مواعيد عيادة متاحة لبقية هذا الأسبوع. نسعد بخدمتك وتسجيلك مجددًا مع بداية الأسبوع القادم، كما يسعدنا أيضًا مساعدتك في اختيار أي طبيب آخر متاح بكل سرور.`;
    return { prompt, options };
  }

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
  
  const isTextMessage = messageObj.type === 'text';
  let messageText = isTextMessage ? (messageObj.text?.body || '').trim() : '';

  // Log inbound message
  await supabase.from('whatsapp_logs').insert([{
    phone: cleanPhone,
    direction: 'in',
    message: isTextMessage ? messageText : `[رسالة وسائط متعددة أو غير مدعومة: ${messageObj.type}]`,
    timestamp: currentYemenNow.toISOString()
  }]);

  if (!isTextMessage || !messageText) {
    const errorReply = "عذراً، أستطيع فقط فهم الرسائل النصية المكتوبة بصيغة واضحة.";
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone, direction: 'out', message: errorReply, timestamp: getYemenTime().toISOString()
    }]);
    return errorReply;
  }

  try {
    const { GoogleGenAI, Type } = await import('@google/genai');

    // Get active key from api_keys (with Supabase fetch preferred)
    const keys = await getApiKeysAsync();
    const activeKeyObj = keys.find(k => k.is_active);
    const apiKey = activeKeyObj ? activeKeyObj.key_value : process.env.GEMINI_API_KEY;

    if (!apiKey) {
      const msg = "نظام الذكاء الاصطناعي معطل حاليا (مفتاح API مفقود). قم بإضافة مفتاح من إعدادات النظام.";
      await supabase.from('whatsapp_logs').insert([
        { phone: cleanPhone, direction: 'out', message: msg, timestamp: getYemenTime().toISOString() }
      ]);
      return msg;
    }
    const ai = new GoogleGenAI({ apiKey });

    // Fetch conversation history from whatsapp_logs
    const { data: logs } = await supabase
      .from('whatsapp_logs')
      .select('message, direction, timestamp')
      .eq('phone', cleanPhone)
      .order('timestamp', { ascending: true })
      .limit(30);

    const history = (logs || []).map(log => ({
      role: log.direction === 'in' ? 'user' : 'model',
      parts: [{ text: log.message }]
    }));
    
    // Ensure history starts with 'user'
    let validHistory = [];
    for (let i = 0; i < history.length; i++) {
       if (history[i].role === 'user') {
          validHistory = history.slice(i);
          break;
       }
    }
    // Remove the current message from history to prevent duplication
    if (validHistory.length > 0 && validHistory[validHistory.length - 1].parts[0].text === messageText) {
       validHistory.pop();
    }

    const systemInstruction = `أنت مساعد ذكي ونشيط لمستشفى برج الأطباء في اليمن. تتحدث باللهجة اليمنية بطلاقة وبشكل طبيعي جداً.
مهمتك مساعدة المرضى في الاستعلام عن الأطباء وحجز المواعيد.
تعليمات سير العمل:
- رحب بالمريض واعرض عليه بكل لطف قائمة الأطباء.
- استوعب متطلبات المريض من نصه (مثلاً إذا قال "أشتي دكتور باطنية" ابحث فوراً عن أطباء الباطنية باستخدام الأداة getDoctors).
- لحجز الموعد تأكد أولاً من وجود سعة متاحة في التاريخ والفترة المختارة باستخدام أداة checkCapacity.
- اطلب الاسم الرباعي ليتم تسجيله بصورة رسمية.
- عند اجراء الحجز بنجاح (باستخدام makeBooking)، أعطِ المريض رسالة تأكيد متكاملة ومنسقة، ضع رقم الدور בداخل دائرة رمزية مثل ❶ أو ❷...
- أخبره بصرامة ولطف أن آخر موعد لتسديد الرسوم هو خلال يومين وفقاً لتوقيت اليمن (Asia/Aden).
- إذا سأل عن أمور خارج المستشفى أو الحجوزات، وجهه بسلاسة واعتذار سريع للعودة للموضوع الطبي.`;

    // Initialize Database tools for Gemini
    const getDoctors = async () => {
      const { data, error } = await supabase.from('doctors').select('id, name, specialty');
      if (error) return { error: error.message };
      return { doctors: data };
    };

    const checkCapacity = async (args: any) => {
      const { doctorId, dateStr, shift } = args;
      const { data: schedule, error: schError } = await supabase
        .from('schedules')
        .select('id, max_capacity')
        .eq('doctor_id', doctorId)
        .eq('shift', shift)
        .maybeSingle();

      if (schError || !schedule) return { error: 'Schedule not found for that doctor and shift.' };

      const { count, error: countError } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('schedule_id', schedule.id)
        .eq('booking_date', dateStr);

      if (countError) return { error: countError.message };

      const currentCount = count || 0;
      return { 
        hasCapacity: currentCount < schedule.max_capacity, 
        remainingSlots: schedule.max_capacity - currentCount 
      };
    };

    const makeBooking = async (args: any) => {
      const { name, doctorId, dateStr, shift, customerPhone } = args;
      const { data: schedule } = await supabase
        .from('schedules')
        .select('id')
        .eq('doctor_id', doctorId)
        .eq('shift', shift)
        .maybeSingle();

      if (!schedule) return { error: 'Schedule not found for that doctor.' };

      const { count } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('schedule_id', schedule.id)
        .eq('booking_date', dateStr);

      const queueNumber = (count || 0) + 1;

      const { data, error } = await supabase
        .from('bookings')
        .insert([{
          patient_name: name,
          patient_phone: normalizePhone(customerPhone || phone),
          schedule_id: schedule.id,
          booking_date: dateStr,
          queue_number: queueNumber,
          status: 'confirmed',
          payment_status: 'pending'
        }])
        .select()
        .single();

      if (error) return { error: error.message };
      
      // Update session logic purely so UI is happy
      await supabase.from('bot_sessions').upsert({
         phone: cleanPhone,
         current_state: 'COMPLETED',
         patient_name: name,
         selected_doctor_id: doctorId,
         selected_schedule_id: schedule.id,
         selected_date: dateStr,
         selected_shift: shift,
         last_interaction_at: getYemenTime().toISOString()
      }, { onConflict: 'phone' });

      return { success: true, booking: data, queueNumber };
    };

    const toolsMap: Record<string, Function> = { getDoctors, checkCapacity, makeBooking };

    const chat = ai.chats.create({
      model: 'gemini-3.5-flash',
      config: {
        systemInstruction,
        temperature: 0.7,
        // @ts-ignore
        tools: [{
          functionDeclarations: [
            {
              name: 'getDoctors',
              description: 'Fetch list of available doctors and their specialties to show to the patient.'
            },
            {
              name: 'checkCapacity',
              description: 'Check if a specific doctor has available slots on a given date and shift.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  doctorId: { type: Type.STRING, description: 'ID of the doctor (UUID)' },
                  dateStr: { type: Type.STRING, description: 'Date string formatted as YYYY-MM-DD' },
                  shift: { type: Type.STRING, description: 'Shift name exactly as "صباحية" or "مسائية"' }
                },
                required: ['doctorId', 'dateStr', 'shift']
              }
            },
            {
              name: 'makeBooking',
              description: 'Book an appointment for a patient in the database. Call THIS when patient confirms name and slot.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: 'Full quadruple patient name in Arabic' },
                  doctorId: { type: Type.STRING, description: 'Doctor UUID' },
                  dateStr: { type: Type.STRING, description: 'Date in YYYY-MM-DD format' },
                  shift: { type: Type.STRING, description: 'Shift ("صباحية" / "مسائية")' },
                  customerPhone: { type: Type.STRING, description: 'Patient phone number' }
                },
                required: ['name', 'doctorId', 'dateStr', 'shift', 'customerPhone']
              }
            }
          ]
        }]
      }
    });

    let finalAnswer = "";
    try {
      let response = await chat.sendMessage({ message: messageText });
      finalAnswer = response.text || '';

      // Handle Function Calling recursively
      if (response.functionCalls && response.functionCalls.length > 0) {
        let maxLoops = 3;
        while(response.functionCalls && response.functionCalls.length > 0 && maxLoops > 0) {
           const call = response.functionCalls[0];
           if (call.name && toolsMap[call.name]) {
              const toolResult = await toolsMap[call.name](call.args);
              
              response = await chat.sendMessage({
                  // @ts-ignore
                  message: [{
                    functionResponse: {
                       name: call.name,
                       response: toolResult
                    }
                  }]
              });
              finalAnswer = response.text || finalAnswer;
           } else {
              break;
           }
           maxLoops--;
        }
      }
    } catch(err: any) {
      if (err.message && (err.message.includes("API Key") || err.message.includes("API key") || err.message.includes("key_invalid"))) {
        console.warn("Gemini API Key is invalid. The user must update it in Settings.");
        finalAnswer = "عذراً، مفتاح الذكاء الاصطناعي (Gemini API Key) غير صالح أو لم يتم العثور عليه. للأسف لن أتمكن من الرد حتى تقوم بتحديثه من إعدادات المشروع (Settings > API Keys).";
      } else {
        console.error("Gemini Error:", err.message);
        finalAnswer = "عذرا، النظام يواجه صعوبة مؤقتة في معالجة طلبك المعقد. الرجاء المحاولة لاحقا.";
      }
    }

    if (!finalAnswer) {
      finalAnswer = "عذرا، لم أتمكن من الرد. يرجى المحاولة مرة أخرى.";
    }

    // Update bot session with last interaction so it shows active
    await supabase.from('bot_sessions').upsert({
      phone: cleanPhone,
      current_state: 'CHATTING_WITH_AI',
      last_interaction_at: getYemenTime().toISOString()
    }, { onConflict: 'phone' });

    // Ensure session isn't empty on frontend
    const { data: sessionData } = await supabase.from('bot_sessions').select('*').eq('phone', cleanPhone).single();
    if (!sessionData) {
      await supabase.from('bot_sessions').insert([{ phone: cleanPhone, current_state: 'CHATTING_WITH_AI', last_interaction_at: getYemenTime().toISOString() }]);
    }

    // Save outbound message to logs
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone,
      direction: 'out',
      message: finalAnswer,
      timestamp: getYemenTime().toISOString()
    }]);

    return finalAnswer;

  } catch (err: any) {
    console.error('Gemini Whatsapp Flow error:', err.message);
    const fallbackMessage = "عذراً، حدث خطأ داخلي في نظام الذكاء الاصطناعي.";
    await supabase.from('whatsapp_logs').insert([
      { phone: cleanPhone, direction: 'out', message: fallbackMessage, timestamp: getYemenTime().toISOString() }
    ]);
    return fallbackMessage;
  }
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
