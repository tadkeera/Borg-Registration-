import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// IMPORTANT SECURITY RULE: Never hardcode API keys! 
// Configure process.env.GEMINI_API_KEY and others in your Vercel Environment Variables.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hwydphvoeyjzhkfwnhij.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// --- DATABASE TOOLS ---
const getDoctors = async () => {
  const { data, error } = await supabase.from('doctors').select('id, name, specialty');
  if (error) return { error: error.message };
  return { doctors: data };
};

const checkCapacity = async ({ doctorId, dateStr, shift }: { doctorId: string, dateStr: string, shift: string }) => {
  const { data: schedule, error: schError } = await supabase
    .from('schedules')
    .select('id, max_capacity')
    .eq('doctor_id', doctorId)
    .eq('shift', shift)
    .single();

  if (schError || !schedule) return { error: 'Schedule not found for that doctor and shift.' };

  const { count, error: countError } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('schedule_id', schedule.id)
    .eq('booking_date', dateStr);

  if (countError) return { error: countError.message };

  const currentCount = count || 0;
  return { 
    hasCapacity: currentCount < schedule.max_capacity, 
    remainingSlots: schedule.max_capacity - currentCount 
  };
};

const makeBooking = async ({ name, doctorId, dateStr, shift, phone }: { name: string, doctorId: string, dateStr: string, shift: string, phone: string }) => {
  const { data: schedule } = await supabase
    .from('schedules')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('shift', shift)
    .single();

  if (!schedule) return { error: 'Schedule not found' };

  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('schedule_id', schedule.id)
    .eq('booking_date', dateStr);

  const queueNumber = (count || 0) + 1;

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      patient_name: name,
      patient_phone: phone,
      schedule_id: schedule.id,
      booking_date: dateStr,
      queue_number: queueNumber,
      status: 'confirmed',
      payment_status: 'pending'
    }])
    .select()
    .single();

  if (error) return { error: error.message };
  return { success: true, booking: data, queueNumber };
};

const toolsMap: Record<string, Function> = { getDoctors, checkCapacity, makeBooking };

// --- MAIN WEBHOOK VERB ---
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 3. Payload Parsing
    const messageBody = body.message?.body || body.body;
    const fromPhone = body.message?.from || body.from;
    
    if (!messageBody || !fromPhone) {
      return NextResponse.json({ success: true, message: 'Missing Message Payload' });
    }

    // Ignore group messages 
    if (String(fromPhone).includes('-')) {
      return NextResponse.json({ success: true, message: 'Ignored Group Message' });
    }

    // 4. Session Memory (Fetch existing history)
    const { data: session } = await supabase
      .from('bot_sessions')
      .select('history')
      .eq('phone', fromPhone)
      .single();

    let history: any[] = session?.history || [];

    const systemInstruction = `أنت مساعد ذكي ونشيط لمستشفى برج الأطباء في اليمن. تتحدث باللهجة اليمنية بطلاقة وبشكل طبيعي جداً.
مهمتك مساعدة المرضى في الاستعلام عن الأطباء وحجز المواعيد.
تعليمات سير العمل:
- رحب بالمريض واعرض عليه بكل لطف قائمة الأطباء.
- بدلاً من القوائم الرقمية الجامدة، استوعب متطلبات المريض من نصه (مثلاً إذا قال "أشتي دكتور باطنية" ابحث فوراً عن أطباء الباطنية).
- لحجز الموعد تأكد أولاً من وجود سعة متاحة في التاريخ والفترة المختارة باستخدام أداة checkCapacity.
- اطلب الاسم الرباعي ليتم تسجيله بصورة رسمية.
- عند اجراء الحجز بنجاح (makeBooking)، أعطِ المريض رسالة تأكيد متكاملة ومنسقة، ضع رقم الدور בداخل دائرة رمزية مثل ❶ أو ❷...
- أخبره بصرامة ولطف أن آخر موعد لتسديد الرسوم هو خلال يومين وفقاً لتوقيت اليمن (Asia/Aden).
- إذا سأل عن أمور خارج المستشفى أو الحجوزات، وجهه بسلاسة واعتذار سريع للعودة للموضوع الطبي.`;

    const chat = ai.chats.create({
      model: 'gemini-3.5-flash',
      config: {
        systemInstruction,
        temperature: 0.7,
        tools: [{
          functionDeclarations: [
            {
              name: 'getDoctors',
              description: 'Fetch list of available doctors and their specialties.'
            },
            {
              name: 'checkCapacity',
              description: 'Check if a specific doctor has available slots on a given date and shift.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  doctorId: { type: 'STRING', description: 'ID of the doctor' },
                  dateStr: { type: 'STRING', description: 'YYYY-MM-DD' },
                  shift: { type: 'STRING', description: 'Morning, Evening, etc.' }
                },
                required: ['doctorId', 'dateStr', 'shift']
              }
            },
            {
              name: 'makeBooking',
              description: 'Book an appointment for a patient in the database.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Full quadruple patient name' },
                  doctorId: { type: 'STRING' },
                  dateStr: { type: 'STRING', description: 'YYYY-MM-DD' },
                  shift: { type: 'STRING' },
                  phone: { type: 'STRING' }
                },
                required: ['name', 'doctorId', 'dateStr', 'shift', 'phone']
              }
            }
          ]
        }]
      }
    });

    // Feed prior history back to the session if the new SDK permits, or just append messages manually.
    // For simplicty in the Route Handler we trigger the message directly assuming isolated turns.
    let response = await chat.sendMessage({ parts: [{ text: messageBody }] });
    let finalAnswer = response.text || '';

    // Handle Function Calling
    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      if (call.name && toolsMap[call.name]) {
         const toolResult = await toolsMap[call.name](call.args);
         
         const followUpResponse = await chat.sendMessage({
           parts: [{
             functionResponse: {
                name: call.name,
                response: toolResult
             }
           }]
         });
         finalAnswer = followUpResponse.text || finalAnswer;
      }
    }

    // Update Session Memory
    history.push({ role: 'user', content: messageBody });
    history.push({ role: 'assistant', content: finalAnswer });
    await supabase.from('bot_sessions').upsert({ phone: fromPhone, history });

    // 5. Outbound Communication
    await fetch('https://Waleedoo-borg-whatsapp-server-1.hf.space/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: fromPhone, message: finalAnswer })
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[WhatsApp Webhook Error]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
