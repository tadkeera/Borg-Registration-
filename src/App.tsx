/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { HOSPITAL_LOGO } from './utils/constants';
import { Doctor, Schedule, Booking } from './types';
import Login from './components/Login';
import DoctorsTab from './components/DoctorsTab';
import SchedulesTab from './components/SchedulesTab';
import BookingsTab from './components/BookingsTab';
import SettingsTab from './components/SettingsTab';
import SimulatorTab from './components/SimulatorTab';
import AccessSettingsTab from './components/AccessSettingsTab';
import { ShieldCheck, UserCheck, Stethoscope, BookOpen, Clock, PhoneCall, HelpCircle, LogOut } from 'lucide-react';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState<'admin' | 'receptionist'>('admin');
  const [receptionistName, setReceptionistName] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Core database state arrays
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  
  // Tab control
  const [activeTab, setActiveTab] = useState<'doctors' | 'schedules' | 'bookings' | 'simulator' | 'settings' | 'access_settings'>('bookings');

  // Loading/Refresh triggering helpers
  const [loading, setLoading] = useState(true);

  const fetchAllData = async () => {
    try {
      const docsRes = await fetch('/api/doctors');
      const docsData = await docsRes.json();
      setDoctors(docsData);

      const schRes = await fetch('/api/schedules');
      const schData = await schRes.json();
      setSchedules(schData);

      const bookRes = await fetch('/api/bookings');
      const bookData = await bookRes.json();
      setBookings(bookData);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchAllData();
    }
  }, [isLoggedIn]);

  const handleLoginSuccess = (userRole: 'admin' | 'receptionist', token: string, name: string | null) => {
    setRole(userRole);
    setAuthToken(token);
    setReceptionistName(name);
    setIsLoggedIn(true);
    // If receptionist, start on Bookings tab rather than settings or simulator
    if (userRole === 'receptionist') {
      setActiveTab('bookings');
    }
  };

  const handleLogout = () => {
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
      <header id="app-header" className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-40 px-4 md:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3 space-x-reverse">
          <img
            id="brand-logo"
            src={HOSPITAL_LOGO}
            alt="شعار مستشفى برج الأطباء"
            className="h-14 w-14 object-contain"
            referrerPolicy="no-referrer"
          />
          <div>
            <h1 id="brand-title" className="text-base md:text-lg font-black text-slate-800 leading-tight">
              نظام إدارة التسجيل في مستشفى برج الأطباء
            </h1>
            <p id="brand-sub" className="text-[10px] md:text-xs text-slate-450 font-bold">
              لوحة تحكم إدارة العيادات والتنظيف الآلي وحجوزات الواتساب
            </p>
          </div>
        </div>

        {/* User Badge / Actions */}
        <div className="flex items-center gap-3">
          <div className="text-left sm:text-right font-sans">
            <span className="block text-xs font-black text-slate-705">
              المستخدم: {receptionistName || 'مدير مجهول'} 👥
            </span>
            <span id="user-role-tag" className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${
              role === 'admin' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
            }`}>
              {role === 'admin' ? 'مدير النظام (Admin)' : 'موظف استقبال (Receptionist)'}
            </span>
          </div>

          <div className="h-8 w-px bg-slate-100 mx-1" />

          {/* Logout trigger */}
          <button
            id="app-logout-btn"
            onClick={handleLogout}
            className="flex items-center justify-center p-2.5 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
            title="تسجيل الخروج"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 2. STATS KPI DASHBOARD SUMMARY */}
      <section id="stats-summary" className="px-4 md:px-8 pt-6 pb-2 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="block text-[10px] md:text-xs font-bold text-slate-400 leading-none">الكادر الطبي النشط</span>
            <span id="stat-doctors" className="block text-xl md:text-2xl font-black text-slate-800 mt-2 font-mono">
              {activeDoctorsCount}
            </span>
          </div>
          <div className="h-10 w-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center"><Stethoscope className="h-5.5 w-5.5" /></div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="block text-[10px] md:text-xs font-bold text-slate-400 leading-none">حجوزات العيادات المفتوحة</span>
            <span id="stat-bookings" className="block text-xl md:text-2xl font-black text-slate-800 mt-2 font-mono">
              {totalBookingsTodayCount}
            </span>
          </div>
          <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center"><BookOpen className="h-5.5 w-5.5" /></div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="block text-[10px] md:text-xs font-bold text-slate-400 leading-none">الأدوار والقرارات المؤكدة</span>
            <span id="stat-confirmed" className="block text-xl md:text-2xl font-black text-emerald-600 mt-2 font-mono">
              {confirmedBookingsCount}
            </span>
          </div>
          <div className="h-10 w-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center"><ShieldCheck className="h-5.5 w-5.5" /></div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="block text-[10px] md:text-xs font-bold text-slate-400 leading-none">بانتظار سداد الصندوق (عاجل)</span>
            <span id="stat-pending" className="block text-xl md:text-2xl font-black text-amber-600 mt-2 font-mono">
              {pendingBookingsCount}
            </span>
          </div>
          <div className="h-10 w-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center"><Clock className="h-5.5 w-5.5 animate-pulse" /></div>
        </div>
      </section>

      {/* 3. NAVIGATION TAB LIST */}
      <nav id="app-nav" className="px-4 md:px-8 py-3 flex items-center space-x-1 space-x-reverse border-b border-slate-100 overflow-x-auto bg-white/70 backdrop-blur">
        <button
          id="tab-bookings"
          onClick={() => setActiveTab('bookings')}
          className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
            activeTab === 'bookings'
              ? 'bg-blue-700 text-white shadow'
              : 'text-slate-500 hover:text-slate-705'
          }`}
        >
          📝 سجل المراجعات والحجوزات
        </button>

        {role === 'admin' && (
          <>
            <button
              id="tab-doctors"
              onClick={() => setActiveTab('doctors')}
              className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'doctors'
                  ? 'bg-blue-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-705'
              }`}
            >
              🩺 لوحة العيادات الكبرى
            </button>

            <button
              id="tab-schedules"
              onClick={() => setActiveTab('schedules')}
              className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'schedules'
                  ? 'bg-blue-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-705'
              }`}
            >
              🗓️ جداول دوام الأطباء
            </button>

            <button
              id="tab-simulator"
              onClick={() => setActiveTab('simulator')}
              className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'simulator'
                  ? 'bg-blue-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-705'
              }`}
            >
              🤖 محاكي محادثات الواتساب
            </button>

            <button
              id="tab-settings"
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'bg-blue-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-705'
              }`}
            >
              ⚙️ إعدادات الخادم والربط
            </button>

            <button
              id="tab-access-settings"
              onClick={() => setActiveTab('access_settings')}
              className={`px-4 py-2 text-xs md:text-sm font-black rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'access_settings'
                  ? 'bg-blue-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-705'
              }`}
            >
              🔐 إعدادات الحسابات والدخول
            </button>
          </>
        )}
      </nav>

      {/* 4. MAIN CONTENT AREA */}
      <main id="app-main" className="flex-1 p-4 md:p-8">
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
        نظام إدارة وحجوزات مستشفى برج الأطباء التخصصي - جميع الحقوق محفوظة © 2026. بتوقيت اليمن (Asia/Aden, UTC+3).
      </footer>
    </div>
  );
}
