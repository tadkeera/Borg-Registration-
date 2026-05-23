/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { HOSPITAL_LOGO } from '../utils/constants';
import { Shield, User, Loader2 } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (role: 'admin' | 'receptionist', token: string, name: string | null) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [role, setRole] = useState<'admin' | 'receptionist'>('admin');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Prepare body
    const body: Record<string, any> = {
      username: role === 'admin' ? '123' : 'receptionist',
      password: role === 'admin' ? password : 'receptionist',
    };
    if (role === 'receptionist') {
      body.receptionistName = name.trim();
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشلت عملية تسجيل الدخول.');
      }

      onLoginSuccess(data.role, data.token, data.receptionistName);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ في الشبكة، يرجى المحاولة لاحقاً.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-container" className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans" dir="rtl">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img
            id="login-logo"
            src={HOSPITAL_LOGO}
            alt="شعار مستشفى برج الأطباء"
            className="h-28 w-28 object-contain drop-shadow-md rounded-full bg-white p-2 border border-slate-100"
            referrerPolicy="no-referrer"
          />
        </div>
        <h2 id="login-title" className="mt-6 text-center text-2xl font-black text-slate-800 tracking-tight">
          نظام إدارة التسجيل والعيادات
        </h2>
        <p id="login-sub" className="mt-2 text-center text-sm text-slate-500">
          مستشفى برج الأطباء التخصصي
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div id="login-card" className="bg-white py-8 px-4 shadow-xl border border-slate-100 sm:rounded-2xl sm:px-10">
          {/* Role Chooser Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
            <button
              id="set-admin-btn"
              type="button"
              onClick={() => { setRole('admin'); setError(''); }}
              className={`flex-1 flex items-center justify-center py-2.5 text-sm font-bold rounded-lg transition-all ${
                role === 'admin'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Shield className="h-4 w-4 ml-1.5" />
              مدير النظام
            </button>
            <button
              id="set-rec-btn"
              type="button"
              onClick={() => { setRole('receptionist'); setError(''); }}
              className={`flex-1 flex items-center justify-center py-2.5 text-sm font-bold rounded-lg transition-all ${
                role === 'receptionist'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <User className="h-4 w-4 ml-1.5" />
              موظف الاستقبال
            </button>
          </div>

          <form id="login-form" className="space-y-5" onSubmit={handleLogin}>
            {error && (
              <div id="login-error-alert" className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-100">
                {error}
              </div>
            )}

            {role === 'admin' ? (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  رقم المرور للمدير (الافتراضي: 123)
                </label>
                <input
                  id="admin-passwd-input"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="أدخل كلمة المرور"
                  disabled={loading}
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    اسم موظف الاستقبال الثنائي
                  </label>
                  <input
                    id="rec-name-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="مثال: صالح الأحمد"
                    disabled={loading}
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    * حقل إلزامي لتوثيق التسجيل وحفظ التقارير.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">
                    كلمة مرور موظف الاستقبال (تلقائية ومفتوحة)
                  </label>
                  <input
                    id="rec-passwd-placeholder"
                    type="text"
                    disabled
                    value="دخول مباشر كعرض فقط"
                    className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 text-slate-400 text-xs rounded-xl cursor-not-allowed"
                  />
                </div>
              </div>
            )}

            <button
              id="submit-login-btn"
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-black text-white bg-blue-700 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 ml-2" />
                  جاري تسجيل الدخول...
                </>
              ) : (
                'ولوج لوحة الإدارة 🔓'
              )}
            </button>
          </form>

          <div id="login-footer" className="mt-6 pt-6 border-t border-slate-100">
            <span className="block text-center text-[10px] text-slate-400">
              جميع حقوق النظام محفوظة لمستشفى برج الأطباء © 2026
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
