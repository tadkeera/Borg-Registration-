/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Doctor } from '../types';
import { UserPlus, Edit2, Trash2, CheckCircle, XCircle, ShieldAlert, FileText, Sparkles, Plus, X } from 'lucide-react';

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
  
  // Modal visibility
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteDoctorId, setDeleteDoctorId] = useState<string | null>(null);
  
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
    setError('');
  };

  const handleOpenAddModal = () => {
    resetForm();
    setIsModalOpen(true);
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
      setIsModalOpen(false); // Hide popup on success
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
    setIsModalOpen(true); // Open the modal prefilled
  };

  const handleDeleteClick = (id: string) => {
    if (!isAdmin) return;
    setDeleteDoctorId(id);
  };

  return (
    <div id="doctors-tab-container" className="space-y-6" dir="rtl">
      {/* Upper Restriction warning for Receptionists */}
      {!isAdmin && (
        <div id="rec-restriction-alert" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between text-amber-800 text-xs font-bold shadow-sm">
          <div className="flex items-center">
            <ShieldAlert className="h-4.5 w-4.5 ml-2 shrink-0 animate-pulse" />
            <span>وصلت بصفتك موظف استقبال: وضع المشاهدة الفعالة مفعّل (للعرض فقط 👁️). لا تملك صلاحيات التعديل على الكادر الطبي.</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-150 rounded-full border border-amber-300">للعرض فقط</span>
        </div>
      )}

      {/* Action and Title bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 border border-slate-100 rounded-2xl shadow-sm">
        <div>
          <h2 className="text-base font-black text-slate-800">أطباء المستشفى والعيادات</h2>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">إدارة الكادر الطبي وتراخيص أطباء مستشفى برج الأطباء وتفاصيل حجزهم بالواتساب.</p>
        </div>

        {isAdmin && (
          <button
            id="open-add-doctor-modal-btn"
            onClick={handleOpenAddModal}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-black text-xs rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            إضافة طبيب جديد
          </button>
        )}
      </div>

      {error && <p id="doc-error-global" className="p-3 text-xs bg-red-50 text-red-600 rounded-xl border border-red-100">{error}</p>}
      {success && <p id="doc-success-global" className="p-3 text-xs bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">{success}</p>}

      {/* FULL WIDTH TABLE LIST */}
      <div id="doctors-list-panel" className="bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md hover:border-slate-200/80 transition-all duration-300 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
          <h3 className="text-xs font-black text-slate-800">أعضاء الكادر الطبي النشط ({doctors.length})</h3>
          <span className="text-[10px] bg-slate-100 px-2 py-0.5 text-slate-500 rounded font-bold">برج الأطباء</span>
        </div>

        <div className="overflow-x-auto">
          {doctors.length === 0 ? (
            <div id="no-docs" className="p-12 text-center text-slate-400 text-xs font-bold">
              لا يوجد أطباء مسجلين في النظام حالياً. يرجى البدء بإضافة طبيب جديد.
            </div>
          ) : (
            <table id="doctors-table" className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-5 py-3.5 text-right text-xs font-black text-slate-500">اسم الطبيب رتبة واستقلالاً</th>
                  <th className="px-5 py-3.5 text-right text-xs font-black text-slate-500">العيادة / التخصص</th>
                  <th className="px-5 py-3.5 text-right text-xs font-black text-slate-500">ترخيص وحالة الواتساب</th>
                  <th className="px-5 py-3.5 text-center text-xs font-black text-slate-500">الخيارات والتحكم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {doctors.map((doc) => (
                  <tr key={doc.id} id={`row-${doc.id}`} className="hover:bg-slate-50/70 transition-all duration-150">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-black text-slate-800">{doc.name}</div>
                        {isAdmin && (
                          <button
                            id={`del-btn-inline-${doc.id}`}
                            onClick={() => handleDeleteClick(doc.id)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded border border-red-100 transition-all duration-200"
                            title="حذف الطبيب"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {doc.allow_second_week_booking && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                            📅 حجز أسبوعين متاح
                          </span>
                        )}
                        {doc.limit_two_patients_per_number && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                            🛑 مريضين كحد أقصى/هاتف
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="inline-flex px-2.5 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-md border border-blue-100">
                        {doc.specialty}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {doc.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100">
                          <CheckCircle className="h-3 w-3 ml-1 fill-emerald-100" />
                          نشط ومتاح للواتساب
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 text-[10px] font-black bg-red-50 text-red-605 rounded-md border border-red-100">
                          <XCircle className="h-3 w-3 ml-1 fill-red-100" />
                          معطل ومخفي بالبوت
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-center text-xs font-medium">
                      {isAdmin ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            id={`edit-doc-btn-${doc.id}`}
                            onClick={() => handleEditClick(doc)}
                            className="p-1.5 px-2.5 text-[10px] text-blue-600 hover:bg-blue-50 rounded-xl border border-blue-100 transition-all flex items-center font-bold"
                          >
                            <Edit2 className="h-3 w-3 ml-1" />
                            تحرير
                          </button>
                          <button
                            id={`del-doc-btn-${doc.id}`}
                            onClick={() => handleDeleteClick(doc.id)}
                            className="p-1.5 px-2.5 text-[10px] text-red-500 hover:bg-red-50 rounded-xl border border-red-100 transition-all flex items-center font-bold"
                          >
                            <Trash2 className="h-3 w-3 ml-1" />
                            حذف
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded border border-slate-200 cursor-not-allowed">
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

      {/* POPUP MODAL: Add / Edit Doctor Form */}
      {isModalOpen && (
        <div id="doctor-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-sm font-black text-slate-800 flex items-center">
                <Sparkles className="h-4.5 w-4.5 text-blue-600 ml-2" />
                {editingId ? 'تعديل بيانات الطبيب' : 'إضافة طبيب جديد'}
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
                <label className="block text-xs font-bold text-slate-500 mb-1.5">اسم الطبيب رتبة واستقلالاً</label>
                <input
                  id="doc-name-form-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
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
                  className="w-full px-4 py-3 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all"
                  placeholder="مثال: عيون وجراحة شبكية"
                />
              </div>

              <div className="space-y-3.5 pt-1.5 border-t border-slate-100">
                <div className="flex items-start">
                  <input
                    id="doc-active-checkbox"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4.5 w-4.5 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded-md transition-all cursor-pointer"
                  />
                  <label htmlFor="doc-active-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                    ترخيص الطبيب كنشط (متاح لحجز العيادات بالواتساب)
                  </label>
                </div>

                <div className="flex items-start">
                  <input
                    id="doc-second-week-checkbox"
                    type="checkbox"
                    checked={allowSecondWeek}
                    onChange={(e) => setAllowSecondWeek(e.target.checked)}
                    className="h-4.5 w-4.5 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded-md transition-all cursor-pointer"
                  />
                  <label htmlFor="doc-second-week-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                    السماح بالحجز للأسبوع الثاني (السماح للحجز للأسبوع الثاني عبر البوت)
                  </label>
                </div>

                <div className="flex items-start">
                  <input
                    id="doc-limit-patients-checkbox"
                    type="checkbox"
                    checked={limitTwoPatients}
                    onChange={(e) => setLimitTwoPatients(e.target.checked)}
                    className="h-4.5 w-4.5 mt-0.5 text-blue-600 focus:ring-blue-500 border-slate-350 rounded-md transition-all cursor-pointer"
                  />
                  <label htmlFor="doc-limit-patients-checkbox" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                    منع رقم الهاتف من تسجيل أكثر من مريضين لهذا الطبيب
                  </label>
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                <button
                  id="doc-submit-action-btn"
                  type="submit"
                  disabled={loading}
                  className="flex-1 flex justify-center items-center py-3 px-4 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-800 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus className="h-4 w-4 ml-2" />
                  {editingId ? 'تأكيد وحفظ التغييرات 💾' : 'تسجيل الطبيب بالعيادات 🆕'}
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

      {/* Delete Doctor Confirmation Popup Modal */}
      {deleteDoctorId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50" dir="rtl">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-md w-full p-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="h-12 w-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-slate-800 mb-2">تأكيد حذف الطبيب</h3>
            <p className="text-xs text-slate-500 mb-6 font-bold leading-relaxed">
              تحذير: سيعمل حذف هذا الطبيب على إلغاء جداول مواعيده وحجوزات مرضاه المرتبطة فوراً. هل أنت متأكد من المتابعة والحذف؟
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={async () => {
                  if (deleteDoctorId) {
                    setLoading(true);
                    setError('');
                    try {
                      await onDeleteDoctor(deleteDoctorId);
                      setSuccess('تم حذف الطبيب وجميع جداوله المترتبة بنجاح.');
                    } catch (err: any) {
                      setError(err.message || 'فشل حذف الطبيب.');
                    } finally {
                      setLoading(false);
                      setDeleteDoctorId(null);
                    }
                  }
                }}
                className="px-5 py-2.5 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 transition-all cursor-pointer flex-1"
              >
                نعم (Yes)
              </button>
              <button
                onClick={() => setDeleteDoctorId(null)}
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
