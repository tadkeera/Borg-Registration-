/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Schedule, Doctor } from '../types';
import { CalendarRange, Sparkles, Clock, Users, ArrowUpRight, Plus, Eye, Check, ShieldAlert, Trash2, Edit2 } from 'lucide-react';

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

  // Quick inline capacity editing states
  const [editingCapacityId, setEditingCapacityId] = useState<string | null>(null);
  const [tempCapacity, setTempCapacity] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    setLoading(true);
    setError('');
    setSuccess('');

    const targetStartTime = shift === 'evening' ? '15:00' : '09:00';
    const targetEndTime = shift === 'evening' ? '19:00' : '13:00';

    try {
      if (editingId) {
        await onEditSchedule(editingId, { max_capacity: maxCapacity, start_time: targetStartTime, end_time: targetEndTime });
        setSuccess('تم تعديل زمن وطاقة العيادة بنجاح! ⏱️');
      } else {
        await onAddSchedule({ doctor_id: doctorId, day_of_week: dayOfWeek, max_capacity: maxCapacity, start_time: targetStartTime, end_time: targetEndTime });
        setSuccess('تم إضافة الموعد الأسبوعي المتكرر للطبيب بنجاح! 🗓️');
      }
      resetForm();
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
  };

  const handleDeleteClick = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('انتبه: حذف جدول مواعيد الطبيب سيلغي كافة حجوزات المرضى المجدولة في هذا اليوم تلقائياً. هل تؤكد المتابعة والحذف؟')) return;

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await onDeleteSchedule(id);
      setSuccess('تم حذف وقت العيادة وجدول الطبيب بنجاح.');
    } catch (err: any) {
      setError(err.message || 'فشل حذف الجدول.');
    } finally {
      setLoading(false);
    }
  };

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RIGHT PANEL: Form */}
        <div className="lg:col-span-1">
          <div id="sch-form-panel" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center">
                <Clock className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
                {editingId ? 'تعديل توقيت وسعة الجدول' : 'جدولة مواعيد أسبوعية'}
              </h3>
              {editingId && (
                <button
                  id="cancel-sch-edit"
                  onClick={resetForm}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"
                >
                  تراجع
                </button>
              )}
            </div>

            {error && <p id="sch-error-alert" className="p-2 text-[11px] bg-red-50 text-red-600 rounded-lg">{error}</p>}
            {success && <p id="sch-success-alert" className="p-2 text-[11px] bg-emerald-50 text-emerald-700 rounded-lg">{success}</p>}

            {isAdmin ? (
              <form id="sch-submit-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">اختر الطبيب المعني</label>
                  <select
                    id="sch-doctor-select"
                    required
                    disabled={editingId !== null}
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-205 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all disabled:opacity-60"
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
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all disabled:opacity-60"
                  >
                    {ARABIC_DAYS.map((day, idx) => (
                      <option key={idx} value={idx}>{day}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-450 block mt-1">
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
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
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
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
                  />
                  <p className="mt-1 text-[9px] text-slate-400">
                    * الحجز بالواتساب سيتوقف للعيادة تلقائياً بمجرد استهلاك السعة.
                  </p>
                </div>

                <button
                  id="sch-submit-action-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-800 transition-all disabled:opacity-50"
                >
                  <CalendarRange className="h-4 w-4 ml-1.5" />
                  {editingId ? 'حفظ توقيت العيادة ⏰' : 'تثبيت المواعيد الأسبوعية 🗓️'}
                </button>
              </form>
            ) : (
              <div id="sch-form-disabled" className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
                <Users className="h-8 w-8 text-slate-350" />
                <span className="text-xs font-bold">نموذج الجدولة معطل (للعرض فقط)</span>
                <span className="text-[10px] text-slate-400">لست مديراً للنظام لتعديل الفترات الصباحية أو المسائية.</span>
              </div>
            )}
          </div>
        </div>

        {/* LEFT PANEL: Table List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-100/65 p-3.5 rounded-xl border border-slate-200/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 font-sans">جداول الدوام التفصيلية حسب الأطباء ({doctors.length})</h3>
            <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">السبت - الخميس</span>
          </div>

          {doctors.length === 0 ? (
            <div className="bg-white p-8 text-center text-slate-400 text-xs rounded-2xl border border-slate-100">
              لا توجد أطباء مسجلين لعرض جداولهم. يرجى إضافة طبيب في البداية.
            </div>
          ) : (
            doctors.map((doc) => {
              const docSchedules = schedules.filter(s => s.doctor_id === doc.id);
              return (
                <div key={doc.id} className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-blue-600" />
                      <h4 className="text-xs font-black text-slate-800">
                        جدول دوام الدكتور: <span className="text-blue-700 font-black">{doc.name}</span> <span className="text-slate-400 font-normal">({doc.specialty})</span>
                      </h4>
                    </div>
                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">
                      مستشفى برج الأطباء
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    {docSchedules.length === 0 ? (
                      <div className="py-5 text-center text-slate-400 text-[10px] border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        لا توجد فترات دوام مجدولة للدكتور {doc.name} حالياً.
                      </div>
                    ) : (
                      <table className="min-w-full divide-y divide-slate-100 text-right">
                        <thead className="bg-slate-50/80">
                          <tr>
                            <th className="px-3 py-2 text-right text-xs font-black text-slate-500">يوم العيادة</th>
                            <th className="px-3 py-2 text-right text-xs font-black text-slate-500">الفترة (الوردية)</th>
                            <th className="px-3 py-2 text-center text-xs font-black text-slate-500">السعة المتاحة</th>
                            <th className="px-3 py-2 text-center text-xs font-black text-slate-500">التحكم والعمليات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {docSchedules.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-50/40 transition-colors">
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className="inline-flex px-2 py-0.5 text-[10px] font-black bg-blue-50 text-blue-700 rounded border border-blue-100">
                                  {ARABIC_DAYS[s.day_of_week]}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <div className="flex items-center text-xs text-slate-700 font-bold">
                                  <Clock className="h-3.5 w-3.5 text-slate-400 ml-1.5 shrink-0" />
                                  {s.start_time === '15:00' ? 'مسائية (Evening)' : 'صباحية (Morning)'}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-center">
                                {editingCapacityId === s.id ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={tempCapacity}
                                      onChange={(e) => setTempCapacity(parseInt(e.target.value) || 0)}
                                      className="w-12 px-1 py-0.5 text-xs text-center bg-slate-50 border border-slate-300 rounded font-mono"
                                    />
                                    <button
                                      onClick={() => handleSaveCapacity(s.id, s.start_time, s.end_time)}
                                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded border border-emerald-200"
                                      title="حفظ"
                                    >
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => setEditingCapacityId(null)}
                                      className="p-1 text-slate-400 hover:bg-slate-100 text-[10px] rounded animate-fade-in"
                                      title="إلغاء"
                                    >
                                      تراجع
                                    </button>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="inline-flex items-center justify-center">
                                      <span className="text-xs font-black text-slate-800 font-mono">{s.available_capacity}</span>
                                      <span className="text-[10px] text-slate-400 font-mono px-0.5">/</span>
                                      <span className="text-[10px] text-slate-500 font-mono font-bold">{s.max_capacity}</span>
                                      {isAdmin && (
                                        <button
                                          onClick={() => {
                                            setEditingCapacityId(s.id);
                                            setTempCapacity(s.max_capacity);
                                          }}
                                          className="mr-1.5 p-0.5 text-slate-400 hover:text-blue-600 rounded"
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
                                  <div className="w-12 bg-slate-100 h-1 rounded-full overflow-hidden mx-auto mt-1">
                                    <div
                                      className="bg-blue-600 h-1"
                                      style={{ width: `${(s.available_capacity / s.max_capacity) * 100}%` }}
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">
                                {isAdmin ? (
                                  <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                                    <button
                                      onClick={() => handleEditClick(s)}
                                      className="p-1 px-2 text-[10px] text-blue-500 hover:bg-blue-50 rounded border border-blue-100 transition-all font-bold"
                                    >
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
                                  <span className="inline-flex items-center text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
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
      </div>
    </div>
  );
}
