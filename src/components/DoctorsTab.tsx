/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Doctor } from '../types';
import { UserPlus, Edit2, Trash2, CheckCircle, XCircle, ShieldAlert, FileText, Sparkles } from 'lucide-react';

interface DoctorsTabProps {
  doctors: Doctor[];
  role: 'admin' | 'receptionist';
  onAddDoctor: (doc: { name: string; specialty: string; is_active: boolean; allow_second_week_booking: boolean; limit_two_patients_per_number: boolean }) => Promise<void>;
  onEditDoctor: (id: string, doc: { name: string; specialty: string; is_active: boolean; allow_second_week_booking: boolean; limit_two_patients_per_number: boolean }) => Promise<void>;
  onDeleteDoctor: (id: string) => Promise<void>;
}

export default function DoctorsTab({ doctors, role, onAddDoctor, onEditDoctor, onDeleteDoctor }: DoctorsTabProps) {
  const isAdmin = role === 'admin';
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [allowSecondWeek, setAllowSecondWeek] = useState(false);
  const [limitTwoPatients, setLimitTwoPatients] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // States for loaders
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const resetForm = () => {
    setName('');
    setSpecialty('');
    setIsActive(true);
    setAllowSecondWeek(false);
    setLimitTwoPatients(false);
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (editingId) {
        await onEditDoctor(editingId, { 
          name, 
          specialty, 
          is_active: isActive, 
          allow_second_week_booking: allowSecondWeek, 
          limit_two_patients_per_number: limitTwoPatients 
        });
        setSuccess('تم تعديل بيانات الإخصائي بنجاح! ✨');
      } else {
        await onAddDoctor({ 
          name, 
          specialty, 
          is_active: isActive, 
          allow_second_week_booking: allowSecondWeek, 
          limit_two_patients_per_number: limitTwoPatients 
        });
        setSuccess('تم إضافة الطبيب الجديد للعيادات بنجاح! 🩺');
      }
      resetForm();
    } catch (err: any) {
      setError(err.message || 'فشلت هذه العملية.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (doc: Doctor) => {
    setEditingId(doc.id);
    setName(doc.name);
    setSpecialty(doc.specialty);
    setIsActive(doc.is_active);
    setAllowSecondWeek(!!doc.allow_second_week_booking);
    setLimitTwoPatients(!!doc.limit_two_patients_per_number);
    setError('');
    setSuccess('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('تحذير: سيعمل حذف هذا الطبيب على إلغاء جداول مواعيده وحجوزات مرضاه المرتبطة فوراً. هل أنت متأكد من المتابعة والحذف؟')) return;
    
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await onDeleteDoctor(id);
      setSuccess('تم حذف الطبيب وجميع جداوله المترتبة بنجاح.');
    } catch (err: any) {
      setError(err.message || 'فشل حذف الطبيب.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="doctors-tab-container" className="space-y-6" dir="rtl">
      {/* Upper Status/Warning Bar */}
      {!isAdmin && (
        <div id="rec-restriction-alert" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between text-amber-800 text-xs font-bold shadow-sm">
          <div className="flex items-center">
            <ShieldAlert className="h-4.5 w-4.5 ml-2 shrink-0 animate-pulse" />
            <span>وصلت بصفتك موظف استقبال: وضع المشاهدة الفعالة مفعّل (للعرض فقط 👁️). لا تملك صلاحيات التعديل على الكادر الطبي.</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-150 rounded-full border border-amber-300">للعرض فقط</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RIGHT COLUMN: Add/Edit Doctor Form (Admin only) */}
        <div className="lg:col-span-1">
          <div id="doctor-form-panel" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center">
                <Sparkles className="h-4 w-4 text-blue-600 ml-1.5" />
                {editingId ? 'تعديل بيانات طبيب' : 'إضافة طبيب جديد'}
              </h3>
              {editingId && (
                <button
                  id="cancel-edit-btn"
                  onClick={resetForm}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"
                >
                  إلغاء التعديل
                </button>
              )}
            </div>

            {error && <p id="doc-error" className="p-2 text-[11px] bg-red-50 text-red-600 rounded-lg">{error}</p>}
            {success && <p id="doc-success" className="p-2 text-[11px] bg-emerald-50 text-emerald-700 rounded-lg">{success}</p>}

            {isAdmin ? (
              <form id="doc-submit-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">اسم الطبيب رتبة واستقلالاً</label>
                  <input
                    id="doc-name-form-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
                    placeholder="مثال: د. عصام علوان الحيمي"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">أخصائي في عيادة (التخصص)</label>
                  <input
                    id="doc-spec-form-input"
                    type="text"
                    required
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
                    placeholder="مثال: عيون وجراحة شبكية"
                  />
                </div>

                <div className="space-y-3 pt-1">
                  <div className="flex items-start">
                    <input
                      id="doc-active-checkbox"
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded transition-all"
                    />
                    <label htmlFor="doc-active-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer">
                      ترخيص الطبيب كنشط (متاح لحجز العيادات بالواتساب)
                    </label>
                  </div>

                  <div className="flex items-start">
                    <input
                      id="doc-second-week-checkbox"
                      type="checkbox"
                      checked={allowSecondWeek}
                      onChange={(e) => setAllowSecondWeek(e.target.checked)}
                      className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded transition-all"
                    />
                    <label htmlFor="doc-second-week-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer">
                      السماح بالحجز للأسبوع الثاني (السماح للحجز للأسبوع الثاني عبر البوت)
                    </label>
                  </div>

                  <div className="flex items-start">
                    <input
                      id="doc-limit-patients-checkbox"
                      type="checkbox"
                      checked={limitTwoPatients}
                      onChange={(e) => setLimitTwoPatients(e.target.checked)}
                      className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded transition-all"
                    />
                    <label htmlFor="doc-limit-patients-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer">
                      منع رقم الهاتف من تسجيل أكثر من مريضين لهذا الطبيب
                    </label>
                  </div>
                </div>

                <button
                  id="doc-submit-action-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-800 transition-all disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4 ml-1.5" />
                  {editingId ? 'تأكيد وحفظ التغييرات 💾' : 'تسجيل الطبيب بالعيادات 🆕'}
                </button>
              </form>
            ) : (
              <div id="doc-form-disabled-msg" className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
                <FileText className="h-8 w-8 text-slate-350" />
                <span className="text-xs font-bold">نموذج التسجيل معطل (للعرض فقط)</span>
                <span className="text-[10px] text-slate-400">كموظف استقبال، لا تملك الرخص الكافية لإضافة أو معالجة طاقم أطباء العيادات.</span>
              </div>
            )}
          </div>
        </div>

        {/* LEFT COLUMN: Doctors Datatable */}
        <div className="lg:col-span-2">
          <div id="doctors-list-panel" className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800">أعضاء الكادر الطبي النشط ({doctors.length})</h3>
              <span className="text-[10px] bg-slate-100 px-2 py-0.5 text-slate-500 rounded font-bold">برج الأطباء التخصصي</span>
            </div>

            <div className="overflow-x-auto">
              {doctors.length === 0 ? (
                <div id="no-docs" className="p-8 text-center text-slate-400 text-xs">
                  لا يوجد أطباء مسجلين في النظام حالياً.
                </div>
              ) : (
                <table id="doctors-table" className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/70">
                    <tr>
                      <th className="px-4 py-3 text-right text-xs font-black text-slate-500">اسم الطبيب</th>
                      <th className="px-4 py-3 text-right text-xs font-black text-slate-500">العيادة / التخصص</th>
                      <th className="px-4 py-3 text-right text-xs font-black text-slate-500">حالة الحجز الآلي</th>
                      <th className="px-4 py-3 text-center text-xs font-black text-slate-500">خيارات التحكم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {doctors.map((doc) => (
                      <tr key={doc.id} id={`row-${doc.id}`} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-xs font-black text-slate-800">{doc.name}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {doc.allow_second_week_booking && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                📅 حجز أسبوعين متاح
                              </span>
                            )}
                            {doc.limit_two_patients_per_number && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                                🛑 مريضين كحد أقصى/هاتف
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-md border border-blue-100">
                            {doc.specialty}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {doc.is_active ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100">
                              <CheckCircle className="h-3 w-3 ml-1 fill-emerald-100" />
                              نشط ومتاح للواتساب
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-black bg-red-50 text-red-600 rounded-md border border-red-100">
                              <XCircle className="h-3 w-3 ml-1 fill-red-100" />
                              معطل ومخفي بالبوت
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center text-xs font-medium">
                          {isAdmin ? (
                            <div className="flex items-center justify-center space-x-2 space-x-reverse">
                              <button
                                id={`edit-doc-btn-${doc.id}`}
                                onClick={() => handleEditClick(doc)}
                                className="p-1 px-1.5 text-[10px] text-blue-600 hover:bg-blue-50 rounded border border-blue-100 transition-all flex items-center"
                              >
                                <Edit2 className="h-3 w-3 ml-1" />
                                تعديل
                              </button>
                              <button
                                id={`del-doc-btn-${doc.id}`}
                                onClick={() => handleDeleteClick(doc.id)}
                                className="p-1 px-1.5 text-[10px] text-red-500 hover:bg-red-50 rounded border border-red-100 transition-all flex items-center"
                              >
                                <Trash2 className="h-3 w-3 ml-1" />
                                حذف
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 cursor-not-allowed">
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
        </div>
      </div>
    </div>
  );
}
