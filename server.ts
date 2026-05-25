/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

// Force a robust, crash-safe local file setup that handles serverless deployment (like Vercel) gracefully
const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
let memoryDb: DbState | null = null;
let isSavingToSupabase = false;

const DB_FILE = isVercel
  ? path.join('/tmp', 'db.json')
  : path.join(process.cwd(), 'data', 'db.json');

// Full-proof utility to ensure DB state has all required keys & default users
function ensureDbDefaults(db: any): DbState {
  if (!db || typeof db !== 'object') {
    db = {};
  }
  if (!db.doctors) db.doctors = [];
  if (!db.schedules) db.schedules = [];
  if (!db.bookings) db.bookings = [];
  if (!db.bot_sessions) db.bot_sessions = {};
  if (!db.whatsapp_logs) db.whatsapp_logs = [];
  
  if (!db.whatsapp_settings) {
    db.whatsapp_settings = {
      id: 1,
      webhook_verify_token: 'doctors_tower_verify_token_123',
      access_token: '',
      app_secret: '',
      phone_number_id: '',
      is_active: true
    };
  }
  
  if (!db.system_settings) {
    db.system_settings = {
      id: 1,
      receptionist_name_required: false,
      admin_password: '123'
    };
  }

  const defaultUsers = [
    { id: 'u-tadkeera', username: 'tadkeera@gmail.com', password: 'WALEED770@', role: 'admin', employee_name: 'مدير تذكرة (Tadkeera Admin)' },
    { id: 'u-1', username: 'admin', password: '123', role: 'admin', employee_name: 'مدير النظام الرئيسي' },
    { id: 'u-2', username: 'receptionist', password: 'receptionist', role: 'receptionist', employee_name: 'موظف الاستقبال الافتراضي' }
  ];

  if (!db.users || !Array.isArray(db.users)) {
    db.users = defaultUsers;
  } else {
    // Add missing default users
    defaultUsers.forEach(defUser => {
      const exists = db.users.some((u: any) => u.username.trim().toLowerCase() === defUser.username.toLowerCase());
      if (!exists) {
        db.users.push(defUser);
      }
    });

    db.users = db.users.map((u: any) => {
      if (!u.employee_name) {
        u.employee_name = u.role === 'admin' 
          ? (u.username === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : 'مدير النظام الرئيسي') 
          : 'موظف الاستقبال الافتراضي';
      }
      return u;
    });
  }

  return db as DbState;
}

// Function to load db state from Supabase dynamically on startup
async function loadDbFromSupabase(): Promise<DbState | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log('[SupabaseStorage] Supabase is not configured yet. Using local filesystem DB.');
    return null;
  }

  try {
    const supabase = getSupabase();
    console.log('[SupabaseStorage] Loading persistent DB state from Supabase bot_sessions table...');
    const { data, error } = await supabase
      .from('bot_sessions')
      .select('patient_name')
      .eq('phone', 'STORED_DB_STATE')
      .maybeSingle();

    if (error) {
      console.warn('[SupabaseStorage] Failed to query Supabase state (likely table bot_sessions does not exist yet):', error.message);
      return null;
    }

    if (data && data.patient_name) {
      const parsed = JSON.parse(data.patient_name);
      if (parsed && typeof parsed === 'object') {
        console.log('[SupabaseStorage] Successfully loaded persistent DB state from Supabase.');
        return ensureDbDefaults(parsed);
      }
    }
    console.log('[SupabaseStorage] No persistent DB state found in Supabase (starting fresh).');
  } catch (err) {
    console.warn('[SupabaseStorage] Exception encountered while restoring DB from Supabase:', err);
  }
  return null;
}

let dbSaveQueue: Promise<void> = Promise.resolve();
let currentSavePromise: Promise<void> = Promise.resolve();

let isDbHydrated = false;
let dbHydrationPromise: Promise<void> | null = null;

