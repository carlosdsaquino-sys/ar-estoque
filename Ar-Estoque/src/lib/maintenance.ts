import type { MaintenanceOverviewItem } from '@/lib/supabase';

export type MaintenanceCategory = 'overdue' | 'today' | 'upcoming' | 'on-time';

export function maintenanceCategory(item: Pick<MaintenanceOverviewItem, 'days_until' | 'alert_days'>): MaintenanceCategory {
  if (item.days_until < 0) return 'overdue';
  if (item.days_until === 0) return 'today';
  if (item.days_until <= item.alert_days) return 'upcoming';
  return 'on-time';
}

export function notifyMaintenanceDataChanged() {
  window.dispatchEvent(new Event('ar-estoque-maintenance-data-changed'));
}

export function maintenancePopupKey(userId: string, day: string): string {
  return `ar-estoque-maintenance-popup-${userId}-${day}`;
}
