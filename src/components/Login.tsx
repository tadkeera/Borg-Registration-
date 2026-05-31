/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Shield, User, Loader2, Key } from 'lucide-react';
import { HOSPITAL_LOGO } from '../utils/constants';

interface LoginProps {
  onLoginSuccess: (role: 'admin' | 'receptionist', token: string, name: string | null) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [role, setRole] = useState<'admin' | 'receptionist'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Prepare body
    const body: Record<string, any> = {
      username: username.trim(),
      password: password.trim(),
    };

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'بيانات الدخول غير صحيحة.');
      }

      // Quick roles validation to match requested toggle state
      if (data.role !== role) {
        throw new Error(`الحساب المدخل خاص بصلاحية "${data.role === 'admin' ? 'مدير النظام' : 'موظف الاستقبال'}"، يرجى تغيير التبويب للتسجيل.`);
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
            className="hospital-logo"
            style={{ width: '140px', height: 'auto', objectFit: 'contain' }}
            referrerPolicy="no-referrer"
          />
        </div>
        <h2 id="login-title" className="mt-6 text-center text-2xl font-black text-slate-800 tracking-tight">
          نظام إدارة التسجيل والعيادات
        </h2>
        <p id="login-sub" className="mt-2 text-center text-sm text-slate-500">
          مستشفى برج الأطباء
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div id="login-card" className="bg-white py-8 px-4 shadow-xl border border-slate-100 sm:rounded-2xl sm:px-10">
          {/* Role Chooser Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
            <button
              id="set-admin-btn"
              type="button"
              onClick={() => { setRole('admin'); setUsername(''); setPassword(''); setError(''); }}
              className={`flex-1 flex items-center justify-center py-2.5 text-sm font-bold rounded-lg transition-all cursor-pointer ${
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
              onClick={() => { setRole('receptionist'); setUsername(''); setPassword(''); setError(''); }}
              className={`flex-1 flex items-center justify-center py-2.5 text-sm font-bold rounded-lg transition-all cursor-pointer ${
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

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                اسم المستخدم (Username)
              </label>
              <input
                id="login-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder={role === 'admin' ? "مثال: admin" : "مثال: receptionist"}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                كلمة المرور (Password)
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="أدخل كلمة المرور الخاصة بك"
                disabled={loading}
              />
            </div>

            <button
              id="submit-login-btn"
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-black text-white bg-blue-700 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 ml-2" />
                  جاري التحقق...
                </>
              ) : (
                'تسجيل الدخول'
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
