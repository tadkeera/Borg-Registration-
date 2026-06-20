const fs = require('fs');

let content = fs.readFileSync('server.ts', 'utf8');

const startIndex = content.indexOf('async function handleWhatsappFlow(phone: string, messageObj: any): Promise<string> {');
if (startIndex === -1) throw new Error('Not found startIndex');


let endIndex = -1;
let indent = 0;
let started = false;

for (let i = startIndex; i < content.length; i++) {
  if (content[i] === '{') {
    indent++;
    started = true;
  } else if (content[i] === '}') {
    indent--;
    if (started && indent === 0) {
      endIndex = i + 1;
      break;
    }
  }
}

if (endIndex === -1) throw new Error('Not found endIndex');

const pre = content.substring(0, startIndex);
const post = content.substring(endIndex);

const newFunc = `
async function handleWhatsappFlow(phone: string, messageObj: any): Promise<string> {
  const supabase = getSupabase();
  const currentYemenNow = getYemenTime();
  const cleanPhone = normalizePhone(phone);
  
  const isTextMessage = messageObj.type === 'text';
  let messageText = isTextMessage ? (messageObj.text?.body || '').trim() : '';

  // Log inbound message
  await supabase.from('whatsapp_logs').insert([{
    phone: cleanPhone,
    direction: 'in',
    message: isTextMessage ? messageText : \`[رسالة وسائط متعددة أو غير مدعومة: \${messageObj.type}]\`,
    timestamp: currentYemenNow.toISOString()
  }]);

  if (!isTextMessage || !messageText) {
    const errorReply = "عذراً، أستطيع فقط فهم الرسائل النصية المكتوبة بصيغة واضحة.";
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone, direction: 'out', message: errorReply, timestamp: getYemenTime().toISOString()
    }]);
    return errorReply;
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const msg = "نظام الذكاء الاصطناعي معطل حاليا (مفتاح API مفقود).";
      await supabase.from('whatsapp_logs').insert([
        { phone: cleanPhone, direction: 'out', message: msg, timestamp: getYemenTime().toISOString() }
      ]);
      return msg;
    }
    const ai = new GoogleGenAI({ apiKey });

    // Fetch conversation history from whatsapp_logs
    const { data: logs } = await supabase
      .from('whatsapp_logs')
      .select('message, direction, timestamp')
      .eq('phone', cleanPhone)
      .order('timestamp', { ascending: true })
      .limit(30);

    const history = (logs || []).map(log => ({
      role: log.direction === 'in' ? 'user' : 'model',
      parts: [{ text: log.message }]
    }));
    
    // Ensure history starts with 'user'
    let validHistory = [];
    for (let i = 0; i < history.length; i++) {
       if (history[i].role === 'user') {
          validHistory = history.slice(i);
          break;
       }
    }
    // Remove the current message from history to prevent duplication
    if (validHistory.length > 0 && validHistory[validHistory.length - 1].parts[0].text === messageText) {
       validHistory.pop();
    }

    const systemInstruction = \`أنت مساعد ذكي ونشيط لمستشفى برج الأطباء في اليمن. تتحدث باللهجة اليمنية بطلاقة وبشكل طبيعي جداً.
مهمتك مساعدة المرضى في الاستعلام عن الأطباء وحجز المواعيد.
تعليمات سير العمل:
- رحب بالمريض واعرض عليه بكل لطف قائمة الأطباء.
- استوعب متطلبات المريض من نصه (مثلاً إذا قال "أشتي دكتور باطنية" ابحث فوراً عن أطباء الباطنية باستخدام الأداة getDoctors).
- لحجز الموعد تأكد أولاً من وجود سعة متاحة في التاريخ والفترة المختارة باستخدام أداة checkCapacity.
- اطلب الاسم الرباعي ليتم تسجيله بصورة رسمية.
- عند اجراء الحجز بنجاح (باستخدام makeBooking)، أعطِ المريض رسالة تأكيد متكاملة ومنسقة، ضع رقم الدور בداخل دائرة رمزية مثل ❶ أو ❷...
- أخبره بصرامة ولطف أن آخر موعد لتسديد الرسوم هو خلال يومين وفقاً لتوقيت اليمن (Asia/Aden).
- إذا سأل عن أمور خارج المستشفى أو الحجوزات، وجهه بسلاسة واعتذار سريع للعودة للموضوع الطبي.\`;

    // Initialize Database tools for Gemini
    const getDoctors = async () => {
      const { data, error } = await supabase.from('doctors').select('id, name, specialty');
      if (error) return { error: error.message };
      return { doctors: data };
    };

    const checkCapacity = async (args: any) => {
      const { doctorId, dateStr, shift } = args;
      const { data: schedule, error: schError } = await supabase
        .from('schedules')
        .select('id, max_capacity')
        .eq('doctor_id', doctorId)
        .eq('shift', shift)
        .maybeSingle();

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

    const makeBooking = async (args: any) => {
      const { name, doctorId, dateStr, shift, customerPhone } = args;
      const { data: schedule } = await supabase
        .from('schedules')
        .select('id')
        .eq('doctor_id', doctorId)
        .eq('shift', shift)
        .maybeSingle();

      if (!schedule) return { error: 'Schedule not found for that doctor.' };

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
          patient_phone: normalizePhone(customerPhone || phone),
          schedule_id: schedule.id,
          booking_date: dateStr,
          queue_number: queueNumber,
          status: 'confirmed',
          payment_status: 'pending'
        }])
        .select()
        .single();

      if (error) return { error: error.message };
      
      // Update session logic purely so UI is happy
      await supabase.from('bot_sessions').upsert({
         phone: cleanPhone,
         current_state: 'COMPLETED',
         patient_name: name,
         selected_doctor_id: doctorId,
         selected_schedule_id: schedule.id,
         selected_date: dateStr,
         selected_shift: shift,
         last_interaction_at: getYemenTime().toISOString()
      }, { onConflict: 'phone' });

      return { success: true, booking: data, queueNumber };
    };

    const toolsMap: Record<string, Function> = { getDoctors, checkCapacity, makeBooking };

    const chat = ai.chats.create({
      model: 'gemini-3.5-flash',
      config: {
        systemInstruction,
        temperature: 0.7,
        tools: [{
          functionDeclarations: [
            {
              name: 'getDoctors',
              description: 'Fetch list of available doctors and their specialties to show to the patient.'
            },
            {
              name: 'checkCapacity',
              description: 'Check if a specific doctor has available slots on a given date and shift.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  doctorId: { type: 'STRING', description: 'ID of the doctor (UUID)' },
                  dateStr: { type: 'STRING', description: 'Date string formatted as YYYY-MM-DD' },
                  shift: { type: 'STRING', description: 'Shift name exactly as "صباحية" or "مسائية"' }
                },
                required: ['doctorId', 'dateStr', 'shift']
              }
            },
            {
              name: 'makeBooking',
              description: 'Book an appointment for a patient in the database. Call THIS when patient confirms name and slot.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Full quadruple patient name in Arabic' },
                  doctorId: { type: 'STRING', description: 'Doctor UUID' },
                  dateStr: { type: 'STRING', description: 'Date in YYYY-MM-DD format' },
                  shift: { type: 'STRING', description: 'Shift ("صباحية" / "مسائية")' },
                  customerPhone: { type: 'STRING', description: 'Patient phone number' }
                },
                required: ['name', 'doctorId', 'dateStr', 'shift', 'customerPhone']
              }
            }
          ]
        }]
      }
    });

    let finalAnswer = "";
    try {
      let response = await chat.sendMessage({ parts: [{ text: messageText }] });
      finalAnswer = response.text || '';

      // Handle Function Calling recursively
      if (response.functionCalls && response.functionCalls.length > 0) {
        let maxLoops = 3;
        while(response.functionCalls && response.functionCalls.length > 0 && maxLoops > 0) {
           const call = response.functionCalls[0];
           if (call.name && toolsMap[call.name]) {
              const toolResult = await toolsMap[call.name](call.args);
              
              response = await chat.sendMessage({
                parts: [{
                  functionResponse: {
                     name: call.name,
                     response: toolResult
                  }
                }]
              });
              finalAnswer = response.text || finalAnswer;
           } else {
              break;
           }
           maxLoops--;
        }
      }
    } catch(err: any) {
      console.error(err);
      finalAnswer = "عذرا، النظام يواجه صعوبة مؤقتة في معالجة طلبك المعقد. الرجاء المحاولة لاحقا.";
    }

    if (!finalAnswer) {
      finalAnswer = "عذرا، لم أتمكن من الرد. يرجى المحاولة مرة أخرى.";
    }

    // Update bot session with last interaction so it shows active
    await supabase.from('bot_sessions').upsert({
      phone: cleanPhone,
      current_state: 'CHATTING_WITH_AI',
      last_interaction_at: getYemenTime().toISOString()
    }, { onConflict: 'phone' });

    // Ensure session isn't empty on frontend
    const { data: sessionData } = await supabase.from('bot_sessions').select('*').eq('phone', cleanPhone).single();
    if (!sessionData) {
      await supabase.from('bot_sessions').insert([{ phone: cleanPhone, current_state: 'CHATTING_WITH_AI', last_interaction_at: getYemenTime().toISOString() }]);
    }

    // Save outbound message to logs
    await supabase.from('whatsapp_logs').insert([{
      phone: cleanPhone,
      direction: 'out',
      message: finalAnswer,
      timestamp: getYemenTime().toISOString()
    }]);

    return finalAnswer;

  } catch (err: any) {
    console.error('Gemini Whatsapp Flow error:', err);
    const fallbackMessage = "عذراً، حدث خطأ داخلي في نظام الذكاء الاصطناعي.";
    await supabase.from('whatsapp_logs').insert([
      { phone: cleanPhone, direction: 'out', message: fallbackMessage, timestamp: getYemenTime().toISOString() }
    ]);
    return fallbackMessage;
  }
}
`;

fs.writeFileSync('server.ts', pre + newFunc + post, 'utf8');
console.log('Successfully completed regex replacement');
