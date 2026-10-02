import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useAppointments } from '@/context/AppointmentsContext';
import { appointmentStatuses, appointmentEndTime, durationHoursToMinutes, durationMinutesToHours, isPendingAppointment, notifyAppointmentsChanged, shiftLocalDate, shiftLocalMonth, type Appointment, type AppointmentSeed, type AppointmentStatus } from '@/lib/appointments';
import { supabase, type Client, type ClientAppliance, type ServiceType } from '@/lib/supabase';
import { allRows } from '@/lib/data';
import { errorMessage, formatDate, operationId, todayLocal } from '@/lib/utils';
import { Button, EmptyState, ErrorState, Input, LoadingSpinner, Modal, PageHeader, Select, Textarea, Badge } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import type { PageId } from '@/components/AppLayout';

type View = 'day' | 'week' | 'month' | 'list';
const views: Record<View, string> = { day: 'Dia', week: 'Semana', month: 'Mês', list: 'Lista' };
const filters = { date: 'Data selecionada', today: 'Hoje', tomorrow: 'Amanhã', upcoming: 'Próximos', all: 'Todos', canceled: 'Cancelados', completed: 'Concluídos' };

export default function Appointments({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { items, loading, error, refresh, todayCount } = useAppointments();
  const [view, setView] = useState<View>('day');
  const [day, setDay] = useState(todayLocal());
  const [filter, setFilter] = useState<keyof typeof filters>('date');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [seed, setSeed] = useState<AppointmentSeed | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<Appointment | null>(null);
  const [canceling, setCanceling] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRequest = useRef<{payload:string;id:string}|null>(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const pending = sessionStorage.getItem('ar-estoque-new-appointment');
    sessionStorage.removeItem('ar-estoque-new-appointment');
    if (!pending) return;
    try { const data = JSON.parse(pending) as AppointmentSeed; if (typeof data.client_id === 'string' && Array.isArray(data.appliance_ids)) { setSeed(data); setFormOpen(true); } } catch { /* Ignore invalid navigation state. */ }
  }, []);
  function start(a: Appointment) {
    sessionStorage.setItem('ar-estoque-appointment-service', JSON.stringify(a));
    onNavigate('services');
  }
  async function cancel() {
    if (!canceling || busy) return;
    setBusy(true); setActionError('');
    const payload = { p_id: canceling.id, p_data: { ...canceling, status: 'cancelado' }, p_appliance_ids: canceling.appliances.map(a => a.client_appliance_id), p_expected_version: canceling.version };
    const { error } = await supabase.rpc('save_appointment', { ...payload, p_request_id: operationId(cancelRequest, payload) });
    if (error) setActionError(error.message); else { setCanceling(null); notifyAppointmentsChanged(); }
    setBusy(false);
  }
  const weekStart = shiftLocalDate(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7));
  const filtered = items.filter(a => {
    if (search && !`${a.client?.name} ${a.technician} ${a.service_type?.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
    if (filter === 'today') return a.scheduled_date === todayLocal() && isPendingAppointment(a);
    if (filter === 'tomorrow') return a.scheduled_date === shiftLocalDate(todayLocal(), 1) && isPendingAppointment(a);
    if (filter === 'upcoming') return a.scheduled_date >= todayLocal() && isPendingAppointment(a);
    if (filter === 'canceled') return a.status === 'cancelado';
    if (filter === 'completed') return a.status === 'concluido';
    if (filter === 'all' || view === 'list') return true;
    if (view === 'week') return a.scheduled_date >= weekStart && a.scheduled_date <= shiftLocalDate(weekStart, 6);
    if (view === 'month') return a.scheduled_date.slice(0, 7) === day.slice(0, 7);
    return a.scheduled_date === day;
  }).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.scheduled_time.localeCompare(b.scheduled_time) || (a.client?.name ?? '').localeCompare(b.client?.name ?? '', 'pt-BR'));
  if (loading && !items.length) return <LoadingSpinner label="Carregando agenda..." />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  return <div>
    <PageHeader title="Agendamentos" subtitle="Organize os próximos atendimentos."><Button onClick={() => { setEditing(null); setSeed(null); setFormOpen(true); }}>Novo agendamento</Button></PageHeader>
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30"><h2 className="font-semibold">Agendamentos de hoje</h2><p className="text-sm">{items.filter(a => a.scheduled_date === todayLocal() && a.status === 'agendado').length} agendados · {items.filter(a => a.scheduled_date === todayLocal() && a.status === 'confirmado').length} confirmados · {todayCount} pendentes</p></div>
    <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap gap-2">{(Object.keys(views) as View[]).map(v => <Button key={v} variant={v === view ? 'primary' : 'secondary'} onClick={() => setView(v)}>{views[v]}</Button>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input aria-label="Pesquisar agendamentos" placeholder="Cliente, técnico ou tipo de serviço..." value={search} onChange={e => setSearch(e.target.value)} /><Select aria-label="Filtrar agenda" value={filter} onChange={e => setFilter(e.target.value as keyof typeof filters)}>{Object.entries(filters).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select><Input aria-label="Data da agenda" type="date" value={day} onChange={e => { if (e.target.value) { setDay(e.target.value); setFilter('date'); } }} /></div>
      <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" onClick={() => { setDay(view === 'month' ? shiftLocalMonth(day, -1) : shiftLocalDate(day, view === 'week' ? -7 : -1)); setFilter('date'); }}>Anterior</Button><Button variant="secondary" onClick={() => { setDay(todayLocal()); setFilter('date'); }}>Hoje</Button><Button variant="secondary" onClick={() => { setDay(view === 'month' ? shiftLocalMonth(day, 1) : shiftLocalDate(day, view === 'week' ? 7 : 1)); setFilter('date'); }}>Próximo</Button><span>{view === 'week' ? `${formatDate(weekStart)} — ${formatDate(shiftLocalDate(weekStart,6))}` : view === 'month' ? day.slice(0,7) : formatDate(day)}</span></div>
    </div>
    {!filtered.length ? <EmptyState icon={CalendarClock} title="Nenhum agendamento encontrado" description="Altere a data ou os filtros, ou crie um agendamento." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map(a => <article key={a.id} className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900 ${a.scheduled_date === todayLocal() ? 'border-sky-400' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{a.client?.name}</h2><Badge color={a.status === 'concluido' ? 'green' : a.status === 'cancelado' ? 'gray' : a.status === 'confirmado' ? 'blue' : 'yellow'}>{appointmentStatuses[a.status]}</Badge></div>
      <p className="mt-2 font-semibold text-sky-700 dark:text-sky-300">{formatDate(a.scheduled_date)} — {a.scheduled_time.slice(0,5)}{a.duration_minutes !== null && ` até ${appointmentEndTime(a.scheduled_time, a.duration_minutes)}`}</p><p className="text-sm">{a.service_type?.name || 'Tipo não definido'}</p><p className="text-sm text-slate-500">Técnico: {a.technician || 'Não definido'} · {a.appliances.length} aparelhos{a.duration_minutes ? ` · ${durationMinutesToHours(a.duration_minutes)} horas` : ''}</p>
      <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setViewing(a)}>Ver</Button>{!a.completed_service_id && <Button size="sm" variant="secondary" onClick={() => { setEditing(a); setSeed(null); setFormOpen(true); }}>Editar</Button>}{isPendingAppointment(a) && <Button size="sm" onClick={() => start(a)}>{a.completed_service_id ? 'Continuar atendimento' : 'Iniciar atendimento'}</Button>}{isPendingAppointment(a) && !a.completed_service_id && <Button size="sm" variant="danger" onClick={() => { setActionError(''); setCanceling(a); }}>Cancelar</Button>}</div>
    </article>)}</div>}
    {formOpen && <AppointmentForm appointment={editing} seed={seed} day={day} onClose={() => setFormOpen(false)} />}
    {viewing && <Modal open onClose={() => setViewing(null)} title="Detalhes do agendamento"><div className="space-y-3 text-sm"><h2 className="font-semibold">{viewing.client?.name}</h2><p>{formatDate(viewing.scheduled_date)} — {viewing.scheduled_time.slice(0,5)}{viewing.duration_minutes !== null && ` até ${appointmentEndTime(viewing.scheduled_time, viewing.duration_minutes)} · ${durationMinutesToHours(viewing.duration_minutes)} horas`}</p><p>{appointmentStatuses[viewing.status]} · Técnico: {viewing.technician || 'Não definido'}</p><p>{viewing.service_type?.name}</p>{viewing.appliances.map(a => <p key={a.client_appliance_id}>{a.appliance?.name} {a.appliance?.location}</p>)}<p className="whitespace-pre-wrap">{viewing.notes}</p>{viewing.completed_service_id && <p>Atendimento vinculado. O histórico do agendamento é preservado mesmo se o serviço for cancelado.</p>}</div></Modal>}
    {canceling && <Modal open onClose={() => { if (!busy) setCanceling(null); }} title="Cancelar agendamento?"><p>O agendamento será marcado como cancelado e deixará de aparecer entre os compromissos pendentes.</p>{actionError && <p role="alert" className="text-red-600">{actionError}</p>}<div className="mt-4 flex gap-2"><Button variant="danger" disabled={busy} onClick={() => void cancel()}>Cancelar agendamento</Button><Button variant="secondary" disabled={busy} onClick={() => setCanceling(null)}>Voltar</Button></div></Modal>}
  </div>;
}

function AppointmentForm({ appointment, seed, day, onClose }: { appointment: Appointment | null; seed: AppointmentSeed | null; day: string; onClose: () => void }) {
  const { items } = useAppointments();
  const [clients, setClients] = useState<Client[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [devices, setDevices] = useState<ClientAppliance[]>([]);
  const [ready, setReady] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const request = useRef<{payload:string;id:string}|null>(null);
  const [deviceIds, setDeviceIds] = useState(appointment?.appliances.map(a => a.client_appliance_id) ?? seed?.appliance_ids ?? []);
  const [form, setForm] = useState({ client_id: appointment?.client_id ?? seed?.client_id ?? '', scheduled_date: appointment?.scheduled_date ?? day, scheduled_time: appointment?.scheduled_time.slice(0,5) ?? '', duration_hours: durationMinutesToHours(appointment?.duration_minutes ?? null), technician: appointment?.technician ?? '', service_type_id: appointment?.service_type_id ?? seed?.service_type_id ?? '', notes: appointment?.notes ?? '', status: appointment?.status ?? 'agendado' as AppointmentStatus });
  useEffect(() => {
    let active = true;
    Promise.all([allRows<Client>(() => supabase.from('clients').select('*').is('archived_at', null).order('name').order('id')), allRows<ServiceType>(() => supabase.from('service_types').select('*').eq('is_active',true).order('name').order('id'))]).then(([c,t]) => { if (active) { setClients(c); setTypes(t); setReady(true); } }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setDevices([]);
    if (!form.client_id) return;
    setDevicesLoading(true);
    allRows<ClientAppliance>(() => supabase.from('client_appliances').select('*').eq('client_id',form.client_id).eq('is_active',true).order('name').order('id')).then(d => { if (active) setDevices(d); }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setDevicesLoading(false); });
    return () => { active = false; };
  }, [form.client_id]);
  const conflict = form.technician.trim() && items.some(a => a.id !== appointment?.id && isPendingAppointment(a) && a.technician.trim().toLocaleLowerCase() === form.technician.trim().toLocaleLowerCase() && a.scheduled_date === form.scheduled_date && a.scheduled_time.slice(0,5) === form.scheduled_time);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (lock.current || !ready || devicesLoading) return;
    if (!form.client_id || !form.scheduled_date || !form.scheduled_time) { setError('Preencha cliente, data e horário.'); return; }
    if (deviceIds.some(id => !devices.some(d => d.id === id))) { setError('Selecione somente aparelhos ativos deste cliente.'); return; }
    let durationMinutes: number | null;
    try { durationMinutes = appointment && form.duration_hours === durationMinutesToHours(appointment.duration_minutes) ? appointment.duration_minutes : durationHoursToMinutes(form.duration_hours); }
    catch (e) { setError(errorMessage(e)); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      const payload = { p_id: appointment?.id ?? null, p_data: { ...form, service_type_id: form.service_type_id || null, duration_minutes: durationMinutes }, p_appliance_ids: deviceIds, p_expected_version: appointment?.version ?? null };
      const { error } = await supabase.rpc('save_appointment', { ...payload, p_request_id: operationId(request, payload) });
      if (error) throw error; notifyAppointmentsChanged(); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { lock.current = false; setSaving(false); }
  }
  return <Modal open title={appointment ? 'Editar agendamento' : 'Novo agendamento'} onClose={() => { if (!saving) onClose(); }} size="lg"><form onSubmit={save} className="space-y-4">
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <SearchableSelect label="Cliente *" value={form.client_id} options={clients.map(c => ({value:c.id,label:c.name}))} onChange={id => { setForm({...form,client_id:id}); setDeviceIds([]); }} disabled={saving} />
    <div className="grid gap-3 sm:grid-cols-2"><Input required label="Data *" type="date" value={form.scheduled_date} onChange={e => setForm({...form,scheduled_date:e.target.value})} /><Input required label="Horário *" type="time" value={form.scheduled_time} onChange={e => setForm({...form,scheduled_time:e.target.value})} /><Input label="Duração (horas)" type="text" inputMode="decimal" placeholder="Mínimo 3 horas, ex.: 3,5" value={form.duration_hours} onChange={e => setForm({...form,duration_hours:e.target.value})} /><Input label="Técnico" value={form.technician} onChange={e => setForm({...form,technician:e.target.value})} /></div>
    <DurationPreview start={form.scheduled_time} hours={form.duration_hours} />
    {appointment?.duration_minutes != null && appointment.duration_minutes < 180 && <p className="text-sm text-amber-700">Este registro tem uma duração antiga inferior a 3 horas. Ela será preservada; caso altere a duração, informe pelo menos 3 horas ou deixe em branco.</p>}
    {conflict && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Atenção: este técnico já possui um agendamento neste horário.</p>}
    <SearchableSelect label="Tipo de serviço" value={form.service_type_id} onChange={id => setForm({...form,service_type_id:id})} options={[{value:'',label:'Não definido'},...types.map(t => ({value:t.id,label:t.name}))]} />
    <SearchableSelect label="Adicionar aparelho" value="" disabled={!form.client_id || devicesLoading} onChange={id => { if (id && !deviceIds.includes(id)) setDeviceIds([...deviceIds,id]); }} options={devices.map(d => ({value:d.id,label:`${d.name} · ${d.location} · ${d.description}`,disabled:deviceIds.includes(d.id)}))} placeholder={devicesLoading ? 'Carregando aparelhos...' : 'Pesquisar aparelhos do cliente...'} />
    <div className="flex flex-wrap gap-2">{deviceIds.map(id => <Button key={id} size="sm" variant="secondary" onClick={() => setDeviceIds(deviceIds.filter(d => d !== id))}>{devices.find(d => d.id === id)?.name ?? 'Aparelho selecionado'} ×</Button>)}</div>
    <Textarea label="Observações" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} />
    <Select label="Status" value={form.status} onChange={e => setForm({...form,status:e.target.value as AppointmentStatus})}>{Object.entries(appointmentStatuses).filter(([key]) => key !== 'concluido').map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select><p className="text-xs text-slate-500">A conclusão acontece após a confirmação do atendimento em Serviços.</p>
    <div className="flex justify-end gap-2"><Button variant="secondary" disabled={saving} onClick={onClose}>Voltar</Button><Button type="submit" disabled={saving || !ready || devicesLoading}>{saving ? 'Salvando...' : 'Salvar agendamento'}</Button></div>
  </form></Modal>;
}

function DurationPreview({ start, hours }: { start: string; hours: string }) {
  try {
    const end = appointmentEndTime(start, durationHoursToMinutes(hours));
    return end ? <p className="text-sm text-slate-500">Término previsto: {end}</p> : null;
  } catch { return null; }
}
