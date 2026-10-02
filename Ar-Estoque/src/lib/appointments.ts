import type { Client, ClientAppliance, ServiceType } from './supabase';
export const appointmentStatuses = { agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', nao_compareceu: 'Não compareceu' };
export type AppointmentStatus = keyof typeof appointmentStatuses;
export interface Appointment {
  id: string; client_id: string; scheduled_date: string; scheduled_time: string;
  duration_minutes: number | null; technician: string; service_type_id: string | null;
  status: AppointmentStatus; notes: string; created_by: string | null; created_by_name?: string; created_at: string;
  updated_at: string; completed_service_id: string | null; version: number;
  client: Client | null; service_type: ServiceType | null;
  appliances: { client_appliance_id: string; appliance: ClientAppliance | null }[];
}
export type AppointmentSeed = { client_id: string; appliance_ids: string[]; service_type_id?: string | null };
export const isPendingAppointment = (a: Pick<Appointment, 'status'>) => a.status === 'agendado' || a.status === 'confirmado';
export function shiftLocalDate(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const notifyAppointmentsChanged = () => window.dispatchEvent(new Event('ar-estoque-appointments-changed'));
export function appointmentCounts(items: Pick<Appointment, 'status' | 'scheduled_date'>[], day: string) {
  const tomorrow = shiftLocalDate(day, 1);
  return {
    todayCount: items.filter(a => isPendingAppointment(a) && a.scheduled_date === day).length,
    tomorrowCount: items.filter(a => isPendingAppointment(a) && a.scheduled_date === tomorrow).length,
  };
}
export const dailyAlertsKey = (userId: string, day: string) => `ar-estoque-daily-alerts-${userId}-${day}`;

export function durationHoursToMinutes(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error('Informe uma duração válida em horas.');
  const hours = Number(value.trim().replace(',', '.'));
  const minutes = Math.round(hours * 60);
  if (!Number.isFinite(hours) || hours < 3 || minutes > 2147483647 || Math.abs(hours * 60 - minutes) > 0.0001) {
    throw new Error('A duração deve ser de pelo menos 3 horas, com precisão de minutos.');
  }
  return minutes;
}
export function durationMinutesToHours(minutes: number | null): string {
  return minutes === null ? '' : String(Number((minutes / 60).toFixed(6))).replace('.', ',');
}
export function appointmentEndTime(start: string, durationMinutes: number | null): string | null {
  if (durationMinutes === null || !/^\d{2}:\d{2}/.test(start)) return null;
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + durationMinutes;
  const days = Math.floor(minutes / 1440);
  const clock = `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${clock}${days ? ` (+${days} ${days === 1 ? 'dia' : 'dias'})` : ''}`;
}

export function shiftLocalMonth(day: string, amount: number) {
  const date = new Date(day + 'T12:00:00');
  const originalDay = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + amount);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); date.setDate(Math.min(originalDay, last));
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
