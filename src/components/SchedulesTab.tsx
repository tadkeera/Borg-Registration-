/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Schedule, Doctor } from '../types';
import { CalendarRange, Sparkles, Clock, Users, ArrowUpRight, Plus, Eye, Check, ShieldAlert, Trash2, Edit2, X, Search } from 'lucide-react';

interface SchedulesTabProps {
  schedules: Schedule[];
  doctors: Doctor[];
  role: 'admin' | 'receptionist';
  onAddSchedule: (sch: { doctor_id: string; day_of_week: number; max_capacity: number; start_time: string; end_time: string }) => Promise<void>;
  onEditSchedule: (id: string, sch: { max_capacity: number; start_time: string; end_time: string }) => Promise<void>;
  onDeleteSchedule: (id: string) => Promise<void>;
}

const ARABIC_DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

export default function SchedulesTab({ schedules, doctors, role, onAddSchedule, onEditSchedule, onDeleteSchedule }: SchedulesTabProps) {
  const isAdmin = role === 'admin';
  const [doctorId, setDoctorId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(0); // Sat by default
  const [maxCapacity, setMaxCapacity] = useState(15);
  const [shift, setShift] = useState<'morning' | 'evening'>('morning');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search filtering state to support unlimited tables comfortably!
  const [searchQuery, setSearchQuery] = useState('');

  // Modal control
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Quick inline capacity editing states
  const [editingCapacityId, setEditingCapacityId] = useState<string | null>(null);
  const [tempCapacity, setTempCapacity] = useState<number>(0);
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleOpenAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleSaveCapacity = async (id: string, startTimeVal: string, endTimeVal: string) => {
    if (tempCapacity <= 0) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await onEditSchedule(id, { max_capacity: tempCapacity, start_time: startTimeVal, end_time: endTimeVal });
      setEditingCapacityId(null);
      setSuccess('تم تحديث السعة الاستيعابية بنجاح! ⚡');
    } catch (err: any) {
      setError(err.message || 'فشل تحديث السعة الاستيعابية.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setDoctorId('');
    setDayOfWeek(0);
    setMaxCapacity(15);
    setShift('morning');
    setEditingId(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    setLoading(true);
    setError('');
    setSuccess('');

    const targetStartTime = shift === 'evening' ? '15:00' : '09:00';
    const targetEndTime = shift === 'evening' ? '19:00' : '13:00';

    // Validation logic: allow scheduling the same doctor on the same day ONLY if the shifts are different
    const isDuplicate = schedules.some(s => 
      s.doctor_id === doctorId && 
      s.day_of_week === dayOfWeek && 
      s.start_time === targetStartTime &&
      s.id !== editingId
    );

    if (isDuplicate) {
      setError('عذراً، هذا الطبيب لديه عيادة مجدولة بالفعل في نفس هذه الفترة (الصباحية أو المسائية) في هذا اليوم.');
      setLoading(false);
      return;
    }

    try {
      if (editingId) {
        await onEditSchedule(editingId, { max_capacity: maxCapacity, start_time: targetStartTime, end_time: targetEndTime });
        setSuccess('تم تعديل زمن وطاقة العيادة بنجاح! ⏱️');
      } else {
        await onAddSchedule({ doctor_id: doctorId, day_of_week: dayOfWeek, max_capacity: maxCapacity, start_time: targetStartTime, end_time: targetEndTime });
        setSuccess('تم إضافة الموعد الأسبوعي المتكرر للطبيب بنجاح! 🗓️');
      }
      resetForm();
      setIsModalOpen(false); // Close popup
    } catch (err: any) {
      setError(err.message || 'فشلت معالجة الجدول المختار.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (s: Schedule) => {
    setEditingId(s.id);
    setDoctorId(s.doctor_id);
    setDayOfWeek(s.day_of_week);
    setMaxCapacity(s.max_capacity);
    setShift(s.start_time === '15:00' ? 'evening' : 'morning');
    setError('');
    setIsModalOpen(true); // Open pre-loaded form popup
  };

  const handleDeleteClick = (id: string) => {
    if (!isAdmin) return;
    setDeleteScheduleId(id);
  };

  // Filter doctors based on search query
  const filteredDoctors = doctors.filter(doc => 
    doc.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    doc.specialty.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div id="schedules-tab-container" className="space-y-6" dir="rtl">
      {/* Upper Mode Banner */}
      {!isAdmin && (
        <div id="sch-restriction-alert" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between text-amber-800 text-xs font-bold shadow-sm">
          <div className="flex items-center">
            <ShieldAlert className="h-4.5 w-4.5 ml-2 text-amber-600 shrink-0" />
            <span>تسجيل المخدم: وضع المشاهدة الفعالة معشّق (للعرض فقط 👁️). لا تملك صلاحيات وجدولة مواعيد العيادات.</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-100 rounded-full border border-amber-300">للعرض فقط</span>
        </div>
      )}

      {/* Title & Add Action top card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 border border-slate-100 rounded-2xl shadow-sm">
        <div>
          <h2 className="text-base font-black text-slate-800">جداول ومواعيد عيادات الأطباء</h2>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">ضبط وتثبيت جداول العمل الأسبوعية (الصباحية أو المسائية) للكادر الطبي والتحكم في السعة.</p>
        </div>

        {isAdmin && (
          <button
            id="open-add-schedule-modal-btn"
            onClick={handleOpenAddModal}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-black text-xs rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            إضافة موعد جديد
          </button>
        )}
      </div>

      {error && <p id="sch-error-alert-global" className="p-3 text-xs bg-red-50 text-red-650 rounded-xl border border-red-100">{error}</p>}
      {success && <p id="sch-success-alert-global" className="p-3 text-xs bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">{success}</p>}

      {/* FILTER SEARCH BAR FOR SUPPORTING UNLIMITED PHYSICIANS SCHEDULING TABLES */}
      <div className="bg-white p-3.5 border border-slate-100 rounded-2xl shadow-sm flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            className="w-full pr-10 pl-4 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
            placeholder="البحث السريع عن طبيب أو تخصص لتصفية جداول الدوام..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[10px] text-slate-400 hover:text-slate-600 bg-slate-100 px-2 py-1 rounded"
          >
            مسح الفلتر
          </button>
        )}
      </div>

      {/* DOCTOR TABLES GRID (Accommodates unlimited physician schedule tables beautifully in a clean, scrollable layouts) */}
      <div className="space-y-6">
        <div className="bg-slate-100/65 p-3.5 rounded-xl border border-slate-200/55 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-850 font-sans">جداول دوام الأطباء الفعالة ({filteredDoctors.length})</h3>
          <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-105">السبت - الخميس</span>
        </div>

        {filteredDoctors.length === 0 ? (
          <div className="bg-white p-12 text-center text-slate-400 text-xs font-bold rounded-2xl border border-slate-100">
            {doctors.length === 0 ? 'لا يوجد أطباء مسجلين لعرض جداولهم. يرجى إضافة طبيب أولاً.' : 'لا يوجد أطباء يطابقون فلتر البحث المكتوب.'}
          </div>
        ) : (
          filteredDoctors.map((doc) => {
            const docSchedules = schedules.filter(s => s.doctor_id === doc.id);
            return (
              <div key={doc.id} className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-blue-600 animate-pulse" />
                    <h4 className="text-xs font-black text-slate-800">
                      جدول دوام الدكتور: <span className="text-blue-700 font-extrabold">{doc.name}</span> <span className="text-slate-400 font-normal">({doc.specialty})</span>
                    </h4>
                  </div>
                  <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-200">
                    مستشفى برج الأطباء
                  </span>
                </div>

                <div className="overflow-x-auto">
                  {docSchedules.length === 0 ? (
                    <div className="py-7 text-center text-slate-400 text-[10px] border border-dashed border-slate-200 rounded-xl bg-slate-50/50 font-bold">
                      لا يوجد فترات دوام مجدولة للدكتور {doc.name} حالياً. انقر على إضافة موعد جديد بالرأس للإضافة.
                    </div>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-100 text-right">
                      <thead className="bg-slate-50/80">
                        <tr>
                          <th className="px-4 py-2.5 text-right text-xs font-black text-slate-500">يوم العيادة</th>
                          <th className="px-4 py-2.5 text-right text-xs font-black text-slate-500">الفترة (الوردية)</th>
                          <th className="px-4 py-2.5 text-center text-xs font-black text-slate-500">السعة المتاحة</th>
                          <th className="px-4 py-2.5 text-center text-xs font-black text-slate-500">التحكم والعمليات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {docSchedules.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/40 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="inline-flex px-2.5 py-0.5 text-[10px] font-black bg-blue-50 text-blue-700 rounded border border-blue-100">
                                {ARABIC_DAYS[s.day_of_week]}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center text-xs text-slate-705 font-bold">
                                  <Clock className="h-3.5 w-3.5 text-slate-400 ml-1.5 shrink-0" />
                                  {s.start_time === '15:00' ? 'مسائية (Evening)' : 'صباحية (Morning)'}
                                </div>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleDeleteClick(s.id)}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded border border-red-100 transition-all duration-200"
                                    title="حذف هذا الموعد"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                              {editingCapacityId === s.id ? (
                                <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={tempCapacity}
                                    onChange={(e) => setTempCapacity(parseInt(e.target.value) || 0)}
                                    className="w-14 px-1 py-0.5 text-xs text-center bg-slate-50 border border-slate-300 rounded font-mono font-bold"
                                  />
                                  <button
                                    onClick={() => handleSaveCapacity(s.id, s.start_time, s.end_time)}
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded border border-emerald-250"
                                    title="حفظ"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingCapacityId(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-[10px] rounded"
                                    title="إلغاء"
                                  >
                                    تراجع
                                  </button>
                                </div>
                              ) : (
                                <div>
                                  <div className="inline-flex items-center justify-center">
                                    <span className="text-xs font-black text-slate-800 font-mono">{s.available_capacity}</span>
                                    <span className="text-[10px] text-slate-405 font-mono px-0.5">/</span>
                                    <span className="text-[10px] text-slate-500 font-mono font-bold">{s.max_capacity}</span>
                                    {isAdmin && (
                                      <button
                                        onClick={() => {
                                          setEditingCapacityId(s.id);
                                          setTempCapacity(s.max_capacity);
                                        }}
                                        className="mr-2 p-0.5 text-slate-400 hover:text-blue-600 rounded"
                                        title="تعديل السعة سريعاً"
                                      >
                                        <Edit2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                              {s.available_capacity === 0 ? (
                                <span className="block text-[8px] font-bold text-red-500 leading-none mt-1">
                                  مكتمل السعة 🚫
                                </span>
                              ) : (
                                <div className="w-14 bg-slate-150 h-1.5 rounded-full overflow-hidden mx-auto mt-1">
                                  <div
                                    className="bg-blue-600 h-1.5"
                                    style={{ width: `${(s.available_capacity / s.max_capacity) * 100}%` }}
                                  />
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center text-xs">
                              {isAdmin ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => handleEditClick(s)}
                                    className="p-1 px-2.5 text-[10px] text-blue-500 hover:bg-blue-50 rounded-xl border border-blue-100 transition-all font-black flex items-center"
                                  >
                                    <Edit2 className="h-3 w-3 ml-1" />
                                    تحرير
                                  </button>
                                  <button
                                    onClick={() => handleDeleteClick(s.id)}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded border border-red-100 transition-all"
                                    title="حذف الجدول"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="inline-flex items-center text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded px-2 py-0.5">
                                  للعرض فقط 👁️
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* POPUP MODAL: Add / Edit Schedule Form (Second Image layout completely realized) */}
      {isModalOpen && (
        <div id="schedule-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-sm font-black text-slate-800 flex items-center">
                <Clock className="h-4.5 w-4.5 text-blue-600 ml-2" />
                {editingId ? 'تعديل توقيت وسعة الجدول الأسبوعي' : 'جدولة مواعيد أسبوعية'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">اختر الطبيب المعني</label>
                <select
                  id="sch-doctor-select"
                  required
                  disabled={editingId !== null}
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all disabled:opacity-60 font-medium"
                >
                  <option value="">-- حدد الطبيب من القائمة --</option>
                  {doctors.filter(d => d.is_active).map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">يوم العيادة الأسبوعي (الجمعة مغلق)</label>
                <select
                  id="sch-day-select"
                  required
                  disabled={editingId !== null}
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(parseInt(e.target.value))}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all disabled:opacity-60 font-medium"
                >
                  {ARABIC_DAYS.map((day, idx) => (
                    <option key={idx} value={idx}>{day}</option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-450 block mt-1.5 font-bold leading-normal">
                  * جدول متكرر أسبوعياً بشكل تلقائي. يفتح الحجز دورياً كل خميس الساعة 10:00 مساءً.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">الفترة الزمنية (الوردية/الدوام)</label>
                <select
                  id="sch-shift-select"
                  required
                  value={shift}
                  onChange={(e) => setShift(e.target.value as 'morning' | 'evening')}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-medium"
                >
                  <option value="morning">صباحية (Morning)</option>
                  <option value="evening">مسائية (Evening)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">السعة الاستيعابية للمرضى باليوم</label>
                <input
                  id="sch-capacity-input"
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={maxCapacity}
                  onChange={(e) => setMaxCapacity(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-bold"
                />
                <p className="mt-1.5 text-[10px] text-slate-450 font-bold leading-normal">
                  * الحجز بالواتساب سيتوقف للعيادة تلقائياً بمجرد استهلاك السعة.
                </p>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-100 font-sans">
                <button
                  id="sch-submit-action-btn"
                  type="submit"
                  disabled={loading}
                  className="flex-1 flex justify-center items-center py-3 px-4 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-800 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <CalendarRange className="h-4 w-4 ml-2" />
                  {editingId ? 'تأكيد وحفظ التغييرات 💾' : 'تثبيت المواعيد الأسبوعية 📅'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Schedule Confirmation Popup Modal */}
      {deleteScheduleId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50" dir="rtl">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-md w-full p-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="h-12 w-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-slate-800 mb-2">تأكيد حذف الموعد</h3>
            <p className="text-xs text-slate-500 mb-6 font-bold leading-relaxed">
              انتبه: حذف جدول مواعيد الطبيب سيلغي كافة حجوزات المرضى المجدولة في هذا اليوم تلقائياً. هل تؤكد المتابعة والحذف؟
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={async () => {
                  if (deleteScheduleId) {
                    setLoading(true);
                    setError('');
                    try {
                      await onDeleteSchedule(deleteScheduleId);
                      setSuccess('تم حذف وقت العيادة وجدول الطبيب بنجاح.');
                    } catch (err: any) {
                      setError(err.message || 'فشل حذف الجدول.');
                    } finally {
                      setLoading(false);
                      setDeleteScheduleId(null);
                    }
                  }
                }}
                className="px-5 py-2.5 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 transition-all cursor-pointer flex-1"
              >
                نعم (Yes)
              </button>
              <button
                onClick={() => setDeleteScheduleId(null)}
                className="px-5 py-2.5 bg-slate-100 text-slate-700 text-xs font-black rounded-xl hover:bg-slate-200 transition-all cursor-pointer flex-1"
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
