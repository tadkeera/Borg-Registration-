/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  is_active: boolean;
  created_at?: string;
  allow_second_week_booking?: boolean;
  limit_two_patients_per_number?: boolean;
}

export interface Schedule {
  id: string;
  doctor_id: string;
  day_of_week: number; // 0 = Sat, 1 = Sun, 2 = Mon, 3 = Tue, 4 = Wed, 5 = Thu
  max_capacity: number;
  available_capacity: number;
  start_time: string; // e.g., '09:00'
  end_time: string;   // e.g., '13:00'
  created_at?: string;
  // Joins
  doctor_name?: string;
  doctor_specialty?: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'cancelled';

export interface Booking {
  id: string;
  doctor_id: string;
  schedule_id: string;
  patient_name: string;
  patient_phone: string;
  booking_date: string; // YYYY-MM-DD
  queue_number: number;
  status: BookingStatus;
  payment_status: PaymentStatus;
  verified_by_whatsapp: boolean;
  created_at?: string;
  // Related info
  doctor_name?: string;
  doctor_specialty?: string;
}

export interface WhatsAppSettings {
  id: number;
  webhook_verify_token: string;
  access_token: string;
  app_secret: string;
  phone_number_id: string;
  is_active: boolean;
  provider?: 'meta' | 'render' | 'huggingface';
  render_server_url?: string;
  huggingface_server_url?: string;
}

export interface SystemSettings {
  id: number;
  admin_password?: string; // Hidden on client
  receptionist_name_required: boolean;
}

export type BotState = 'IDLE' | 'SELECTING_DOCTOR' | 'SELECTING_SHIFT' | 'SELECTING_DAY' | 'AWAITING_NAME' | 'CONFIRMING' | 'COMPLETED';

export interface BotSession {
  id: string;
  phone: string;
  current_state: BotState;
  patient_name: string | null;
  selected_doctor_id: string | null;
  selected_schedule_id: string | null;
  selected_day_offset: number | null; // index of available schedules list
  selected_shift: 'morning' | 'evening' | null;
  selected_date: string | null;
  last_interaction_at: string; // ISO string
}

export interface WhatsAppLog {
  id: string;
  phone: string;
  direction: 'in' | 'out';
  message: string;
  timestamp: string; // ISO string
}

export interface User {
  id: string;
  username: string;
  password: string;
  role: 'admin' | 'receptionist';
  employee_name?: string;
  created_at?: string;
}

export interface DbState {
  doctors: Doctor[];
  schedules: Schedule[];
  bookings: Booking[];
  whatsapp_settings: WhatsAppSettings;
  system_settings: SystemSettings;
  bot_sessions: Record<string, BotSession>;
  whatsapp_logs: WhatsAppLog[];
  users?: User[];
}