function ensureDbHydrated(): Promise<void> {
  if (isDbHydrated && memoryDb) {
    return Promise.resolve();
  }
  if (!dbHydrationPromise) {
    dbHydrationPromise = (async () => {
      try {
        const supabaseState = await loadDbFromSupabase();
        if (supabaseState) {
          memoryDb = supabaseState;
          console.log('[Database] Hydrated database successfully with Supabase remote key-value storage state.');
        } else {
          console.log('[Database] No remote backup state restored or Supabase not configured. Using local filesystem DB.');
          if (!memoryDb) {
            if (fs.existsSync(DB_FILE)) {
              try {
                const data = fs.readFileSync(DB_FILE, 'utf-8');
                memoryDb = ensureDbDefaults(JSON.parse(data));
              } catch (e) {
                memoryDb = ensureDbDefaults(null);
              }
            } else {
              memoryDb = ensureDbDefaults(null);
            }
          }
        }
      } catch (err) {
        console.error('[Database] Failed to coordinate Supabase state sync on cold-start/hydration:', err);
        if (!memoryDb) {
          memoryDb = ensureDbDefaults(null);
        }
      } finally {
        isDbHydrated = true;
      }
    })();
  }
  return dbHydrationPromise;
}

// Function to save db state backup directly to Supabase table
async function saveDbToSupabase(db: DbState): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  // Append this write to the global sequential queue
  dbSaveQueue = dbSaveQueue.then(async () => {
    try {
      const supabase = getSupabase();
      // Always use the latest in-memory copy if it exists, to prevent older states overriding new ones
      const latestDb = memoryDb || db;
      const serialized = JSON.stringify(latestDb);

      const { error } = await supabase
        .from('bot_sessions')
        .upsert({
          phone: 'STORED_DB_STATE',
          patient_name: serialized,
          current_state: 'SYSTEM',
          last_interaction_at: getYemenTime().toISOString()
        }, {
          onConflict: 'phone'
        });

      if (error) {
        console.warn('[SupabaseStorage] Error backing up state to Supabase:', error.message);
      } else {
        console.log('[SupabaseStorage] Successfully backed up database state to Supabase.');
      }
    } catch (err: any) {
      console.warn('[SupabaseStorage] Exception encountered while saving DB to Supabase:', err);
    }
  });

  return dbSaveQueue;
}

