/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { BotSession, WhatsAppLog, BotState } from '../types';
import { Phone, MessageSquarePlus, Sparkles, Send, Trash2, Shield, Eye, Clock, Key, Award, AlertTriangle, ShieldCheck } from 'lucide-react';

interface SimulatorTabProps {
  onSendMessageCallback: () => void;
}

interface ChatBubble {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

export default function SimulatorTab({ onSendMessageCallback }: SimulatorTabProps) {
  const [phoneNumber, setPhoneNumber] = useState('96777111222');
  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatBubble[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [sysLogs, setSysLogs] = useState<WhatsAppLog[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  // Load chat logs and active session
  const loadLogsAndState = async () => {
    try {
      // 1. WhatsApp global logs
      const logRes = await fetch('/api/whatsapp-logs');
      const logData = await logRes.json();
      setSysLogs(logData);

      // Find last messages for our specific phone in logs to rebuild bubble UI if wanted,
      // or we can just let bubbles represent the active playground session.
    } catch (err) {
      console.error('Error loading simulator data:', err);
    }
  };

  useEffect(() => {
    loadLogsAndState();
    
    // Seed default bubbles on first render
    setChatHistory([
      {
        id: '1',
        sender: 'bot',
        text: 'مرحباً بك في مُحاكي واتساب مستشفى برج الأطباء! 🏥\nيمكنك البدء في الحجز عن طريق إرسال كلمة "تسجيل" أو الرقم "1".',
        timestamp: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  }, [phoneNumber]);

  // Scroll mock mobile to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleSendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    setLoading(true);
    // Add user bubble
    const userBubble: ChatBubble = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    };
    setChatHistory(prev => [...prev, userBubble]);
    setInputText('');

    try {
      const res = await fetch('/api/simulator/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber, message: text })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Add bot reply bubble
      const botBubble: ChatBubble = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: data.receivedReply,
        timestamp: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
      };

      setChatHistory(prev => [...prev, botBubble]);
      setActiveSession(data.sessionDetails);
      
      // Reload server logs and parent counters
      loadLogsAndState();
      onSendMessageCallback();
    } catch (err) {
      console.error('Sim error:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearBotSession = async () => {
    if (!confirm('سيتم تصفير محادثة وبنية هذا الرقم وبدء جلسة جديدة. هل ترغب بالتصفير؟')) return;
    
    try {
      // We can clear session by simulating weekly reset or sending specific signals,
      // let's simulate weekly reset, but even easier, we can send a message like "إلغاء" which clears the active state!
      await handleSendMessage('إلغاء');
      setChatHistory([
        {
          id: `sys-${Date.now()}`,
          sender: 'bot',
          text: 'تم إعادة تهيئة الجلسة بنجاح لرقم الهاتف هذا. أرسل "تسجيل" للبدء.',
          timestamp: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setActiveSession(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch('/api/whatsapp-logs', { method: 'DELETE' });
      setSysLogs([]);
    } catch (err) {
      console.error(err);
    }
  };

  const getBotStateColor = (state: BotState) => {
    switch (state) {
      case 'IDLE': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'AWAITING_NAME': return 'bg-amber-50 text-amber-700 border-amber-250';
      case 'SELECTING_DOCTOR': return 'bg-blue-50 text-blue-700 border-blue-250';
      case 'SELECTING_DAY': return 'bg-indigo-50 text-indigo-700 border-indigo-250';
      case 'CONFIRMING': return 'bg-violet-50 text-violet-700 border-violet-250';
      case 'COMPLETED': return 'bg-emerald-50 text-emerald-700 border-emerald-250';
      default: return 'bg-slate-100 text-slate-705';
    }
  };

  const getBotStateLabel = (state: BotState) => {
    switch (state) {
      case 'IDLE': return 'انتظار التسجيل (IDLE)';
      case 'AWAITING_NAME': return 'انتظار اسم المريض 👤';
      case 'SELECTING_DOCTOR': return 'انتظار اختيار الطبيب 🩺';
      case 'SELECTING_DAY': return 'انتظار اختيار اليوم والوعد 📅';
      case 'CONFIRMING': return 'تأكيد الحجز النهائي 🎫';
      case 'COMPLETED': return 'مكتمل ومسجل (COMPLETED)';
      default: return state;
    }
  };

  return (
    <div id="simulator-tab-container" className="grid grid-cols-1 lg:grid-cols-12 gap-6" dir="rtl">
      
      {/* RIGHT: Conversational Mobile Emulator */}
      <div className="lg:col-span-6 flex flex-col items-center">
        <div id="mock-phone-frame" className="w-full max-w-sm bg-slate-900 rounded-[3rem] p-4 shadow-2xl border-4 border-slate-800 relative ring-8 ring-slate-950/20">
          
          {/* Notch/Speaker */}
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 h-5 w-32 bg-slate-900 rounded-b-2xl z-20 flex justify-center items-center">
            <div className="h-1 w-10 bg-slate-800 rounded-full mb-1"></div>
          </div>

          <div className="bg-[#E5DDD5] rounded-[2.5rem] overflow-hidden flex flex-col h-[520px] relative font-sans">
            
            {/* Phone Header */}
            <div className="bg-emerald-800 text-white p-4 pt-6 flex items-center justify-between shadow-md">
              <div className="flex items-center space-x-2 space-x-reverse">
                <div className="h-8 w-8 rounded-full bg-emerald-600 flex items-center justify-center font-black text-xs">
                  🏥
                </div>
                <div>
                  <h4 className="text-xs font-black leading-tight">بوت مستشفى برج الأطباء</h4>
                  <span className="text-[9px] text-emerald-150 leading-none">نشط متصل الآن ●</span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-emerald-100 font-mono">
                {phoneNumber}
              </span>
            </div>

            {/* Sub Phone Status strip */}
            <div className="bg-emerald-700/85 px-3 py-1.5 flex justify-between text-[10px] text-emerald-100 font-sans">
              <span>تعديل رقم الهاتف التجريبي:</span>
              <input
                id="sim-phone-changer"
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="bg-emerald-900 border-none rounded px-1.5 py-0 text-white text-[9px] w-24 text-center font-mono focus:outline-none focus:ring-1 focus:ring-emerald-300"
              />
            </div>

            {/* Bubble list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col bg-[#E5DDD5]">
              {chatHistory.map(b => (
                <div
                  key={b.id}
                  className={`flex flex-col max-w-[85%] ${
                    b.sender === 'user' ? 'self-end items-end' : 'self-start items-start'
                  }`}
                >
                  <div
                    className={`p-3 rounded-2xl text-xs font-sans whitespace-pre-line leading-relaxed shadow-sm ${
                      b.sender === 'user'
                        ? 'bg-emerald-105 text-slate-800 rounded-br-none'
                        : 'bg-white text-slate-800 rounded-bl-none border border-slate-200'
                    }`}
                  >
                    {b.text}
                  </div>
                  <span className="text-[9px] text-slate-450 mt-1 font-mono px-1">
                    {b.timestamp}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Fast Trigger Buttons Panel */}
            <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 flex flex-wrap gap-1 items-center">
              <span className="text-[9px] text-slate-400 font-bold ml-1">رد سريع:</span>
              <button
                onClick={() => handleSendMessage('تسجيل')}
                disabled={loading}
                className="px-2 py-0.5 text-[9px] font-black bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100"
              >
                "تسجيل" 🆕
              </button>
              <button
                onClick={() => handleSendMessage('1')}
                disabled={loading}
                className="px-2 py-0.5 text-[9px] font-mono font-black bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200"
              >
                1 (نعم)
              </button>
              <button
                onClick={() => handleSendMessage('2')}
                disabled={loading}
                className="px-2 py-0.5 text-[9px] font-mono font-black bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200"
              >
                2 (تراجع)
              </button>
              <button
                onClick={() => handleSendMessage('أحمد علي سعيد')}
                disabled={loading}
                className="px-2 py-0.5 text-[9px] font-black bg-amber-50 text-amber-700 rounded border border-amber-200 hover:bg-amber-100"
              >
                "أحمد علي سعيد"
              </button>
              <button
                onClick={() => handleSendMessage('صورة غير صالحة')}
                disabled={loading}
                className="px-2 py-0.5 text-[9px] font-black bg-red-50 text-red-700 rounded border border-red-200 hover:bg-red-100"
              >
                [فحص خطأ الفولباك ⚠️]
              </button>
            </div>

            {/* Input field */}
            <form
              id="playground-chat-form"
              onSubmit={(e) => { e.preventDefault(); handleSendMessage(inputText); }}
              className="bg-slate-100 p-2.5 flex items-center gap-2 border-t border-slate-200 shrink-0"
            >
              <button
                type="button"
                onClick={clearBotSession}
                className="p-2 bg-slate-200 hover:bg-slate-300 text-slate-500 rounded-full transition-all shrink-0"
                title="تصفير الجلسة الجارية"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <input
                id="playground-chat-input"
                type="text"
                placeholder="اكتب ردك ومتابعة الحجز..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-1.5 focus:ring-emerald-600 font-bold"
              />

              <button
                id="send-playground-chat"
                type="submit"
                disabled={loading || !inputText.trim()}
                className="p-2 bg-emerald-800 text-white rounded-full hover:bg-emerald-950 transition-all disabled:opacity-50 shrink-0"
              >
                <Send className="h-4 w-4 transform rotate-180" />
              </button>
            </form>

          </div>
        </div>
      </div>

      {/* LEFT: Live Session State Inspection & Logs Audit */}
      <div className="lg:col-span-6 space-y-6">
        
        {/* State Inspector */}
        <div id="inspector-card" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-800 flex items-center">
              <Award className="h-4.5 w-4.5 text-blue-700 ml-1.5" />
              فاحص الجلسة وقاعدة البيانات النشط (Bot Session Inspector)
            </h3>
            <span className="text-[9px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-205 font-mono">
              REALTIME
            </span>
          </div>

          {activeSession ? (
            <div id="ins-details" className="space-y-3.5 text-xs text-slate-705 font-bold">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">مرحلة البوت الحالية:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${getBotStateColor(activeSession.current_state)}`}>
                  {getBotStateLabel(activeSession.current_state)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                <span className="text-slate-400 font-medium">اسم المريض المستخلص:</span>
                <span className="text-slate-800">{activeSession.patient_name || '👤 قيد الانتظار'}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                <span className="text-slate-400 font-medium">مرحلة اختيار الطبيب (ID):</span>
                <span className="text-slate-650 font-mono text-[10px]">{activeSession.selected_doctor_id || '❌ لم يحدد'}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                <span className="text-slate-400 font-medium">مرحلة اختيار جدول الموعد (ID):</span>
                <span className="text-slate-650 font-mono text-[10px]">{activeSession.selected_schedule_id || '❌ لم يحدد'}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                <span className="text-slate-400 font-medium">آخر نشاط أو استجابة باليمن:</span>
                <span className="text-slate-850 font-mono text-[10px]">{new Date(activeSession.last_interaction_at).toLocaleTimeString('ar-YE')}</span>
              </div>
            </div>
          ) : (
            <div id="ins-empty" className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex items-center justify-center text-center text-slate-450 text-xs">
              لم تقم بأي محادثة بعد أو الجلسة مغلقة لعامة الأرقام. أرسل "تسجيل" عن طريق كرت الهاتف اليميني لبدء التحليل!
            </div>
          )}
        </div>

        {/* Global Webhook Logs */}
        <div id="sys-logs-panel" className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-800 flex items-center">
              <Clock className="h-4.5 w-4.5 text-blue-600 ml-1.5" />
              سجلات الـ Webhook الواردة والصادرة (System Audit Trail)
            </h3>
            {sysLogs.length > 0 && (
              <button
                id="clear-logs-btn"
                onClick={handleClearLogs}
                className="text-[10px] font-bold text-red-500 hover:text-red-700 flex items-center"
              >
                تفريغ السجل
              </button>
            )}
          </div>

          <div className="max-h-[220px] overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/70">
            {sysLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-[11px]">
                لا توجد سجلات ويبهوك نشطة لتاريخ اليوم.
              </div>
            ) : (
              sysLogs.map(log => (
                <div key={log.id} className="p-2 rounded bg-white border border-slate-100 text-[10px] font-bold text-slate-700 font-mono flex items-start gap-2">
                  <span className={`px-1.5 py-0.5 rounded shrink-0 leading-none text-[8px] font-black ${
                    log.direction === 'in' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {log.direction === 'in' ? 'RECEIVE 📥' : 'SEND 📤'}
                  </span>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-center text-slate-400 text-[9px]">
                      <span>+{log.phone}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString('ar-YE')}</span>
                    </div>
                    <p className="text-xs text-slate-800 font-sans leading-relaxed whitespace-pre-line">{log.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
