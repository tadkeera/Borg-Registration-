/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Booking, Doctor, Schedule, BookingStatus, PaymentStatus } from '../types';
import { Search, Filter, Printer, CalendarClock, UserCheck, ShieldAlert, CircleAlert, PlusSquare, Trash2, X, CheckSquare, Coins, CalendarDays, Key, Hospital, ArrowLeft, Clock, AlertTriangle, CheckCircle, ChevronLeft } from 'lucide-react';
import { HOSPITAL_LOGO } from '../utils/constants';

function getYemenTime(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 3)); // Yemen UTC+3
}

interface BookingsTabProps {
  bookings: Booking[];
  doctors: Doctor[];
  schedules: Schedule[];
  role: 'admin' | 'receptionist';
  receptionistName: string | null;
  onAddBooking: (b: { doctor_id: string; schedule_id: string; patient_name: string; patient_phone: string; booking_date: string }) => Promise<void>;
  onEditBooking: (id: string, updates: { status?: BookingStatus; payment_status?: PaymentStatus; patient_name?: string }) => Promise<void>;
  onDeleteBooking: (id: string) => Promise<void>;
}

const ARABIC_DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

export default function BookingsTab({ bookings, doctors, schedules, role, receptionistName, onAddBooking, onEditBooking, onDeleteBooking }: BookingsTabProps) {
  const isAdmin = role === 'admin';
  const [selectedSchId, setSelectedSchId] = useState<string | null>(null);

  // New Date and Doctor Name filters for doctor cards view
  const [filterDate, setFilterDate] = useState<string>(getYemenTime().toISOString().split('T')[0]);
  const [filterDoctorId, setFilterDoctorId] = useState<string>('all');

  // Filters for selected scheduler's bookings
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [deleteBookingId, setDeleteBookingId] = useState<string | null>(null);

  // Manual booking modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('967');
  const [manualDate, setManualDate] = useState(filterDate);

  // Sync manual booking date with current filterDate
  useEffect(() => {
    setManualDate(filterDate);
  }, [filterDate]);

  // Helpers for mapping date to day of week
  const getDayOfWeekFromDate = (dateStr: string) => {
    if (!dateStr) return -1;
    const d = new Date(dateStr);
    const jsDay = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
    if (jsDay === 6) return 0; // Sat
    if (jsDay === 0) return 1; // Sun
    if (jsDay === 1) return 2; // Mon
    if (jsDay === 2) return 3; // Tue
    if (jsDay === 3) return 4; // Wed
    if (jsDay === 4) return 5; // Thu
    return -1; // Friday or weekend
  };

  const getArabicDayName = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const day = d.getDay();
    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return dayNames[day];
  };

  const targetDayOfWeek = getDayOfWeekFromDate(filterDate);

  // Filter schedules based on today/selected date and doctor name filter
  const displayedSchedules = schedules.filter(sch => {
    if (filterDoctorId !== 'all' && sch.doctor_id !== filterDoctorId) {
      return false;
    }
    return sch.day_of_week === targetDayOfWeek;
  });

  // Ticket modal
  const [activeTicket, setActiveTicket] = useState<Booking | null>(null);

  // States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Handle manual booking submit
  const handleManualBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchId) return;

    const sch = schedules.find(s => s.id === selectedSchId);
    if (!sch) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (!manualName.trim() || !manualPhone.trim() || !manualDate) {
        throw new Error('يرجى ملء كافة حقول التسجيل الأساسية.');
      }

      await onAddBooking({
        doctor_id: sch.doctor_id,
        schedule_id: sch.id,
        patient_name: manualName.trim(),
        patient_phone: manualPhone.trim(),
        booking_date: manualDate
      });

      setSuccess('🎉 تم إضافة حجز المريض وتوليد رقم الدور بنجاح!');
      setManualName('');
      setManualPhone('967');

      setTimeout(() => {
        setShowAddModal(false);
        setSuccess('');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'فشلت معالجة الحجز اليدوي.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: BookingStatus) => {
    try {
      await onEditBooking(id, { status });
    } catch (err: any) {
      alert(err.message || 'فشل تحديث حالة الحجز.');
    }
  };

  const handleUpdatePayment = async (id: string, payment_status: PaymentStatus) => {
    try {
      await onEditBooking(id, { payment_status });
    } catch (err: any) {
      alert(err.message || 'فشل تحديث حالة السداد.');
    }
  };

  const handleDeleteClick = (id: string) => {
    if (!isAdmin) return;
    setDeleteBookingId(id);
  };

  // Helper to get doctor corresponding to schedule
  const getDoctorForSchedule = (sch: Schedule) => {
    return doctors.find(d => d.id === sch.doctor_id);
  };

  // Filter patients booked on the selected doctor's schedule
  const currentSchedule = schedules.find(s => s.id === selectedSchId);
  const selectedDoctor = currentSchedule ? getDoctorForSchedule(currentSchedule) : null;

  const filteredBookings = bookings.filter(b => {
    if (b.schedule_id !== selectedSchId) return false;
    const matchesSearch = b.patient_name.toLowerCase().includes(search.toLowerCase()) || 
                          b.patient_phone.includes(search);
    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    const matchesPayment = paymentFilter === 'all' || b.payment_status === paymentFilter;
    return matchesSearch && matchesStatus && matchesPayment;
  });

  return (
    <div id="bookings-tab-layout" className="space-y-6 font-sans" dir="rtl">
      
      {/* 1. MASTER VIEW: Doctor schedule cards */}
      {!selectedSchId ? (
        <div className="space-y-6">
          <div className="border-b border-indigo-100/40 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 flex items-center gap-1.5">
                <Hospital className="h-5 w-5 text-blue-700" />
                سجل معاينات الأطباء والعيادات المتاحة
              </h2>
              <p className="text-xs text-slate-500 mt-1 font-bold">
                اضغط على كرت الطبيب أدناه لاستعراض وتوثيق ملفات المرضى المسجلين ووضع أدوار الحجز.
              </p>
            </div>
            
            {/* Display current date clearly */}
            <div className="bg-blue-50/70 border border-blue-100 text-blue-800 px-4 py-2 rounded-2xl flex items-center gap-2 text-xs">
              <CalendarClock className="h-4 w-4 text-blue-600" />
              <div>
                <span className="block font-black">تاريخ اليوم المحدد:</span>
                <span className="font-mono font-bold text-blue-700">{getArabicDayName(filterDate)}، {filterDate}</span>
              </div>
            </div>
          </div>

          {/* Interactive Date & Doctor Filters Panel */}
          <div className="bg-slate-50 p-4 border border-slate-150 rounded-2xl flex flex-col md:flex-row md:items-center gap-4 justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-black text-slate-700">خيارات تصفية العيادات المجدولة:</span>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col">
                <label className="text-[10px] font-black text-slate-500 mb-1">اختر التاريخ:</label>
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="px-3.5 py-1.5 text-xs bg-white border border-slate-200 text-slate-850 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] font-black text-slate-500 mb-1">تصفية باسم الطبيب:</label>
                <select
                  value={filterDoctorId}
                  onChange={(e) => setFilterDoctorId(e.target.value)}
                  className="px-3.5 py-1.5 text-xs bg-white border border-slate-200 text-slate-850 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold min-w-[200px]"
                >
                  <option value="all">كل الأطباء (All Doctors)</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {displayedSchedules.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400 text-xs">
              <p className="font-black text-slate-500 text-sm">لا توجد عيادات أو فترات مجدولة حالياً في هذا اليوم المختار.</p>
              <p className="mt-1 text-slate-400">يرجى اختيار تاريخ مغاير أو إضافة جداول للأطباء في لوحة المواعيد.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedSchedules.map((sch) => {
                const doc = getDoctorForSchedule(sch);
                if (!doc) return null;
                const isFull = sch.available_capacity === 0;
                const shiftText = sch.start_time === '15:00' ? 'فترة مسائية (Evening)' : 'فترة صباحية (Morning)';

                // Define distinct border color and 3D shadow styling based on doctor's specialty
                const getDoctorDesign = (specialty: string) => {
                  const s = specialty || '';
                  if (s.includes('أطفال') || s.includes('الأطفال')) {
                    return 'border-r-4 border-r-amber-500 shadow-[0_8px_30px_rgba(245,158,11,0.06)] hover:shadow-[0_20px_40px_rgba(245,158,11,0.13)]';
                  }
                  if (s.includes('نساء') || s.includes('ولادة') || s.includes('توليد') || s.includes('النساء')) {
                    return 'border-r-4 border-r-rose-500 shadow-[0_8px_30px_rgba(244,63,94,0.06)] hover:shadow-[0_20px_40px_rgba(244,63,94,0.13)]';
                  }
                  if (s.includes('باطنية') || s.includes('باطني') || s.includes('قلب') || s.includes('جراحة')) {
                    return 'border-r-4 border-r-indigo-500 shadow-[0_8px_30px_rgba(99,102,241,0.06)] hover:shadow-[0_20px_40px_rgba(99,102,241,0.13)]';
                  }
                  if (s.includes('أذن') || s.includes('عيون') || s.includes('جلدية')) {
                    return 'border-r-4 border-r-emerald-500 shadow-[0_8px_30px_rgba(16,185,129,0.06)] hover:shadow-[0_20px_40px_rgba(16,185,129,0.13)]';
                  }
                  return 'border-r-4 border-r-blue-600 shadow-[0_8px_30px_rgba(37,99,235,0.06)] hover:shadow-[0_20px_40px_rgba(37,99,235,0.13)]';
                };

                const cardDesign = getDoctorDesign(doc.specialty);

                return (
                  <div
                    key={sch.id}
                    onClick={() => {
                      setSelectedSchId(sch.id);
                      setSearch('');
                      setStatusFilter('all');
                      setPaymentFilter('all');
                    }}
                    className={`bg-white rounded-2xl p-6 border border-slate-100 cursor-pointer hover:-translate-y-1.5 transform transition-all duration-300 space-y-4 relative overflow-hidden group ${cardDesign} ${
                      isFull ? 'bg-red-50/15' : ''
                    }`}
                  >
                    {/* Shift Indicators */}
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black tracking-wide uppercase ${
                        sch.start_time === '15:00'
                          ? 'bg-amber-50 text-amber-700 border border-amber-100'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                      }`}>
                        {shiftText}
                      </span>
                      <span className="text-[10px] text-slate-500 font-black flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                        {ARABIC_DAYS[sch.day_of_week]}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-sm font-black text-slate-800 group-hover:text-blue-700 transition-colors">
                        {doc.name}
                      </h3>
                      <div className="flex items-center text-[10px] text-slate-500 font-bold gap-1 mt-1">
                        <span className="text-slate-400">🧬 التخصص:</span>
                        <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700">{doc.specialty}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                      <div className="text-right">
                        <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">السعة الكلية</span>
                        <span className="text-xl font-black text-slate-800 font-mono block mt-1 tracking-wider">{sch.max_capacity} حالات/اليوم</span>
                      </div>
                      <div className="text-left font-sans">
                        {isFull ? (
                          <div className="text-left">
                            <span className="block text-[10px] text-slate-400 font-bold uppercase text-left mb-1">المقاعد المتبقية</span>
                            <span className="inline-flex items-center justify-center text-red-600 font-black text-xs bg-red-50 px-3 py-1.5 rounded-xl border border-red-200 animate-pulse text-center">
                              المقاعد ممتلئة / اكتمل الحجز 🚫
                            </span>
                          </div>
                        ) : (
                          <div className="text-left">
                            <span className="block text-[10px] text-slate-400 font-bold uppercase text-left mb-1">المقاعد المتبقية</span>
                            <span className="text-xl font-black font-mono text-emerald-600 block bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100 text-center">
                              {sch.available_capacity} مقاعد متاحة
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick indicator arrow indicator inside back on hover */}
                    <div className="absolute left-3 top-3 opacity-0 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition-all duration-300">
                      <ChevronLeft className="h-4.5 w-4.5 text-slate-400 hover:text-blue-700" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 2. DETAIL VIEW: Selected clinician's booked patients list */
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-4 gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedSchId(null)}
                className="p-1.5 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 cursor-pointer"
                title="الرجوع لقائمة الأطباء"
              >
                <ArrowLeft className="h-4.5 w-4.5 text-slate-600" />
              </button>
              <div>
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-1.5">
                  حجوزات عيادة: {selectedDoctor?.name}
                </h2>
                <p className="text-xs text-slate-500 mt-1 font-bold">
                  {selectedDoctor?.specialty} | {ARABIC_DAYS[currentSchedule!.day_of_week]} | الفترة {currentSchedule!.start_time === '15:00' ? 'المسائية' : 'الصباحية'}
                </p>
              </div>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-3 py-2 bg-blue-700 text-white text-xs font-black rounded-xl hover:bg-blue-800 flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                >
                  <PlusSquare className="h-4 w-4" />
                  إدخال حجز لمريض جديد 🧑‍⚕️
                </button>
              </div>
            )}
          </div>

          {/* Table Filters Panel */}
          <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="ابحث بالاسم الثلاثي للمريض، أو برقم الهاتف والوالحق..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-550 transition-all font-bold"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg focus:outline-none transition-all font-bold font-sans"
                >
                  <option value="all">كل الحالات (جميعها)</option>
                  <option value="pending">⏳ معلق (Pending)</option>
                  <option value="confirmed">👥 مؤكد (Confirmed)</option>
                  <option value="cancelled">🚫 ملغي (Cancelled)</option>
                </select>
              </div>

              <div>
                <select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg focus:outline-none transition-all font-bold font-sans"
                >
                  <option value="all">كل الرسوم (مسدد/معلق)</option>
                  <option value="paid">✅ مسدد خالص</option>
                  <option value="pending">⏳ غير مسدد (معلق)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Bookings Table list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              {filteredBookings.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  لا توجد سجلات مطابقة للبحث أو معايير الفلترة المسندة لهذه العيادة واليوم.
                </div>
              ) : (
                <table className="min-w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-black text-slate-404 uppercase tracking-wider border-b border-slate-100">
                      <th className="px-4 py-3 text-right">رقم الدور (Queue)</th>
                      <th className="px-4 py-3 text-right">اسم المريض</th>
                      <th className="px-4 py-3 text-right">رقم الهاتف</th>
                      <th className="px-4 py-3 text-center">حالة السداد</th>
                      <th className="px-4 py-3 text-center">حالة الحجز</th>
                      <th className="px-2 py-3 text-center">التوعية وتذكرة الحجز</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBookings.map((b) => {
                      const ageDiffMs = getYemenTime().getTime() - new Date(b.created_at || '').getTime();
                      const spentHours = ageDiffMs / (3600000);
                      const isExpiredPending = b.status === 'pending' && b.payment_status === 'pending' && spentHours >= 48;

                      return (
                        <tr key={b.id} className="hover:bg-slate-50/50 transition-colors text-xs text-slate-800">
                          
                          {/* Queue number */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-blue-50 border border-blue-100 text-xs font-black text-blue-700 font-mono">
                              {b.queue_number}
                            </span>
                          </td>

                          {/* Patient name */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="font-sans font-black text-slate-800">{b.patient_name}</div>
                              {isAdmin && (
                                <button
                                  onClick={() => handleDeleteClick(b.id)}
                                  className="p-1 text-red-500 hover:bg-red-50 rounded border border-red-100 transition-all duration-200 cursor-pointer"
                                  title="حذف الحجز"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            <div className="text-[9px] text-slate-400 mt-0.5">
                              {b.verified_by_whatsapp ? (
                                <span className="text-emerald-600 font-black">🤖 حجز بالبوت</span>
                              ) : (
                                <span className="text-blue-600 font-black">🏢 تسجيل يدوي</span>
                              )}
                              {receptionistName && <span className="text-slate-400 mr-1">• الموثق: {receptionistName}</span>}
                            </div>
                          </td>

                          {/* Patient phone */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono text-slate-600 font-bold">
                              +{b.patient_phone}
                            </span>
                          </td>

                          {/* Payment status */}
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            {isAdmin ? (
                              <select
                                value={b.payment_status}
                                onChange={(e) => handleUpdatePayment(b.id, e.target.value as PaymentStatus)}
                                className={`px-2 py-0.5 text-[10px] font-black rounded-md border focus:outline-none focus:ring-1.2 cursor-pointer ${
                                  b.payment_status === 'paid'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : b.payment_status === 'cancelled'
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                              >
                                <option value="pending">⏳ معلق</option>
                                <option value="paid">✅ مسدد</option>
                                <option value="cancelled">❌ ملغي</option>
                              </select>
                            ) : (
                              <span className={`inline-flex px-25 py-0.5 rounded text-[10px] font-bold ${
                                b.payment_status === 'paid'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}>
                                {b.payment_status === 'paid' ? 'خالص الرسوم' : 'معلق السداد'}
                              </span>
                            )}

                            {isExpiredPending && (
                              <span className="block text-[8px] font-bold text-red-500 mt-1 flex items-center justify-center animate-bounce">
                                <CircleAlert className="h-2.5 w-2.5 ml-0.5" />
                                تجاوز 48 ساعة! (انتهى)
                              </span>
                            )}
                          </td>

                          {/* Visit status */}
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            {isAdmin ? (
                              <select
                                value={b.status}
                                onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                                className={`px-2 py-0.5 text-[10px] font-black rounded-md border focus:outline-none focus:ring-1.2 cursor-pointer ${
                                  b.status === 'confirmed'
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : b.status === 'cancelled'
                                    ? 'bg-slate-105 text-slate-500 border-slate-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-205'
                                }`}
                              >
                                <option value="pending">⏳ انتظار</option>
                                <option value="confirmed">👥 مؤكد</option>
                                <option value="cancelled">🚫 ملغي</option>
                              </select>
                            ) : (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                                b.status === 'confirmed'
                                  ? 'bg-blue-50 text-blue-700'
                                  : b.status === 'cancelled'
                                  ? 'bg-slate-100 text-slate-400'
                                  : 'bg-amber-50 text-amber-700'
                              }`}>
                                {b.status === 'confirmed' ? 'دور مؤكد' : b.status === 'cancelled' ? 'ملغي' : 'بانتظار التأكيد'}
                              </span>
                            )}
                          </td>

                          {/* Ticket action / print */}
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setActiveTicket(b)}
                                className="p-1 px-2 hover:bg-slate-50 text-slate-600 rounded border border-slate-200 transition-colors text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                              >
                                <Printer className="h-3 w-3" />
                                كرت الحجز
                              </button>

                              {isAdmin && (
                                <button
                                  onClick={() => handleDeleteClick(b.id)}
                                  className="p-1 text-red-650 hover:bg-red-50 rounded border border-red-100 transition-all cursor-pointer"
                                  title="حذف الحجز نهائياً"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Booking Modal */}
      {showAddModal && selectedSchId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-105 flex justify-between items-center bg-slate-50">
              <h3 className="text-sm font-black text-slate-800">حجز موعد يدوي جديد</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold m-4 rounded-xl border border-red-100">{error}</div>}
            {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-xs font-semibold m-4 rounded-xl border border-emerald-100">{success}</div>}

            <form onSubmit={handleManualBookingSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 font-sans">اسم المريض الثلاثي</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: صالح عبدالله اليدومي"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">رقم الهاتف (بلواحق مفتاح الدولة)</label>
                <input
                  type="text"
                  required
                  placeholder="96777123456"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">تاريخ الزيارة والكشف</label>
                <input
                  type="date"
                  required
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-205 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-550 transition-all font-bold"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-700 text-white text-xs font-black rounded-xl hover:bg-blue-800 transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'جاري تثبيت الحجز وتوليد رقم الدور...' : 'تثبيت الحجز وحجز المقعد الطبي 💾'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Ticket / Print modal */}
      {activeTicket && (
        <div id="print-ticket-backdrop" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <span className="text-xs font-black text-slate-800">تذكرة المراجعة المكتملة</span>
              <button
                onClick={() => setActiveTicket(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Printable Area block */}
            <div id="printable-ticket" className="p-6 text-center space-y-4 bg-white">
              <div className="flex justify-center mb-1">
                <img
                  src={HOSPITAL_LOGO}
                  alt="Logo"
                  className="h-14 w-14 object-contain rounded-full bg-slate-50 p-1 border border-slate-200"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-850">مستشفى برج الأطباء</h4>
                <p className="text-[9px] text-slate-405">عدن، اليمن - تذكرة مراجعة آلية</p>
              </div>

              <div className="border-t border-b border-dashed border-slate-200 py-3 space-y-2">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">رقم الدور</span>
                <span className="text-4xl font-extrabold text-blue-700 font-mono tracking-tight block">
                  {activeTicket.queue_number}
                </span>
                {(() => {
                  const sch = schedules.find(s => s.id === activeTicket.schedule_id);
                  const shiftName = sch?.start_time === '15:00' ? 'مسائية (Evening)' : 'صباحية (Morning)';
                  return (
                    <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black bg-blue-50 text-blue-700 rounded-md border border-blue-100">
                      {ARABIC_DAYS[sch?.day_of_week ?? 0]} (الفترة: {shiftName})
                    </span>
                  );
                })()}
              </div>

              <div className="text-right space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">اسم المريض:</span>
                  <span className="font-extrabold text-slate-800">{activeTicket.patient_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">الهاتف:</span>
                  <span className="font-bold text-slate-700 font-mono">+{activeTicket.patient_phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">الطبيب المعالج:</span>
                  <span className="font-bold text-slate-800">{activeTicket.doctor_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">تاريخ المعاينة الكشوف:</span>
                  <span className="font-bold text-slate-700 font-mono">{activeTicket.booking_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">حالة الرسوم:</span>
                  <span className={`font-black uppercase tracking-tight text-[10px] ${activeTicket.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {activeTicket.payment_status === 'paid' ? 'مدفوعة ومسددة' : 'بانتظار السداد'}
                  </span>
                </div>
              </div>

              <div className="pt-2 text-[8px] text-slate-400 border-t border-slate-100">
                يرجى الحضور قبل الموعد بـ 15 دقيقة وإبراز هذا الكرت لموظف الاستقبال لتوثيق التسجيل الطبي.
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-grow py-2 bg-blue-700 text-white text-xs font-black rounded-lg hover:bg-blue-800 transition-colors shadow flex items-center justify-center gap-1 cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                طباعة التذكرة
              </button>
              <button
                onClick={() => setActiveTicket(null)}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Patient Booking Confirmation Popup Modal */}
      {deleteBookingId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-sm w-full p-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="h-12 w-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-slate-800 mb-2">تأكيد حذف الحجز</h3>
            <p className="text-xs text-slate-500 mb-6 font-bold leading-relaxed">
              هل أنت متأكد من رغبتك في حذف هذا الحجز نهائياً من سجلات العيادة؟
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={async () => {
                  if (deleteBookingId) {
                    try {
                      await onDeleteBooking(deleteBookingId);
                    } catch (err: any) {
                      alert(err.message || 'فشل حذف الحجز.');
                    } finally {
                      setDeleteBookingId(null);
                    }
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 transition-all cursor-pointer flex-1"
              >
                نعم (Yes)
              </button>
              <button
                onClick={() => setDeleteBookingId(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-black rounded-xl hover:bg-slate-200 transition-all cursor-pointer flex-1"
              >
                لا (No)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
