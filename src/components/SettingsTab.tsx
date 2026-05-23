/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WhatsAppSettings, SystemSettings } from '../types';
import { Settings, Shield, Key, Eye, CheckCircle, RefreshCcw, Send, CalendarDays, Loader2, Sparkles, AlertCircle, FileText } from 'lucide-react';

interface SettingsTabProps {
  role: 'admin' | 'receptionist';
  onReloadAllData: () => void;
}

export default function SettingsTab({ role, onReloadAllData }: SettingsTabProps) {
  const isAdmin = role === 'admin';
  const [waSettings, setWaSettings] = useState<WhatsAppSettings | null>(null);
  
  // Form fields
  const [verifyToken, setVerifyToken] = useState('doctors_tower_verify_token_123');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [phoneId, setPhoneId] = useState('');
  const [waActive, setWaActive] = useState(true);

  // Password fields
  const [newPassword, setNewPassword] = useState('');

  // Status/Messages
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Cron outputs
  const [cronLoading, setCronLoading] = useState<string | null>(null);
  const [cronResult, setCronResult] = useState({ type: '', text: '' });

  // Load WhatsApp settings
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/whatsapp-settings');
      const data = await res.json();
      setWaSettings(data);
      setVerifyToken(data.webhook_verify_token);
      setAccessToken(data.access_token || '');
      setAppSecret(data.app_secret || '');
      setPhoneId(data.phone_number_id || '');
      setWaActive(data.is_active);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveWaSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/whatsapp-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_verify_token: verifyToken,
          access_token: accessToken,
          app_secret: appSecret,
          phone_number_id: phoneId,
          is_active: waActive
        })
      });

      if (!res.ok) throw new Error('فشل حفظ إعدادات الواتساب.');
      setSuccess('تم تحديث إعدادات ربط الواتساب بنجاح! 🤖');
      fetchSettings();
    } catch (err: any) {
      setError(err.message || 'فشلت معالجة الطلب.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newPassword.trim()) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_password: newPassword.trim() })
      });

      if (!res.ok) throw new Error('فشل تعديل كلمة المرور.');
      setSuccess('تم تغيير كلمة مرور مدير النظام بنجاح! 🔑');
      setNewPassword('');
    } catch (err: any) {
      setError(err.message || 'فشل تغيير كلمة المرور.');
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
        
        {/* RIGHT: Webhook credentials and Password Changer */}
        <div className="space-y-6">
          {/* WhatsApp Settings Card */}
          <div id="settings-wa-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-800 flex items-center border-b border-slate-100 pb-3">
              <Send className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
              أعدادات ربط بوابة الواتساب الرسمية (WhatsApp Cloud API)
            </h3>

            {isAdmin && error && <p id="settings-error-alert" className="p-2 text-xs bg-red-50 text-red-600 rounded-xl">{error}</p>}
            {isAdmin && success && <p id="settings-success-alert" className="p-2 text-xs bg-emerald-50 text-emerald-700 rounded-xl">{success}</p>}

            {isAdmin ? (
              <form id="wa-settings-form" onSubmit={handleSaveWaSettings} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-505 mb-1">رمز التحقق للويب هوك (Verify Token)</label>
                    <input
                      id="settings-verify-token"
                      type="text"
                      required
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-850 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-505 mb-1">معرف هاتف الواتساب (Phone ID)</label>
                    <input
                      id="settings-phone-id"
                      type="text"
                      placeholder="e.g. 1048493029202"
                      value={phoneId}
                      onChange={(e) => setPhoneId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-850 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">مفتاح السر للتطبيق (Meta App Secret)</label>
                  <input
                    id="settings-app-secret"
                    type="password"
                    placeholder="مفتاح سر التطبيق لتأكيد توقيع الويبهوك SHA256"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-205 text-slate-850 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-mono"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    * سيتحقق الخادم من توقيع الويب هوك X-Hub-Signature-256 للمتطلبات الأمنية في حال تمت إضافة مفتاح السر.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">رمز الوصول الدائم (Permanent Token)</label>
                  <textarea
                    id="settings-access-token"
                    rows={2}
                    placeholder="EAAGXf3hS..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-850 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-mono"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    id="settings-wa-active-check"
                    type="checkbox"
                    checked={waActive}
                    onChange={(e) => setWaActive(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-350 rounded transition-all"
                  />
                  <label htmlFor="settings-wa-active-check" className="mr-2 text-xs font-bold text-slate-600 cursor-pointer">
                    تفعيل استجابة البوت التلقائية على هذا الخادم
                  </label>
                </div>

                <button
                  id="save-wa-settings-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 bg-blue-700 text-white font-black text-xs rounded-xl shadow hover:bg-blue-850 transition-all disabled:opacity-50"
                >
                  حفظ إعدادات الربط المتقدم ⚙️
                </button>
              </form>
            ) : (
              <div id="wa-settings-disabled" className="p-8 text-center text-slate-400 flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-2xl bg-slate-50 space-y-2">
                <FileText className="h-8 w-8 text-slate-300" />
                <span className="text-xs font-bold">معلومات الربط محمية بموجب الصلاحيات</span>
                <span className="text-[10px] text-slate-400">كموظف استقبال يحق لك رؤية حالة الربط فقط دون الإطلاع على كلمات المرور المعتمدة.</span>
              </div>
            )}
          </div>

          {/* Change Password Card (Admin Only) */}
          {isAdmin && (
            <div id="settings-pwd-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
              <h3 className="text-sm font-black text-slate-800 flex items-center border-b border-slate-100 pb-3">
                <Key className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
                تعديل كلمة مرور الإدارة لمدير النظام
              </h3>

              <form id="settings-pwd-form" onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">كلمة المرور الجديدة</label>
                  <input
                    id="settings-new-pwd-input"
                    type="password"
                    required
                    placeholder="اكتب كلمة مرور الإدارة الجديدة"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:bg-white focus:outline-none focus:ring-1.5 focus:ring-blue-500 transition-all font-mono"
                  />
                </div>

                <button
                  id="change-pwd-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2.5 px-4 bg-slate-800 text-white font-black text-xs rounded-xl shadow hover:bg-slate-900 transition-all disabled:opacity-50"
                >
                  تأكيد وحفظ الرقم السري الجديد 🔐
                </button>
              </form>
            </div>
          )}
        </div>

        {/* LEFT: CRON / STAGE JOBS TRIGER */}
        <div className="space-y-6">
          <div id="settings-cron-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-800 flex items-center border-b border-slate-100 pb-3">
              <RefreshCcw className="h-4.5 w-4.5 text-blue-600 ml-1.5 animate-spin-slow" />
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
                  className="w-full flex items-center justify-center py-2 bg-slate-100 hover:bg-slate-205 border border-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-all disabled:opacity-50"
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
                      يقوم بإرجاع سعة مواعيد الأطباء إلى السعات القصوى ومسح كافة جلسات ومراحل الحجز على الواتساب لمنع تداخل الاستجابات بحلول عطلة عيادات الجمعة.
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
                  className="w-full flex items-center justify-center py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold text-xs rounded-lg transition-all disabled:opacity-50"
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
