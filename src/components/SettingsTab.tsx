/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WhatsAppSettings } from '../types';
import { 
  Settings, Shield, Key, Eye, CheckCircle, RefreshCcw, Send, 
  CalendarDays, Loader2, Sparkles, AlertCircle, FileText, 
  Plus, Trash2, Save, Edit3, ArrowRight
} from 'lucide-react';

interface SettingsTabProps {
  role: 'admin' | 'receptionist';
  onReloadAllData: () => void;
}

interface WaCard {
  id?: string;
  webhook_verify_token: string;
  access_token: string;
  app_secret: string;
  phone_number_id: string;
  is_active: boolean;
  isEditing: boolean;
}

export default function SettingsTab({ role, onReloadAllData }: SettingsTabProps) {
  const isAdmin = role === 'admin';
  const [showWaApiSettings, setShowWaApiSettings] = useState(false);
  const [cards, setCards] = useState<WaCard[]>([]);

  // Status/Messages
  const [loading, setLoading] = useState(false);

  // Cron outputs
  const [cronLoading, setCronLoading] = useState<string | null>(null);
  const [cronResult, setCronResult] = useState({ type: '', text: '' });

  // Load WhatsApp settings
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/whatsapp-settings');
      const data = await res.json();
      if (Array.isArray(data)) {
        setCards(data.map((item: any) => ({
          ...item,
          isEditing: false
        })));
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleAddNewCard = () => {
    setCards([
      ...cards,
      {
        webhook_verify_token: 'doctors_tower_verify_token_' + Math.floor(100 + Math.random() * 900),
        access_token: '',
        app_secret: '',
        phone_number_id: '',
        is_active: true,
        isEditing: true
      }
    ]);
  };

  const handleToggleEdit = (index: number) => {
    const updated = [...cards];
    updated[index].isEditing = !updated[index].isEditing;
    setCards(updated);
  };

  const handleCardInputChange = (index: number, field: keyof WaCard, value: any) => {
    const updated = [...cards];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setCards(updated);
  };

  const handleSaveCard = async (index: number) => {
    if (!isAdmin) return;
    const card = cards[index];

    if (!card.phone_number_id.trim()) {
      alert('الرجاء إدخال معرف هاتف الواتساب (Phone ID)');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: card.id,
          webhook_verify_token: card.webhook_verify_token,
          access_token: card.access_token,
          app_secret: card.app_secret,
          phone_number_id: card.phone_number_id,
          is_active: card.is_active
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'فشل حفظ إعدادات الرقم.');
      }

      const savedData = await res.json();
      
      const updated = [...cards];
      updated[index] = {
        ...savedData,
        isEditing: false
      };
      setCards(updated);
      alert('تم حفظ إعدادات الربط بنجاح! ✨');
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء الحفظ.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCard = async (index: number) => {
    const card = cards[index];
    if (!card.id) {
      setCards(cards.filter((_, i) => i !== index));
      return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا الرقم وإيقاف البوت المرتبط به نهائياً؟')) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp-settings/${card.id}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('فشل إرسال طلب الحذف.');
      
      setCards(cards.filter((_, i) => i !== index));
      alert('تم حذف إعدادات رقم الواتساب بنجاح. 👋');
    } catch (err: any) {
      alert(err.message || 'فشل حذف إعدادات الرقم.');
    } finally {
      setLoading(false);
    }
  };

  // Run Cron: Unpaid Clean-up
  const handleTriggerCleanupCron = async () => {
    setCronLoading('cleanup');
    setCronResult({ type: '', text: '' });
    try {
      const res = await fetch('/api/cron/cleanup-bookings', { method: 'POST' });
      const data = await res.json();
      setCronResult({
        type: 'success',
        text: data.message || 'تم تنظيف الحجوزات غير المسددة بنجاح.'
      });
      onReloadAllData();
    } catch (err: any) {
      setCronResult({
        type: 'danger',
        text: 'فشل تشغيل كرون جوب التنظيف في الخادم.'
      });
    } finally {
      setCronLoading(null);
    }
  };

  // Run Cron: Weekly Reset
  const handleTriggerWeeklyResetCron = async () => {
    if (!confirm('تنبيه: سيعمل تصفير الدورة الأسبوعية على تصفير وترميم كافة شواغر الأطباء، وحذف الجلسات الجارية. هل تؤكد التشغيل؟')) return;
    
    setCronLoading('weekly');
    setCronResult({ type: '', text: '' });
    try {
      const res = await fetch('/api/cron/reset-weekly', { method: 'POST' });
      const data = await res.json();
      setCronResult({
        type: 'success',
        text: data.message || 'تم إعادة تهيئة الدورة الأسبوعية بنجاح.'
      });
      onReloadAllData();
    } catch (err: any) {
      setCronResult({
        type: 'danger',
        text: 'فشل إعادة الجدولة الأسبوعية.'
      });
    } finally {
      setCronLoading(null);
    }
  };

  if (showWaApiSettings) {
    return (
      <div id="whatsapp-multi-settings-view" className="space-y-6 animate-fade-in font-sans max-w-5xl mx-auto" dir="rtl">
        {/* Back control */}
        <div className="flex items-center justify-between border-b border-indigo-100/40 pb-5">
          <div>
            <button 
              onClick={() => setShowWaApiSettings(false)}
              className="flex items-center gap-1.5 text-xs font-black text-slate-600 hover:text-slate-850 transition-colors bg-slate-150 hover:bg-slate-200 px-3 py-2 rounded-xl cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              العودة إلى الإعدادات العامة
            </button>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mt-4">
              <Send className="h-5.5 w-5.5 text-blue-700" />
              إعدادات واتساب Cloud API (إعدادات واتساب api)
            </h2>
            <p className="text-xs text-slate-505 mt-1 font-bold">
              قم بتهيئة وإدارة عدة أرقام واتساب بوت للعمل بالتوازي على الويب هوك.
            </p>
          </div>

          {isAdmin && (
            <button
              id="add-number-btn"
              onClick={handleAddNewCard}
              className="flex items-center gap-1.5 px-4.5 py-3 bg-blue-700 hover:bg-blue-800 font-black text-xs text-white rounded-xl shadow transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              إضافة رقم جديد (اضافه رقم)
            </button>
          )}
        </div>

        {cards.length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-12 rounded-2xl text-center text-slate-400 space-y-4">
            <Send className="h-10 w-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-black text-slate-700">لا توجد أرقام ربط مسجلة بعد</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              اضغط على زر "إضافة رقم جديد" بالأعلى لتهيئة وحفظ أول رقم واتساب يربط الويب هوك بالنظام.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {cards.map((card, index) => (
              <div 
                key={index} 
                className={`bg-white p-5 border rounded-2xl shadow-sm space-y-4 transition-all ${
                  card.isEditing ? 'border-blue-400 ring-2 ring-blue-50' : 'border-slate-100'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${card.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                    <h4 className="text-xs font-black text-slate-800">
                      {card.phone_number_id ? `مُعرف هاتف البوت: ${card.phone_number_id}` : 'إعداد رقم بوت جديد (مسودة لم تُحفظ)'}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      card.isEditing ? (
                        <button
                          type="button"
                          onClick={() => handleSaveCard(index)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 font-extrabold text-[10px] text-white rounded-lg transition-colors cursor-pointer"
                        >
                          <Save className="h-3 w-3" />
                          حفظ إعدادات الربط (حفظ اعدادات الربط)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleEdit(index)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-655 font-extrabold text-[10px] text-white rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit3 className="h-3 w-3" />
                          تحرير (تحرير)
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(index)}
                      className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1.5 font-extrabold text-[10px] rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                      معرف هاتف الواتساب (Phone ID) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!card.isEditing || !isAdmin}
                      value={card.phone_number_id}
                      onChange={(e) => handleCardInputChange(index, 'phone_number_id', e.target.value)}
                      placeholder="e.g. 1048493029202"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                      رمز التحقق للويب هوك (Verify Token)
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!card.isEditing || !isAdmin}
                      value={card.webhook_verify_token}
                      onChange={(e) => handleCardInputChange(index, 'webhook_verify_token', e.target.value)}
                      placeholder="رمز التحقق للويب هوك"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    مفتاح السر للتطبيق (Meta App Secret)
                  </label>
                  <input
                    type="password"
                    disabled={!card.isEditing || !isAdmin}
                    value={card.app_secret}
                    onChange={(e) => handleCardInputChange(index, 'app_secret', e.target.value)}
                    placeholder="مفتاح السر للتطبيق"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                    رمز الوصول الدائم (Permanent Token)
                  </label>
                  <textarea
                    rows={2}
                    disabled={!card.isEditing || !isAdmin}
                    value={card.access_token}
                    onChange={(e) => handleCardInputChange(index, 'access_token', e.target.value)}
                    placeholder="اكتب رمز الوصول الدائم الطويل جداً هنا"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    id={`wa-active-check-${index}`}
                    type="checkbox"
                    disabled={!card.isEditing || !isAdmin}
                    checked={card.is_active}
                    onChange={(e) => handleCardInputChange(index, 'is_active', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-350 rounded transition-all cursor-pointer"
                  />
                  <label htmlFor={`wa-active-check-${index}`} className="mr-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                    تفعيل استجابة البوت للأرقام وبدء التوجيه
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="settings-tab-container" className="space-y-6 animate-fade-in" dir="rtl">
      {/* Upper Mode Warning */}
      {!isAdmin && (
        <div id="settings-restricted-alert" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between text-amber-800 text-xs font-bold shadow-sm">
          <div className="flex items-center">
            <AlertCircle className="h-4.5 w-4.5 ml-2 text-amber-600 shrink-0" />
            <span>عرض موظفي الاستقبال: صفحة إعدادات النظام وتفعيل الواتساب مغلقة (للعرض فقط 👁️). لا تملك صلاحيات إدارة وتعديل معايير الربط أو إجراء المهام التلقائية (العامة).</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-100 rounded-full border border-amber-300">للعرض فقط</span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* RIGHT: Webhook credentials toggler */}
        <div className="space-y-6">
          {/* WhatsApp Settings Launcher Card */}
          <div id="settings-wa-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-800 flex items-center border-b border-slate-100 pb-3">
              <Send className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
              ربط واستجابة بوابة الواتساب الرسمية (WhatsApp Cloud API)
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed font-bold">
              يدعم النظام الآن تهيئة عدة أرقام هواتف لتنسيق الحجوزات للعيادات بالتزامن. يمكنك إعداد verify token، مفاتيح meta، والوصول للبوتات من مركز التطبيقات ومزامنتها.
            </p>
            <button
              id="wa-settings-toggle-btn"
              onClick={() => setShowWaApiSettings(true)}
              className="w-full flex justify-center items-center py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow cursor-pointer transition-all"
            >
              اعدادات واتساب api 🤖
            </button>
          </div>
        </div>

        {/* LEFT: CRON / STAGE JOBS TRIGER */}
        <div className="space-y-6">
          <div id="settings-cron-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-800 flex items-center border-b border-slate-100 pb-3">
              <RefreshCcw className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
              أتمتة التشغيل والمهام المجدولة (Cron Jobs Simulator)
            </h3>
            <p className="text-xs text-slate-450 leading-relaxed font-sans">
              يحتوي النظام على جدولين زمنيين آليين للحفاظ على دقة المواعيد وسعة العمل بالعيادات. يمكنك تفعيل وتشغيل الـ Cron Jobs يدوياً من هنا لتجربة ومطابقة السلوك البرمجي:
            </p>

            {/* Cron Outputs Section */}
            {cronResult.text && (
              <div
                id="cron-result-alert"
                className={`p-3.5 rounded-xl text-xs font-bold border transition-all ${
                  cronResult.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-150'
                    : 'bg-red-50 text-red-700 border-red-150'
                }`}
              >
                {cronResult.text}
              </div>
            )}

            <div className="space-y-4">
              {/* Cron 1: Unpaid Cleanup */}
              <div className="border border-slate-100 p-4 rounded-xl hover:bg-slate-50/40 transition-all space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="block text-xs font-black text-slate-705">
                      1. تصفية الحجوزات غير مدفوعة الصيانة (48 ساعة)
                    </span>
                    <span className="text-[10px] text-slate-400 leading-relaxed block mt-1">
                      ينظف الطلبات بانتظار السداد لمدة تزيد عن 48 ساعة ويجعل الحجز ملغياً (Cancelled) مع إعادة ترميم المقاعد المتاحة في الجدول تلقائياً.
                    </span>
                    <span className="inline-flex mt-1.5 px-2 py-0.5 bg-slate-100 text-[9px] font-bold text-slate-500 rounded border border-slate-200">
                      تنفيذ تلقائي: يومي (00:00 منتصف الليل)
                    </span>
                  </div>
                </div>

                <button
                  id="trigger-cleanup-cron-btn"
                  onClick={handleTriggerCleanupCron}
                  disabled={cronLoading !== null || !isAdmin}
                  className="w-full flex items-center justify-center py-2 bg-slate-100 hover:bg-slate-205 border border-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {cronLoading === 'cleanup' ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4 ml-1.5" />
                      جاري فحص وتصفية الحجوزات القديمة...
                    </>
                  ) : (
                    'تشغيل Cron Job تنظيف الحجوزات الآن 🧹'
                  )}
                </button>
              </div>

              {/* Cron 2: Weekly Capacity Reset */}
              <div className="border border-slate-100 p-4 rounded-xl hover:bg-slate-50/40 transition-all space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="block text-xs font-black text-slate-700">
                      2. إعادة جدولة وتصفير السعة الأسبوعية (الخميس 10:00 مساءً)
                    </span>
                    <span className="text-[10px] text-slate-400 leading-relaxed block mt-1">
                      يقوم بإرجاع سعة مواعيد الأطباء إلى السعات القصوى ومسح كافة جلسات ومراحل الحجز على الواتساب لمنع تداخل الاستجابات بحلول ععلة عيادات الجمعة.
                    </span>
                    <span className="inline-flex mt-1.5 px-2 py-0.5 bg-blue-50 text-[9px] font-bold text-blue-700 rounded border border-blue-100">
                      تنفيذ تلقائي: كل خميس (10:00 م بتوقيت اليمن)
                    </span>
                  </div>
                </div>

                <button
                  id="trigger-weekly-cron-btn"
                  onClick={handleTriggerWeeklyResetCron}
                  disabled={cronLoading !== null || !isAdmin}
                  className="w-full flex items-center justify-center py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold text-xs rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {cronLoading === 'weekly' ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4 ml-1.5" />
                      جاري إعادة التهيئة الشاملة للدورة الأسبوعية...
                    </>
                  ) : (
                    'تشغيل Cron Job البداية الأسبوعية الجديدة 🗓️'
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
