/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User, Shield, UserCheck, Key, Loader2, Trash2, Plus, Users } from 'lucide-react';

interface AccessSettingsTabProps {
  currentUserRole: 'admin' | 'receptionist';
}

interface DBUser {
  id: string;
  username: string;
  role: 'admin' | 'receptionist';
  employee_name?: string;
  created_at?: string;
}

export default function AccessSettingsTab({ currentUserRole }: AccessSettingsTabProps) {
  const [users, setUsers] = useState<DBUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [role, setRole] = useState<'admin' | 'receptionist'>('receptionist');
  
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchUsers = async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim() || !employeeName.trim()) {
      setError('الرجاء تعبئة اسم المستخدم، كلمة المرور، واسم الموظف بالكامل.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          role,
          employee_name: employeeName.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل إضافة المستخدم الجديد.');
      }

      setSuccess('تم تسجيل حساب المستخدم الجديد بنجاح! ✨');
      setUsername('');
      setPassword('');
      setEmployeeName('');
      setRole('receptionist');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ غير متوقع.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من رغبتك في حذف هذا المستخدم نهائياً؟')) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'فشلت عملية حذف الحساب.');
      }

      setSuccess('تم حذف حساب المستخدم بنجاح. 👋');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء محاولة الحذف.');
    }
  };

  if (currentUserRole !== 'admin') {
    return (
      <div id="access-denied-container" className="bg-white rounded-2xl border border-slate-100 p-8 shadow-sm text-center max-w-lg mx-auto my-12 font-sans" dir="rtl">
        <Shield className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-black text-slate-800 leading-tight">غير مصرح بالوصول</h3>
        <p className="text-xs text-slate-500 mt-2 font-bold">
          عذراً، تقتصر صلاحية إدارة الحسابات والربط والتحكم على "مدير النظام" فقط.
        </p>
      </div>
    );
  }

  return (
    <div id="access-settings-container" className="space-y-6 font-sans max-w-5xl mx-auto" dir="rtl">
      
      {/* Intro Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-indigo-100/40 pb-5 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Users className="h-5.5 w-5.5 text-blue-700" />
            إدارة حسابات وصلاحيات الدخول (RBAC)
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-bold">
            أنشئ الحسابات ووزع الصلاحيات بين مدراء النظام وموظفي الاستقبال بكل مرونة.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-100">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl font-medium border border-emerald-100">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Creation Form Card */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
            <Plus className="h-4 w-4 text-emerald-600" />
            إنشاء مستخدم جديد
          </h3>

          <form onSubmit={handleAddUser} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                الاسم الكامل للموظف (Employee Name)
              </label>
              <input
                type="text"
                required
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="أدخل الاسم الرباعي أو الثلاثي للموظف"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                اسم المستخدم (Username)
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="اسم تسجيل الدخول للمستخدم (مثال: ali_receptionist)"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                كلمة المرور (Password)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="أدخل كلمة المرور السرية"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                الدور ودرجة الصلاحية (Role)
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                disabled={loading}
              >
                <option value="receptionist">موظف الاستقبال (مواد سجل المراجعات فقط)</option>
                <option value="admin">مدير النظام (صلاحية تحكم كاملة ومطلقة)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow text-xs font-black text-white bg-blue-700 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 ml-1.5" />
                  جاري الإنشاء...
                </>
              ) : (
                'حقن الحساب الجديد للعيادات 💾'
              )}
            </button>
          </form>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5">
            <span className="block text-[10px] font-bold text-slate-600">💡 دليل الصلاحيات السريع:</span>
            <ul className="list-disc list-inside text-[9px] text-slate-500 space-y-1 pr-1">
              <li><strong>مدير النظام:</strong> يمتلك وصولاً كاملاً لتعديل العيادات الكبرى، دوام الأطباء، وإعدادات الربط وحسابات الدخول.</li>
              <li><strong>موظف الاستقبال:</strong> صلاحية وصول حصرية ومباشرة تقتصر على "سجل المراجعات والحجوزات" فقط دون العبث بمرافق التوثيق.</li>
            </ul>
          </div>
        </div>

        {/* Existing Users List */}
        <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
            <Users className="h-4 w-4 text-blue-700" />
            قائمة المستخدمين الحاليين
          </h3>

          {listLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-xs font-bold font-sans">جاري سحب بيانات الحسابات...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              لا توجد حسابات مسجلة حالياً.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-black text-slate-405 uppercase tracking-wider bg-slate-50/70">
                    <th className="px-3 py-2 text-right">الموظف / اسم المستخدم</th>
                    <th className="px-3 py-2 text-center">نوع الحساب</th>
                    <th className="px-3 py-2 text-left">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors text-xs">
                      <td className="px-3 py-3 font-bold text-slate-800">
                        <div className="font-sans font-black text-slate-800">{u.employee_name || u.username}</div>
                        <div className="text-[10px] font-mono text-slate-400">@{u.username}</div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'admin'
                            ? 'bg-blue-50 text-blue-700 border border-blue-100'
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {u.role === 'admin' ? 'مدير النظام' : 'موظف استقبال'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-left">
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1 px-2.5 text-red-600 hover:bg-red-50 rounded-lg border border-red-100 transition-colors text-[10px] font-bold flex items-center justify-center gap-1/2 cursor-pointer inline-flex"
                          title="حذف المستخدم"
                        >
                          <Trash2 className="h-3 w-3" />
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
