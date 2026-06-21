-- SUPABASE SQL SCHEMA DEFINITIONS
-- Doctors Tower Hospital Clinic Registration Management System
-- نظام إدارة التسجيل في مستشفى برج الأطباء

-- Enable uuid-ossp extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. DOCTORS TABLE
CREATE TABLE IF NOT EXISTS public.doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. SCHEDULES TABLE (Sat to Thu, Friday is rigid day off)
-- day_of_week mapping:
-- 0 = Saturday (السبت)
-- 1 = Sunday (الأحد)
-- 2 = Monday (الإثنين)
-- 3 = Tuesday (الثلاثاء)
-- 4 = Wednesday (الأربعاء)
-- 5 = Thursday (الخميس)
CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 5),
    max_capacity INTEGER NOT NULL DEFAULT 15,
    available_capacity INTEGER NOT NULL DEFAULT 15,
    start_time TEXT NOT NULL DEFAULT '09:00',
    end_time TEXT NOT NULL DEFAULT '13:00',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (doctor_id, day_of_week)
);

-- 3. BOOKINGS TABLE (With queue management, payment status)
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE NOT NULL,
    schedule_id UUID REFERENCES public.schedules(id) ON DELETE CASCADE NOT NULL,
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    booking_date DATE NOT NULL, -- Format: YYYY-MM-DD
    queue_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cancelled')),
    verified_by_whatsapp BOOLEAN DEFAULT false,
    shift TEXT DEFAULT 'Morning',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create index for faster queue lookup and date filtering
CREATE INDEX IF NOT EXISTS idx_bookings_lookup ON public.bookings(doctor_id, booking_date);

-- 4. WHATSAPP SETTINGS TABLE (Multi-number)
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_verify_token TEXT NOT NULL DEFAULT 'doctors_tower_verify_token_123',
    access_token TEXT DEFAULT '',
    app_secret TEXT DEFAULT '',
    phone_number_id TEXT UNIQUE DEFAULT '',
    provider TEXT DEFAULT 'meta',
    render_server_url TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- WHATSAPP WEBSOCKET/WEB SESSIONS FOR DEPLOYMENTS (Hugging Face / Render)
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    space_server_id TEXT PRIMARY KEY,
    session_data TEXT, -- Base64 encoded zip data containing .wwebjs_auth folder
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert default whatsapp settings
INSERT INTO public.whatsapp_settings (webhook_verify_token, access_token, app_secret, phone_number_id, is_active)
VALUES ('doctors_tower_verify_token_123', '', '', '', true)
ON CONFLICT (phone_number_id) DO NOTHING;

-- 5. SYSTEM SETTINGS TABLE (Singleton)
CREATE TABLE IF NOT EXISTS public.system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
    admin_password TEXT NOT NULL DEFAULT '123', -- Default admin credentials (changeable)
    receptionist_name_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert default system settings
INSERT INTO public.system_settings (id, admin_password, receptionist_name_required)
VALUES (1, '123', true)
ON CONFLICT (id) DO NOTHING;

-- 6. WHATSAPP BOT INTERACTION SESSION STATE
CREATE TABLE IF NOT EXISTS public.bot_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    current_state TEXT NOT NULL DEFAULT 'IDLE', -- IDLE, AWAITING_NAME, SELECTING_DOCTOR, SELECTING_DAY, CONFIRMING
    patient_name TEXT,
    selected_doctor_id UUID,
    selected_schedule_id UUID,
    selected_day_offset INTEGER,
    last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. WHATSAPP MESSAGE LOGS
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    message TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 8. API KEYS
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    key_value TEXT NOT NULL,
    provider TEXT DEFAULT 'gemini',
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =========================================================================
-- DATABASE TRIGGERS & FUNCTIONS
-- =========================================================================

-- Function 1: Auto-assign sequential queue number based on doctor and date
CREATE OR REPLACE FUNCTION public.assign_queue_number_and_capacity()
RETURNS TRIGGER AS $$
DECLARE
    next_q INT;
    max_cap INT;
    booked_cnt INT;
BEGIN
    -- 1. Lock and fetch the schedule's maximum capacity
    SELECT max_capacity INTO max_cap FROM public.schedules 
    WHERE id = NEW.schedule_id FOR UPDATE;

    -- 2. Count active/approved/pending bookings for this doctor/schedule on this specific booking_date
    SELECT COUNT(*) INTO booked_cnt FROM public.bookings
    WHERE schedule_id = NEW.schedule_id
      AND booking_date = NEW.booking_date
      AND status != 'cancelled'
      AND payment_status != 'cancelled';

    -- 3. Verify date-scoped capacity
    IF booked_cnt >= max_cap THEN
        RAISE EXCEPTION 'عذراً، لا يوجد سعة متوفرة للحجز في هذا الموعد المحدد للأسف.';
    END IF;

    -- 4. Get next sequence group queue number for this doctor on this day and shift
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO next_q
    FROM public.bookings
    WHERE doctor_id = NEW.doctor_id 
      AND booking_date = NEW.booking_date 
      AND COALESCE(shift, 'Morning') = COALESCE(NEW.shift, 'Morning');

    -- Assign to the new record
    NEW.queue_number := next_q;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_assign_queue_number_and_capacity
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.assign_queue_number_and_capacity();


-- Function 2: Adjust capacity when a booking is updated (No-op trigger remaining for backwards compatibility)
CREATE OR REPLACE FUNCTION public.adjust_capacity_on_update()
RETURNS TRIGGER AS $$
BEGIN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_adjust_capacity_on_update
AFTER UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.adjust_capacity_on_update();


-- Function 3: Weekly Reset (Triggered Thursday night 10:00 PM)
-- This RPC resets all available_capacities to their max capacities for the new week,
-- which closes the previous week's queue metrics so that queue numbering naturally starting fresh from booking_date-based sequences.
CREATE OR REPLACE FUNCTION public.reset_weekly_schedules_and_queues()
RETURNS VOID AS $$
BEGIN
    -- Reset schedules capacity back to maximum
    UPDATE public.schedules
    SET available_capacity = max_capacity;

    -- Delete or archive active sessions to prevent state confusion over the weekend
    DELETE FROM public.bot_sessions;
END;
$$ LANGUAGE plpgsql;
