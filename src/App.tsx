/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Doctor, Schedule, Booking } from './types';
import Login from './components/Login';
import DoctorsTab from './components/DoctorsTab';
import SchedulesTab from './components/SchedulesTab';
import BookingsTab from './components/BookingsTab';
import SettingsTab from './components/SettingsTab';
import SimulatorTab from './components/SimulatorTab';
import AccessSettingsTab from './components/AccessSettingsTab';
import { ShieldCheck, UserCheck, Stethoscope, BookOpen, Clock, PhoneCall, HelpCircle, LogOut, ClipboardList, CalendarDays, Bot, CloudCog, Lock, Users, User } from 'lucide-react';
import { HOSPITAL_LOGO } from './utils/constants';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      return localStorage.getItem('isLoggedIn') === 'true';
    } catch {
      return false;
    }
  });

  const [role, setRole] = useState<'admin' | 'receptionist'>(() => {
    try {
      return (localStorage.getItem('role') as 'admin' | 'receptionist') || 'admin';
    } catch {
      return 'admin';
    }
  });

  const [receptionistName, setReceptionistName] = useState<string | null>(() => {
    try {
      return localStorage.getItem('receptionistName');
    } catch {
      return null;
    }
  });

  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('authToken');
    } catch {
      return null;
    }
  });

  // Core database state arrays
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // Tab control
  const [activeTab, setActiveTab] = useState<'doctors' | 'schedules' | 'bookings' | 'simulator' | 'settings' | 'access_settings'>('bookings');

  // Loading/Refresh triggering helpers
  const [loading, setLoading] = useState(true);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // References to handle AbortControllers and delayed execution timers safely
  const abortControllerRef = useRef<AbortController | null>(null);
  const syncTimeoutRef = useRef<any>(null);

  const fetchAllData = async () => {
    // 1. Immediately abort any other in-flight requests under this controller
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 2. Instantiate a fresh AbortController for this fetch cycle
    const currentController = new AbortController();
    abortControllerRef.current = currentController;
    const { signal } = currentController;

    try {
      // 1. Fetch Doctors
      const docsRes = await fetch('/api/doctors', { signal });
      if (!docsRes.ok) {
        throw new Error(`تعذر جلب الأطباء (الحالة ${docsRes.status})`);
      }
      const docsData = await docsRes.json();
      if (Array.isArray(docsData)) {
        setDoctors(docsData);
      } else {
        throw new Error('تنسيق بيانات الأطباء غير صالح');
      }

      // 2. Fetch Schedules
      const schRes = await fetch('/api/schedules', { signal });
      if (!schRes.ok) {
        throw new Error(`تعذر جلب جدول المواعيد (الحالة ${schRes.status})`);
      }
      const schData = await schRes.json();
      if (Array.isArray(schData)) {
        setSchedules(schData);
      } else {
        throw new Error('تنسيق بيانات جدول المواعيد غير صالح');
      }

      // 3. Fetch Bookings
      const bookRes = await fetch('/api/bookings', { signal });
      if (!bookRes.ok) {
        throw new Error(`تعذر جلب الحجوزات (الحالة ${bookRes.status})`);
      }
      const bookData = await bookRes.json();
      if (Array.isArray(bookData)) {
        setBookings(bookData);
      } else {
        throw new Error('تنسيق بيانات الحجوزات غير صالح');
      }

      // If we reach here, all data was pulled successfully, reset any prior sync errors.
      setFetchError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Ignored: abort is expected and clean
        return;
      }
      console.warn('Dashboard background sync notice:', err.message || err);
      setFetchError('تنبيه: تعذر تحديث البيانات في الخلفية. يرجى التحقق من الاتصال بالخادم وقاعدة البيانات.');
    } finally {
      // Only transition loading to false if this was the latest requests controller
      if (abortControllerRef.current === currentController) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;

    let isMounted = true;

    const runSyncLoop = async () => {
      if (!isMounted) return;
      await fetchAllData();
      
      if (isMounted) {
        // Debounce / Delay subsequent background sync triggers by 3000ms sequentially
        // as requested, keeping Vercel, Supabase, and WhatsApp server states perfectly synchronized.
        syncTimeoutRef.current = setTimeout(runSyncLoop, 3000);
      }
    };

    // Debounce the initial trigger by 500ms on mount/hot-reload
    syncTimeoutRef.current = setTimeout(runSyncLoop, 500);

    return () => {
      isMounted = false;
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isLoggedIn]);

  const handleLoginSuccess = (userRole: 'admin' | 'receptionist', token: string, name: string | null) => {
    try {
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('role', userRole);
      localStorage.setItem('authToken', token);
      if (name) {
        localStorage.setItem('receptionistName', name);
      } else {
        localStorage.removeItem('receptionistName');
      }
    } catch (e) {
      console.warn('LocalStorage access failed:', e);
    }

    setRole(userRole);
    setAuthToken(token);
    setReceptionistName(name);
    setIsLoggedIn(true);
    // If receptionist, start on Bookings tab rather than settings or simulator
    if (userRole === 'receptionist') {
      setActiveTab('bookings');
    }
  };

  const handleLogout = async () => {
    // Abort any active fetches and clear polling timer immediately on logout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Backend logout failed:', err);
    }

    try {
      localStorage.clear();
    } catch (e) {
      console.warn('LocalStorage access failed:', e);
    }

    // Force flush data state cache immediately to prevent session token/data leakage
    setDoctors([]);
    setSchedules([]);
    setBookings([]);
    setIsLoggedIn(false);
    setAuthToken(null);
    setRole('admin');
    setReceptionistName(null);
  };

  // -------------------------------------------------------------------------
  // DOCTOR ACTIONS Proxied to Server
  // -------------------------------------------------------------------------
  const handleAddDoctor = async (doc: { name: string; specialty: string; is_active: boolean; allow_second_week_booking?: boolean; limit_two_patients_per_number?: boolean }) => {
    const res = await fetch('/api/doctors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add doctor');
    }
    await fetchAllData();
  };

  const handleEditDoctor = async (id: string, doc: { name: string; specialty: string; is_active: boolean; allow_second_week_booking?: boolean; limit_two_patients_per_number?: boolean }) => {
    const res = await fetch(`/api/doctors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to edit doctor');
    }
    await fetchAllData();
  };

  const handleDeleteDoctor = async (id: string) => {
    const res = await fetch(`/api/doctors/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete doctor');
    }
    await fetchAllData();
  };

  // -------------------------------------------------------------------------
  // SCHEDULE ACTIONS Proxied to Server
  // -------------------------------------------------------------------------
  const handleAddSchedule = async (sch: { doctor_id: string; day_of_week: number; max_capacity: number; start_time: string; end_time: string }) => {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sch),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add schedule');
    }
    await fetchAllData();
  };

  const handleEditSchedule = async (id: string, updates: { max_capacity: number; start_time: string; end_time: string }) => {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to edit schedule');
    }
    await fetchAllData();
  };

  const handleDeleteSchedule = async (id: string) => {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete schedule');
    }
    await fetchAllData();
  };

  // -------------------------------------------------------------------------
  // BOOKINGS ACTIONS Proxied to Server
  // -------------------------------------------------------------------------
  const handleAddBooking = async (b: { doctor_id: string; schedule_id: string; patient_name: string; patient_phone: string; booking_date: string }) => {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add booking');
    }
    await fetchAllData();
  };

  const handleEditBooking = async (id: string, updates: any) => {
    const res = await fetch(`/api/bookings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update booking');
    }
    await fetchAllData();
  };

  const handleDeleteBooking = async (id: string) => {
    const res = await fetch(`/api/bookings/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete booking');
    }
    await fetchAllData();
  };

  // -------------------------------------------------------------------------
  // STATS COMPUTATION FOR DASHBOARD OVERVIEW
  // -------------------------------------------------------------------------
  const activeDoctorsCount = doctors.filter(d => d.is_active).length;
  const totalBookingsTodayCount = bookings.length;
  const confirmedBookingsCount = bookings.filter(b => b.status === 'confirmed').length;
  const pendingBookingsCount = bookings.filter(b => b.payment_status === 'pending' && b.status !== 'cancelled').length;

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="app-root-container" className="min-h-screen bg-slate-50 flex flex-col font-sans" dir="rtl">
      
      {/* 1. TOP HEADER BRAND BAR */}
      <header id="app-header" className="m-4 md:m-6 rounded-[24px] bg-white border border-slate-100 shadow-[0_15px_35px_rgba(15,76,129,0.08)] sticky top-4 z-40 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Left/Center: Circular branding Logo and titles */}
        <div className="flex flex-col md:flex-row items-center gap-5 space-x-reverse text-center md:text-right font-sans">
          <div className="relative flex-shrink-0">
            <img
              id="brand-logo"
              src={HOSPITAL_LOGO}
              alt="شعار مستشفى برج الأطباء"
              className="w-20 h-20 md:w-24 md:h-24 rounded-full border-2 border-[#0f4c81]/20 p-1 object-cover shadow-2xs"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="flex flex-col items-center md:items-start">
            <h1 id="brand-title" className="text-xl md:text-2xl font-black text-[#0f4c81] leading-tight tracking-tight">
              نظام إدارة التسجيل - مستشفى برج الأطباء
            </h1>
            <p id="brand-sub" className="text-sm md:text-base font-bold text-slate-700 mt-2">
              لوحة إدارة العيادات
            </p>
          </div>
        </div>

        {/* Right Badge / Interactive User Dropdown Trigger */}
        <div className="relative flex-shrink-0">
          <button
            id="app-user-dropdown-trigger"
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 transition-all shadow-2xs hover:shadow-xs font-bold text-slate-700 cursor-pointer"
            title="معلومات الحساب"
          >
            <User className="h-5 w-5 text-[#0f4c81]" />
            <span className="text-xs font-black">{receptionistName || 'مدير مجهول'}</span>
            <span className="text-[10px] bg-[#0f4c81]/10 text-[#0f4c81] px-2 py-0.5 rounded-lg font-black">
              {role === 'admin' ? 'Admin' : 'استقبال'}
            </span>
          </button>

          {showUserDropdown && (
            <div id="user-dropdown-box" className="absolute left-0 mt-3 w-64 bg-white border border-slate-150 shadow-[0_15px_35px_rgba(0,0,0,0.1)] rounded-[20px] p-4 z-50 text-right animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="text-[11px] text-slate-400 font-bold mb-1">المستخدم الحالي</div>
              <div className="text-base font-black text-slate-800 mb-3">{receptionistName || 'مدير مجهول'} 👥</div>
              
              <div className="h-px bg-slate-100 my-2.5" />

              <div className="text-[11px] text-slate-400 font-bold mb-1">نوع الحساب</div>
              <div id="dropdown-role-tag" className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black ${
                role === 'admin' ? 'bg-sky-50 text-sky-800 border border-sky-150' : 'bg-amber-50 text-[#b45309] border border-amber-150'
              }`}>
                {role === 'admin' ? 'مدير النظام (Admin)' : 'موظف استقبال (Receptionist)'}
              </div>

              <div className="h-px bg-slate-100 my-3.5" />

              {/* Logout Button */}
              <button
                id="app-dropdown-logout-btn"
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-black transition-all shadow-2xs hover:shadow-xs cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {fetchError && (
        <div id="fetch-warning-banner" className="mx-4 md:mx-8 mt-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-2xl flex items-center justify-between text-xs font-medium" dir="rtl">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">⚠️</span>
            <span>{fetchError}</span>
          </div>
          <button 
            type="button"
            onClick={() => fetchAllData()} 
            className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 rounded-lg text-amber-900 font-bold transition-all cursor-pointer"
          >
            إعادة المحاولة الدوريّة 🔄
          </button>
        </div>
      )}

      {/* 2. STATS KPI DASHBOARD SUMMARY (Only visible on bookings tab) */}
      {activeTab === 'bookings' && (
        <section id="stats-summary" className="px-4 md:px-8 mt-5 mb-1">
          <div className="bg-white border border-slate-100 shadow-xs rounded-[24px] p-2 md:p-3 flex flex-col md:flex-row items-stretch justify-between divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-100 max-w-7xl mx-auto">
            
            {/* KPI 4 (Rightmost in RTL - Index 3 visually): قرارات مؤكدة */}
            <div className="flex-1 flex items-center justify-between px-6 py-3 min-w-0">
              <div className="flex items-center gap-4 justify-between w-full">
                <div className="flex flex-col text-right">
                  <span className="text-xs md:text-sm font-bold text-slate-500 leading-tight">قرارات مؤكدة</span>
                  <span id="stat-confirmed" className="text-2xl md:text-3xl font-black text-emerald-600 mt-1 font-mono leading-none">
                    {confirmedBookingsCount}
                  </span>
                </div>
                <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-[14px] flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* KPI 3 (Index 2 visually): كادر طبي نشط */}
            <div className="flex-1 flex items-center justify-between px-6 py-3 min-w-0">
              <div className="flex items-center gap-4 justify-between w-full">
                <div className="flex flex-col text-right">
                  <span className="text-xs md:text-sm font-bold text-slate-500 leading-tight">كادر طبي نشط</span>
                  <span id="stat-doctors" className="text-2xl md:text-3xl font-black text-sky-600 mt-1 font-mono leading-none">
                    {activeDoctorsCount}
                  </span>
                </div>
                <div className="h-12 w-12 bg-sky-50 text-sky-600 rounded-[14px] flex items-center justify-center flex-shrink-0">
                  <Stethoscope className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* KPI 2 (Index 1 visually): بانتظار سداد */}
            <div className="flex-1 flex items-center justify-between px-6 py-3 min-w-0">
              <div className="flex items-center gap-4 justify-between w-full">
                <div className="flex flex-col text-right">
                  <span className="text-xs md:text-sm font-bold text-slate-500 leading-tight">بانتظار سداد</span>
                  <span id="stat-pending" className="text-2xl md:text-3xl font-black text-amber-600 mt-1 font-mono leading-none">
                    {pendingBookingsCount}
                  </span>
                </div>
                <div className="h-12 w-12 bg-amber-50 text-amber-600 rounded-[14px] flex items-center justify-center flex-shrink-0">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* KPI 1 (Leftmost in RTL - Index 0 visually): حجوزات مفتوحة */}
            <div className="flex-1 flex items-center justify-between px-6 py-3 min-w-0">
              <div className="flex items-center gap-4 justify-between w-full">
                <div className="flex flex-col text-right">
                  <span className="text-xs md:text-sm font-bold text-slate-500 leading-tight">حجوزات مفتوحة</span>
                  <span id="stat-bookings" className="text-2xl md:text-3xl font-black text-violet-600 mt-1 font-mono leading-none">
                    {totalBookingsTodayCount}
                  </span>
                </div>
                <div className="h-12 w-12 bg-violet-50 text-violet-600 rounded-[14px] flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-6 w-6" />
                </div>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* 3. STICKY BOTTOM NAVIGATION BAR */}
      <nav id="app-nav-bottom" className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t-3 border-[#0f4c81]/20 shadow-[0_-12px_40px_rgba(15,76,129,0.08)] flex items-center justify-around h-24 px-2 md:px-6 select-none" dir="rtl">
        {/* Tab 1: العيادات المتاحة */}
        <button
          id="tab-bookings"
          onClick={() => setActiveTab('bookings')}
          className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
            activeTab === 'bookings'
              ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
              : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
          }`}
        >
          {activeTab === 'bookings' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
          <ClipboardList className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'bookings' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/45'}`} />
          <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">العيادات المتاحة</span>
        </button>

        {role === 'admin' && (
          <>
            {/* Tab 2: أطباء المستشفى */}
            <button
              id="tab-doctors"
              onClick={() => setActiveTab('doctors')}
              className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
                activeTab === 'doctors'
                  ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
                  : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
              }`}
            >
              {activeTab === 'doctors' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
              <Users className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'doctors' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/45'}`} />
              <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">أطباء المستشفى</span>
            </button>

            {/* Tab 3: جداول دوام الأطباء */}
            <button
              id="tab-schedules"
              onClick={() => setActiveTab('schedules')}
              className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
                activeTab === 'schedules'
                  ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
                  : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
              }`}
            >
              {activeTab === 'schedules' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
              <CalendarDays className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'schedules' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/45'}`} />
              <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">جداول الدوام</span>
            </button>

            {/* Tab 4: محاكي محادثات الواتساب */}
            <button
              id="tab-simulator"
              onClick={() => setActiveTab('simulator')}
              className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
                activeTab === 'simulator'
                  ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
                  : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
              }`}
            >
              {activeTab === 'simulator' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
              <Bot className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'simulator' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/45'}`} />
              <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">محاكي الواتساب</span>
            </button>

            {/* Tab 5: إعدادات الخادم والربط */}
            <button
              id="tab-settings"
              onClick={() => setActiveTab('settings')}
              className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
                  : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
              }`}
            >
              {activeTab === 'settings' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
              <CloudCog className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'settings' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/45'}`} />
              <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">إعدادات الخادم</span>
            </button>

            {/* Tab 6: إعدادات الحسابات والدخول */}
            <button
              id="tab-access-settings"
              onClick={() => setActiveTab('access_settings')}
              className={`relative flex-1 max-w-[170px] my-1 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all text-center px-1 md:px-3 h-20 cursor-pointer ${
                activeTab === 'access_settings'
                  ? 'bg-[#0f4c81]/5 text-[#0f4c81] font-black scale-[1.03]'
                  : 'text-[#0f4c81]/60 hover:text-[#0f4c81] hover:bg-slate-50/70 font-bold'
              }`}
            >
              {activeTab === 'access_settings' && <span className="absolute top-0 left-6 right-6 h-1.5 bg-[#0f4c81] rounded-b-full shadow-[0_2px_10px_rgba(15,76,129,0.5)]" />}
              <Lock className={`h-5 w-5 sm:h-5.5 sm:w-5.5 transition-all duration-300 ${activeTab === 'access_settings' ? 'scale-110 text-[#0f4c81]' : 'text-[#0f4c81]/40'}`} />
              <span className="text-[16pt] font-sans leading-tight text-[#0f4c81] font-bold">حسابات الدخول</span>
            </button>
          </>
        )}
      </nav>

      {/* 4. MAIN CONTENT AREA */}
      <main id="app-main" className="flex-1 p-4 md:p-8 pb-24 sm:pb-28">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 space-y-2">
            <span className="animate-spin text-xl font-mono">⌛</span>
            <span className="text-xs font-bold font-sans">جاري تحميل ومزامنة بيانات مستشفى برج الأطباء...</span>
          </div>
        ) : (
          <>
            {activeTab === 'bookings' && (
              <BookingsTab
                bookings={bookings}
                doctors={doctors}
                schedules={schedules}
                role={role}
                receptionistName={receptionistName}
                onAddBooking={handleAddBooking}
                onEditBooking={handleEditBooking}
                onDeleteBooking={handleDeleteBooking}
                onRefresh={fetchAllData}
              />
            )}

            {activeTab === 'doctors' && role === 'admin' && (
              <DoctorsTab
                doctors={doctors}
                role={role}
                onAddDoctor={handleAddDoctor}
                onEditDoctor={handleEditDoctor}
                onDeleteDoctor={handleDeleteDoctor}
              />
            )}

            {activeTab === 'schedules' && role === 'admin' && (
              <SchedulesTab
                schedules={schedules}
                doctors={doctors}
                role={role}
                onAddSchedule={handleAddSchedule}
                onEditSchedule={handleEditSchedule}
                onDeleteSchedule={handleDeleteSchedule}
              />
            )}

            {activeTab === 'simulator' && role === 'admin' && (
              <SimulatorTab onSendMessageCallback={fetchAllData} />
            )}

            {activeTab === 'settings' && role === 'admin' && (
              <SettingsTab role={role} onReloadAllData={fetchAllData} />
            )}

            {activeTab === 'access_settings' && role === 'admin' && (
              <AccessSettingsTab currentUserRole={role} />
            )}
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer id="app-footer" className="bg-white border-t border-slate-100 py-4 px-4 text-center text-[10px] md:text-xs text-slate-400">
        نظام إدارة وحجوزات مستشفى برج الأطباء - جميع الحقوق محفوظة © 2026. بتوقيت اليمن (Asia/Aden, UTC+3).
      </footer>
    </div>
  );
}
