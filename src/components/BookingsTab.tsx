/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Booking, Doctor, Schedule, BookingStatus, PaymentStatus } from '../types';
import { Search, Filter, Printer, CalendarClock, UserCheck, ShieldAlert, CircleAlert, PlusSquare, Trash2, X, CheckSquare, Coins, CalendarDays, Key, Hospital } from 'lucide-react';
import { HOSPITAL_LOGO } from '../utils/constants';

function getYemenTime(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 3)); // Yemen is UTC + 3
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');

  // Manual booking states
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedSchId, setSelectedSchId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [bookingDate, setBookingDate] = useState('');

  // Ticket Modal States
  const [activeTicket, setActiveTicket] = useState<Booking | null>(null);

  // Loaders
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Sorter / Filtered Bookings
  const filteredBookings = bookings.filter(b => {
    const matchesSearch = b.patient_name.toLowerCase().includes(search.toLowerCase()) || 
                          b.patient_phone.includes(search);
    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    const matchesPayment = paymentFilter === 'all' || b.payment_status === paymentFilter;
    return matchesSearch && matchesStatus && matchesPayment;
  });

  const handleManualBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (!selectedDocId || !selectedSchId || !patientName.trim() || !patientPhone.trim() || !bookingDate) {
        throw new Error('يرجى ملء جميع الحقول المطلوبة.');
      }

      await onAddBooking({
        doctor_id: selectedDocId,
        schedule_id: selectedSchId,
        patient_name: patientName.trim(),
        patient_phone: patientPhone.trim(),
        booking_date: bookingDate
      });

      setSuccess('🎉 تم تسجيل الحجز اليدوي وحساب رقم الدور بنجاح!');
      // Reset
      setPatientName('');
      setPatientPhone('');
      setSelectedDocId('');
      setSelectedSchId('');
      setBookingDate('');
      
      // Close modal after lag
      setTimeout(() => {
        setShowAddModal(false);
        setSuccess('');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'فشلت إضافة الحجز اليدوي.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: BookingStatus) => {
    if (!isAdmin) return;
    try {
      await onEditBooking(id, { status });
    } catch (err: any) {
      alert(err.message || 'فشل تحديث الحالة.');
    }
  };

  const handleUpdatePayment = async (id: string, payment_status: PaymentStatus) => {
    if (!isAdmin) return;
    try {
      await onEditBooking(id, { payment_status, status: payment_status === 'paid' ? 'confirmed' : undefined });
    } catch (err: any) {
      alert(err.message || 'فشل تحديث حالة الدفع.');
    }
  };

  const handleDeleteBooking = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('هل أنت متأكد من حذف هذا الحجز نهائياً من قاعدة البيانات وإخلاء سعة المقعد؟')) return;
    try {
      await onDeleteBooking(id);
    } catch (err: any) {
      alert(err.message || 'فشل حذف الحجز.');
    }
  };

  // Safe helper to obtain available schedules for the chosen doctor in modal
  const filteredSchedules = schedules.filter(s => s.doctor_id === selectedDocId);

  // Print ticket content using browser printing or structured modal
  const triggerPrint = () => {
    window.print();
  };

  return (
    <div id="bookings-tab-container" className="space-y-6" dir="rtl">
      {/* Upper Restriction Notice */}
      {!isAdmin && (
        <div id="book-restriction-alert" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between text-amber-800 text-xs font-bold shadow-sm">
          <div className="flex items-center">
            <ShieldAlert className="h-4.5 w-4.5 ml-2 text-amber-600 shrink-0" />
            <span>تسجيل المخدم: بصفتك موظف الاستقبال *({receptionistName})*، تم تثبيت وضع المشاهدة (للعرض فقط 👁️). لا تملك صلاحيات إضافة أو تعديل أو إلغاء حجوزات المرضى.</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-100 rounded-full border border-amber-300">للعرض فقط</span>
        </div>
      )}

      {/* SEARCH & FILTERS BAR */}
      <div id="bookings-filter-bar" className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full md:w-auto">
          {/* Text Input */}
          <div className="relative flex-1">
            <Search className="absolute right-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              id="bookings-search-input"
              type="text"
              placeholder="البحث باسم المريض أو رقم الهاتف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 text-xs rounded-xl text-slate-700 font-bold focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Booking State Filter */}
          <select
            id="status-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 text-xs text-slate-600 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
          >
            <option value="all">كل حالات الحجز</option>
            <option value="pending">انتظار المراجعة (Pending)</option>
            <option value="confirmed">مؤكد (Confirmed)</option>
            <option value="cancelled">ملغي (Cancelled)</option>
          </select>

          {/* Payment State Filter */}
          <select
            id="payment-filter-select"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 text-xs text-slate-600 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
          >
            <option value="all">كل حالات الدفع</option>
            <option value="pending">معلق وغير مسدد</option>
            <option value="paid">مسدد وخالص الرسوم</option>
            <option value="cancelled">ملغي مسترجع</option>
          </select>
        </div>

        {/* Action button (Admin only) */}
        {isAdmin ? (
          <button
            id="open-manual-booking-modal"
            type="button"
            onClick={() => setShowAddModal(true)}
            className="w-full md:w-auto shrink-0 flex items-center justify-center px-4 py-2 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-850 hover:shadow-md transition-all"
          >
            <PlusSquare className="h-4.5 w-4.5 ml-1.5" />
            تسجيل حجز يدوي (Walk-in) ➕
          </button>
        ) : (
          <div className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-150 rounded-xl px-3 py-2 text-center w-full md:w-auto">
            📥 التسجيل اليدوي معطل للموظفين
          </div>
        )}
      </div>

      {/* BOOKINGS TABLE PANEL */}
      <div id="bookings-table-panel" className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800 font-sans">جدول طلبات حجوزات العيادات ({filteredBookings.length})</h3>
          <span className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 font-bold px-3 py-1 rounded">
            يوم العمل الحالي: {new Date(getYemenTime()).toLocaleDateString('ar-YE')}
          </span>
        </div>

        <div className="overflow-x-auto">
          {filteredBookings.length === 0 ? (
            <div id="no-filtered-bookings" className="p-12 text-center text-slate-400 text-xs">
              لا توجد أي حجوزات تطابق معايير وتصفية البحث المحددة.
            </div>
          ) : (
            <table id="bookings-table" className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-4 py-3 text-right text-xs font-black text-slate-500">الدور 🎫</th>
                  <th className="px-4 py-3 text-right text-xs font-black text-slate-500">اسم المريض</th>
                  <th className="px-4 py-3 text-right text-xs font-black text-slate-500">رقم الهاتف</th>
                  <th className="px-4 py-3 text-right text-xs font-black text-slate-500">العيادة المطلوبة</th>
                  <th className="px-4 py-3 text-right text-xs font-black text-slate-500">موعد الحجز والزيارة</th>
                  <th className="px-4 py-3 text-center text-xs font-black text-slate-500">قيمة تذكرة الدفتر</th>
                  <th className="px-4 py-3 text-center text-xs font-black text-slate-500">حالة الحجز</th>
                  <th className="px-1 py-1 text-center text-xs font-black text-slate-500">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredBookings.map((b) => {
                  const createdTime = new Date(b.created_at || b.booking_date).getTime();
                  const hoursDiff = (getYemenTime().getTime() - createdTime) / (1000 * 60 * 60);
                  const isExpiredPending = b.payment_status === 'pending' && b.status !== 'cancelled' && hoursDiff > 48;

                  return (
                    <tr key={b.id} id={`booking-row-${b.id}`} className="hover:bg-slate-50/50 transition-colors">
                      {/* Queue code */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-blue-50 text-blue-700 font-black text-xs font-mono border border-blue-100">
                          {b.queue_number}
                        </span>
                      </td>

                      {/* Patient Name */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs font-black text-slate-800">{b.patient_name}</div>
                        <div className="flex items-center text-[9px] text-slate-400 mt-0.5">
                          {b.verified_by_whatsapp ? (
                            <span className="text-emerald-600 font-black">🤖 حجز بالبوت</span>
                          ) : (
                            <span className="text-blue-600 font-black">🏢 تسجيل يدوي</span>
                          )}
                        </div>
                      </td>

                      {/* Patient Phone */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[11px] font-bold text-slate-600 font-mono">
                          +{b.patient_phone}
                        </span>
                      </td>

                      {/* Clinic */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs font-black text-slate-800">{b.doctor_name}</div>
                        <div className="text-[9px] text-slate-405 leading-none">{b.doctor_specialty}</div>
                      </td>

                      {/* Visit date */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs font-bold text-slate-700 font-mono">{b.booking_date}</div>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          تاريخ المعالجة: {new Date(b.created_at || '').toLocaleDateString('ar-YE')}
                        </div>
                      </td>

                      {/* Payment Status Dropdown / Badge */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {isAdmin ? (
                          <select
                            id={`pay-select-${b.id}`}
                            value={b.payment_status}
                            onChange={(e) => handleUpdatePayment(b.id, e.target.value as PaymentStatus)}
                            className={`px-2 py-0.5 text-[10px] font-black rounded-md border focus:outline-none focus:ring-1.5 focus:ring-blue-500 cursor-pointer ${
                              b.payment_status === 'paid'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : b.payment_status === 'cancelled'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            <option value="pending">⏳ معلق (Pending)</option>
                            <option value="paid">✅ مسدد (Paid)</option>
                            <option value="cancelled">❌ ملغي (Cancelled)</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-black rounded ${
                            b.payment_status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {b.payment_status === 'paid' ? 'مسدد وخالص الرسوم' : 'معلق لم يسدد'}
                          </span>
                        )}
                        {isExpiredPending && (
                          <span className="block text-[8px] font-bold text-red-500 mt-1 flex items-center justify-center animate-bounce">
                            <CircleAlert className="h-2.5 w-2.5 ml-0.5" />
                            تجاوز 48 ساعة! (انتهى)
                          </span>
                        )}
                      </td>

                      {/* Booking Status Dropdown / Badge */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {isAdmin ? (
                          <select
                            id={`status-select-${b.id}`}
                            value={b.status}
                            onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                            className={`px-2 py-0.5 text-[10px] font-black rounded-md border focus:outline-none focus:ring-1.5 focus:ring-blue-500 cursor-pointer ${
                              b.status === 'confirmed'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : b.status === 'cancelled'
                                ? 'bg-slate-100 text-slate-500 border-slate-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            <option value="pending">⏳ انتظار (Pending)</option>
                            <option value="confirmed">👥 مؤكد (Confirmed)</option>
                            <option value="cancelled">🚫 ملغي (Cancelled)</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-black rounded ${
                            b.status === 'confirmed'
                              ? 'bg-blue-50 text-blue-700 border border-blue-105'
                              : b.status === 'cancelled'
                              ? 'bg-slate-100 text-slate-400 border border-slate-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-105'
                          }`}>
                            {b.status === 'confirmed' ? 'حجز دور مؤكد' : b.status === 'cancelled' ? 'ملغي' : 'مراجعة معلقة'}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-1 py-3 whitespace-nowrap text-center text-xs">
                        <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                          <button
                            id={`print-booking-btn-${b.id}`}
                            onClick={() => setActiveTicket(b)}
                            className="p-1 px-1.5 text-[10px] text-blue-600 bg-white hover:bg-blue-50 rounded-md border border-blue-100 transition-all flex items-center"
                            title="عرض وطباعة كرت المراجعة"
                          >
                            <Printer className="h-3 w-3 ml-1" />
                            تذكرة دور
                          </button>
                          {isAdmin && (
                            <button
                              id={`delete-booking-btn-${b.id}`}
                              onClick={() => handleDeleteBooking(b.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded border border-red-105 transition-all"
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

      {/* TICKET DRAWER / REVEAL MODAL */}
      {activeTicket && (
        <div id="ticket-modal" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-100 animate-slide-up">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-100 p-4 flex items-center justify-between">
              <span className="text-xs font-black text-slate-800 flex items-center">
                <Printer className="h-4 w-4 ml-1.5 text-blue-700" />
                تذكرة المراجعة الرسمية
              </span>
              <button
                id="close-ticket"
                onClick={() => setActiveTicket(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Print Body */}
            <div id="printable-area" className="p-6 text-center space-y-4">
              {/* Logo & header */}
              <div className="flex flex-col items-center space-y-2">
                <img
                  src={HOSPITAL_LOGO}
                  alt="لوجو برج الأطباء"
                  className="h-16 w-16 object-contain"
                  referrerPolicy="no-referrer"
                />
                <h4 className="text-sm font-black text-slate-800">مستشفى برج الأطباء التخصصي</h4>
                <p className="text-[10px] text-slate-400">صنعاء - اليمن | هاتف: 01-444444</p>
              </div>

              {/* Dotted separator */}
              <div className="border-t border-dashed border-slate-200 my-4" />

              {/* Big Queue Number */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 inline-block">
                <span className="block text-[10px] text-slate-400 font-bold mb-1">رقم الدور الخاص بك</span>
                <span className="text-3xl font-black text-blue-700 font-mono tracking-wider">
                  🎫 {activeTicket.queue_number}
                </span>
              </div>

              {/* Medical Information */}
              <div className="text-right space-y-2 text-xs text-slate-700 font-bold bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">المريض:</span>
                  <span className="text-slate-800">{activeTicket.patient_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">العيادة / الطبيب:</span>
                  <span className="text-slate-205">{activeTicket.doctor_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">تاريخ الزيارة:</span>
                  <span className="text-slate-800 font-mono">{activeTicket.booking_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">حالة السداد:</span>
                  <span className={activeTicket.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>
                    {activeTicket.payment_status === 'paid' ? 'مسدد وخالص الرسوم ✅' : 'قيد الانتظار (معلق) ⏳'}
                  </span>
                </div>
              </div>

              {/* Instructions */}
              <div className="text-[10px] text-slate-400 text-center leading-relaxed">
                * الرجاء التواجد في العيادة قبل الموعد بنصف ساعة لطرح تذكرة الكشف.
                <br />
                * صلاحية الحجز معلقة لـ 48 ساعة فقط حتى إبراز السند للصندوق.
              </div>

              {/* Scan effect */}
              <div className="text-[9px] text-slate-300 font-mono">
                Code ID: {activeTicket.id}
              </div>
            </div>

            {/* Print trigger footer */}
            <div className="p-4 bg-slate-55 border-t border-slate-100 flex gap-2">
              <button
                id="print-ticket-trigger"
                onClick={triggerPrint}
                className="flex-1 flex justify-center items-center py-2.5 bg-blue-700 text-white text-xs font-black rounded-xl hover:bg-blue-800"
              >
                <Printer className="h-4 w-4 ml-1.5" />
                طباعة التذكرة 🖨️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WALK-IN MANUAL BOOKING REGISTRATION MODAL */}
      {showAddModal && (
        <div id="add-booking-modal" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100 animate-slide-up">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-sm font-black text-slate-800 flex items-center">
                <CalendarClock className="h-5 w-5 ml-1.5 text-blue-700" />
                تسجيل حجز يدوي مباشر (Walk-in Entry)
              </span>
              <button
                id="close-add-modal"
                onClick={() => { setShowAddModal(false); setError(''); }}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form id="manual-booking-form" onSubmit={handleManualBookingSubmit} className="p-6 space-y-4">
              {error && <p id="manual-booking-error" className="p-2.5 text-xs bg-red-50 text-red-600 rounded-xl">{error}</p>}
              {success && <p id="manual-booking-success" className="p-2.5 text-xs bg-emerald-50 text-emerald-700 rounded-xl">{success}</p>}

              {/* Patient Name */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">اسم المريض الثلاثي</label>
                <input
                  id="manual-patient-name"
                  type="text"
                  required
                  placeholder="مثال: صالح عبدالله اليدومي"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              {/* Patient Phone */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">رقم الهاتف (بلواحق مفتاح الدولة)</label>
                <input
                  id="manual-patient-phone"
                  type="text"
                  required
                  placeholder="96777123456"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-205 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              {/* Doctor */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">العيادة / الطبيب المختص</label>
                <select
                  id="manual-doctor-select"
                  required
                  value={selectedDocId}
                  onChange={(e) => { setSelectedDocId(e.target.value); setSelectedSchId(''); }}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold font-sans"
                >
                  <option value="">-- حدد الطبيب من القائمة --</option>
                  {doctors.filter(d => d.is_active).map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              {/* Schedule Select */}
              {selectedDocId && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">شواغر جدول الدوام المتاح</label>
                  <select
                    id="manual-schedule-select"
                    required
                    value={selectedSchId}
                    onChange={(e) => setSelectedSchId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                  >
                    <option value="">-- اختر موعد اليوم من العيادة --</option>
                    {filteredSchedules.map(sch => (
                      <option key={sch.id} value={sch.id}>
                        {ARABIC_DAYS[sch.day_of_week]} ({sch.start_time} - {sch.end_time}) [السعة المتبقية: {sch.available_capacity}/{sch.max_capacity}]
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Target visit date */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">تاريخ الزيارة والكشف المحدد</label>
                <input
                  id="manual-booking-date"
                  type="date"
                  required
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-205 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
              </div>

              {/* Submit panel */}
              <button
                id="submit-manual-booking"
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-700 text-white text-xs font-black rounded-xl hover:bg-blue-800 transition-all disabled:opacity-50"
              >
                {loading ? 'جاري تسجيل الحجز وتوليد رقم الدور...' : 'تثبيت الحجز الطبي وحجز المقعد 💾'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
