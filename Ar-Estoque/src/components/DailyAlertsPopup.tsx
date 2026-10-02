import { useEffect, useRef, useState } from 'react';
import { useMaintenance } from '@/context/MaintenanceContext';
import { useAppointments } from '@/context/AppointmentsContext';
import { todayLocal } from '@/lib/utils';
import { dailyAlertsKey } from '@/lib/appointments';
import { Button, Modal } from './ui';
import type { PageId } from './AppLayout';

export default function DailyAlertsPopup({ userId, onNavigate }: { userId: string; onNavigate: (page: PageId) => void }) {
  const maintenance = useMaintenance();
  const appointments = useAppointments();
  const [open, setOpen] = useState(false);
  const checked = useRef('');
  const key = dailyAlertsKey(userId, todayLocal());
  const { todayCount, tomorrowCount } = appointments;
  const { overdueCount, todayCount: maintenanceToday, upcomingCount } = maintenance;
  useEffect(() => {
    if (maintenance.loading || appointments.loading || maintenance.error || appointments.error || checked.current === key) return;
    checked.current = key;
    try { if (localStorage.getItem(key)) return; } catch { /* Session guard remains available. */ }
    if (!todayCount && !tomorrowCount && !overdueCount && !maintenanceToday && !upcomingCount) return;
    try { localStorage.setItem(key, '1'); } catch { /* Show once in this session when storage is unavailable. */ }
    setOpen(true);
  }, [key, maintenance.loading, appointments.loading, maintenance.error, appointments.error, todayCount, tomorrowCount, overdueCount, maintenanceToday, upcomingCount]);
  return <Modal open={open} onClose={() => setOpen(false)} title="Avisos do dia" size="sm">
    <div className="space-y-4 text-sm">
      <section><h2 className="font-semibold">Agendamentos</h2><p>Hoje: {todayCount} agendamentos</p><p>Amanhã: {tomorrowCount} agendamentos</p></section>
      <section><h2 className="font-semibold">Manutenções</h2><p>Atrasadas: {overdueCount} aparelhos</p><p>Hoje: {maintenanceToday} aparelhos</p><p>Próximas: {upcomingCount} aparelhos</p></section>
      <p>Confira sua agenda e os avisos de manutenção antes de começar o dia.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => { setOpen(false); onNavigate('appointments'); }}>Ver agendamentos</Button><Button onClick={() => { setOpen(false); onNavigate('maintenance-alerts'); }}>Ver manutenções</Button><Button variant="secondary" onClick={() => setOpen(false)}>Fechar</Button></div>
    </div>
  </Modal>;
}