// Ensure data directory exists if not on Vercel
if (!isVercel) {
  try {
    const dataDir = path.dirname(DB_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err) {
    console.warn('[Storage] Could not create directory for database:', err);
  }
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

// Initialize and Seed JSON Database file safely without blocking or triggering EROFS on Vercel
try {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    console.log(`[Database] Initialized new database file successfully at ${DB_FILE}`);
  } else {
    console.log(`[Database] Loaded existing database file from ${DB_FILE}`);
  }
} catch (err) {
  console.warn('[Database] Failed to write database file. Falling back to in-memory db:', err);
  memoryDb = JSON.parse(JSON.stringify(defaultDb));
}

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
  if (memoryDb) {
    return memoryDb;
  }
  try {
    if (!fs.existsSync(DB_FILE)) {
      memoryDb = ensureDbDefaults(null);
      return memoryDb;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const db = JSON.parse(data);
    memoryDb = ensureDbDefaults(db);
    return memoryDb;
  } catch (err) {
    console.error('Error reading database file, returning default schema:', err);
    memoryDb = ensureDbDefaults(null);
    return memoryDb;
  }
}

function writeDb(db: DbState) {
  // Always update our local memoryDb copy first
  memoryDb = db;

  // Attempt local disk file sync (skipped gracefully on read-only serverless runtimes)
  try {
    if (!isVercel) {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Fs write db state skipped:', err.message);
  }

  // Trigger outbound backup sync and chain the promise so we can wait for completion before completing the HTTP request
  currentSavePromise = (async () => {
    try {
      await ensureDbHydrated();
      await saveDbToSupabase(db);
    } catch (err) {
      console.warn('[SupabaseStorage] Async state backup failed inside chain:', err);
    }
  })();
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

// Middleware to ensure Database is fully hydrated and loaded from Supabase before executing any route code
app.use(async (req, res, next) => {
  try {
    await ensureDbHydrated();
  } catch (err) {
    console.error('[Middleware] Error ensuring database hydration:', err);
  }
  next();
});

// Middleware to guarantee that any asynchronous database syncs (such as saving state to Supabase) 
// are fully completed before the Express server responds to the client, preventing Vercel thread suspensions
app.use((req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function (this: any, body: any) {
    currentSavePromise.finally(() => {
      originalJson.call(this, body);
    });
    return this;
  } as any;

  res.send = function (this: any, body: any) {
    currentSavePromise.finally(() => {
      originalSend.call(this, body);
    });
    return this;
  } as any;

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

  // Load local database first to determine if credentials are valid locally
  const db = readDb();
  const users = db.users || [];

  const foundUser = users.find(
    u => u.username.trim().toLowerCase() === cleanUser && u.password.trim() === cleanPass
  );

  const isHardcodedAdmin = (cleanUser === 'tadkeera@gmail.com' && cleanPass === 'WALEED770@');
  const isLocallyValid = !!foundUser || isHardcodedAdmin;

  // Try Supabase Auth code if configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = getSupabase();
      console.log(`[Auth] Attempting Supabase Auth sign-in for ${cleanUser}...`);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanUser,
        password: cleanPass
      });
      if (!error && data?.user) {
        console.log(`[Auth] Supabase login successful for ${cleanUser}!`);
        // If it's tadkeera or user_metadata says admin, make them admin
        const role = data.user.user_metadata?.role || (cleanUser === 'tadkeera@gmail.com' || cleanUser.includes('admin') ? 'admin' : 'receptionist');
        const empName = data.user.user_metadata?.name || (cleanUser === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : username);
        return res.json({
          success: true,
          role: role,
          token: `${role}-${data.user.id}`,
          receptionistName: empName
        });
      } else {
        // If the credentials are valid locally (like the default or hardcoded admin),
        // we can auto-register them in Supabase Auth to seed the user.
        if (isLocallyValid) {
          console.log(`[Auth] Credentials valid locally but missing or unverified in Supabase. Auto-syncing user ${cleanUser} to Supabase Auth...`);
          try {
            const signupRole = cleanUser === 'tadkeera@gmail.com' || cleanUser.includes('admin') ? 'admin' : 'receptionist';
            const signupName = cleanUser === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : (foundUser?.employee_name || username);

            // Attempt dynamic signup to seed Supabase Auth database
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
              email: cleanUser,
              password: cleanPass,
              options: {
                data: { role: signupRole, name: signupName }
              }
            });

            if (!signUpError && signUpData?.user) {
              console.log(`[Auth] Successfully registered and synced user ${cleanUser} in Supabase Auth!`);
              return res.json({
                success: true,
                role: signupRole,
                token: `${signupRole}-${signUpData.user.id}`,
                receptionistName: signupName
              });
            } else {
              const reason = signUpError ? signUpError.message : 'waiting for confirmation';
              console.log(`[Auth] Supabase auto-signup logged (${reason}). Proceeding with safe local fallback login.`);
            }
          } catch (signUpFail) {
            console.log('[Auth] Supabase signup helper bypassed. Proceeding with local fallback login.');
          }
        } else {
          if (error) {
            // Only log standard login failure warning if credentials do NOT match our database
            console.log(`[Auth] Invalid credentials login attempt for ${cleanUser}: ${error.message}`);
          }
        }
      }
    } catch (err) {
      console.log('[Auth] Supabase Auth check bypassed. Proceeding with local fallback login:', err);
    }
  }

  // Final Backup Local Database / Hardcoded fallback resolution
  if (isLocallyValid) {
    const role = (cleanUser === 'tadkeera@gmail.com' || (foundUser && foundUser.role === 'admin')) ? 'admin' : 'receptionist';
    const empName = cleanUser === 'tadkeera@gmail.com' ? 'مدير تذكرة (Tadkeera Admin)' : (foundUser?.employee_name || foundUser?.username || username);
    const userId = foundUser?.id || 'u-tadkeera';

    return res.json({
      success: true,
      role: role,
      token: `${role}-${userId}`,
      receptionistName: empName
    });
  }

  return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
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
app.post('/api/webhook/whatsapp', webhookRateLimit, async (req, res) => {
  const db = readDb();
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = db.whatsapp_settings.app_secret || process.env.META_APP_SECRET;

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

  // Parse Meta WhatsApp Cloud API body message
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messageObj = value?.messages?.[0];

  if (messageObj) {
    const fromPhone = messageObj.from; // e.g., '96777123456'
    
    // Core Bot state processing logic
    const botResponse = handleWhatsappFlow(fromPhone, messageObj);
    
    // Attempt dispatch via real Meta WhatsApp API if credentials are ready
    const accessToken = db.whatsapp_settings.access_token || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const phoneNumberId = db.whatsapp_settings.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
    const isWebhookActive = db.whatsapp_settings.is_active !== false;

    if (isWebhookActive && accessToken && phoneNumberId) {
      console.log(`[WhatsApp Webhook] Dispatching active API call for [+${fromPhone}] via Graph API...`);
      await sendWhatsAppMessage(fromPhone, botResponse, {
        access_token: accessToken,
        phone_number_id: phoneNumberId
      });
    } else {
      console.log(`[WhatsApp Webhook Simulated] Replayed [+${fromPhone}]: "${botResponse}" (Real API skipped: active=${isWebhookActive}, token=${!!accessToken}, phone=${!!phoneNumberId})`);
    }
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

  // FORCE RESET IF "تسجيل" IS SENT AT ANY STATE
  if (messageText === 'تسجيل') {
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
  }

  if (state === 'IDLE' || state === 'COMPLETED') {
    if (messageText === '1' || messageText.toLowerCase().includes('مرحبا') || messageText.toLowerCase().includes('سلام')) {
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

    // Go directly to day and date selection (using grouped date prompts with NO remaining seats mention)
    session.selected_shift = null;
    const { prompt } = getGroupedDatesForDoctor(doctor, db.schedules);
    return outputReply(prompt, 'SELECTING_DAY');
  }

  if (state === 'SELECTING_DAY') {
    const selectedIdx = parseInt(messageText) - 1;
    const doctor = db.doctors.find(d => d.id === session.selected_doctor_id!)!;
    
    const { options } = getGroupedDatesForDoctor(doctor, db.schedules);

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

      // Check Capacity for this specific schedule
      const currentBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.booking_date === option.date && b.schedule_id === matchedSchedule.id && b.status !== 'cancelled').length;
      if (currentBookings >= matchedSchedule.max_capacity) {
        return outputReply("اكتمل التسجيل في هذا اليوم، الرجاء اختيار يوم آخر", 'SELECTING_DAY');
      }

      // Check anti-spam limit
      if (doctor.limit_two_patients_per_number) {
        const patientBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.patient_phone === phone && b.status !== 'cancelled').length;
        if (patientBookings >= 2) {
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

    const doctor = db.doctors.find(d => d.id === session.selected_doctor_id!)!;
    const selectedDateStr = session.selected_date!;
    
    const { options } = getGroupedDatesForDoctor(doctor, db.schedules);
    const matchedOption = options.find(o => o.date === selectedDateStr);
    
    if (!matchedOption) {
      session.current_state = 'IDLE';
      db.bot_sessions[phone] = session;
      writeDb(db);
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

    // Check Capacity
    const currentBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.booking_date === selectedDateStr && b.schedule_id === matchedSchedule.id && b.status !== 'cancelled').length;
    if (currentBookings >= matchedSchedule.max_capacity) {
      return outputReply("عذراً، هذه الفترة متكاملة العدد للحجوزات لهذا اليوم. الرجاء إرسال 'تسجيل' لبدء الاختيار من جديد لموعد أو طبيب آخر.", 'IDLE');
    }

    // Check anti-spam limit
    if (doctor.limit_two_patients_per_number) {
      const patientBookings = db.bookings.filter(b => b.doctor_id === doctor.id && b.patient_phone === phone && b.status !== 'cancelled').length;
      if (patientBookings >= 2) {
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
    
    // Assign Sequential Queue Number (Separated per shift schedule block!)
    const existingBookings = db.bookings.filter(b => 
      b.doctor_id === doctorId && 
      b.booking_date === dateStr && 
      b.schedule_id === schedule.id &&
      b.status !== 'cancelled'
    );
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
  // Pre-hydrate/restore DB state from Supabase to provide zero-loss durability on cold-start
  try {
    await ensureDbHydrated();
    console.log('[Database] Database initial setup and hydration completed.');
  } catch (err) {
    console.error('[Database] Failed to coordinate Supabase state sync on cold-start:', err);
  }

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
    console.log(`Persisting DB to: ${DB_FILE}`);
  });
}

startServer();

export default app;
