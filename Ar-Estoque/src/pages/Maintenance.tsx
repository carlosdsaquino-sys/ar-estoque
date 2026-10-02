import { useEffect, useMemo, useState } from 'react';
import { supabase, type MaintenanceOverviewItem, type PerformedService, type Service } from '@/lib/supabase';
import { useMaintenance } from '@/context/MaintenanceContext';
import { formatDate } from '@/lib/utils';
import { maintenanceCategory, type MaintenanceCategory } from '@/lib/maintenance';
import { ErrorState, LoadingSpinner, EmptyState, PageHeader, Badge, Button, Input, Modal } from '@/components/ui';
import { Bell, CalendarClock, CheckCircle2, Clock3, ExternalLink, Wrench } from 'lucide-react';
import type { PageId } from '@/components/AppLayout';

type MaintenanceFilter = 'all' | 'overdue' | 'today' | 'upcoming';
const filterLabels: Record<MaintenanceFilter, string> = { all: 'Todos', overdue: 'Atrasadas', today: 'Hoje', upcoming: 'Próximas' };
const categoryLabels: Record<MaintenanceCategory, string> = { overdue: 'Atrasada', today: 'Limpeza hoje', upcoming: 'Próxima limpeza', 'on-time': 'Em dia' };

export default function Maintenance({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { items, loading, error, overdueCount, todayCount, upcomingCount, onTimeCount, overdueClientCount, refresh } = useMaintenance();
  const [filter, setFilter] = useState<MaintenanceFilter>('all');
  const [search, setSearch] = useState('');
  const [historyFor, setHistoryFor] = useState<MaintenanceOverviewItem | null>(null);
  const dueItems = items.filter(item => maintenanceCategory(item) !== 'on-time');
  const filtered = useMemo(() => dueItems
    .filter(item => filter === 'all' || maintenanceCategory(item) === filter)
    .filter(item => !search || `${item.client_name} ${item.appliance_name} ${item.appliance_location} ${item.appliance_description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      const rank = (item: MaintenanceOverviewItem) => ({ overdue: 0, today: 1, upcoming: 2, 'on-time': 3 })[maintenanceCategory(item)];
      return rank(a) - rank(b) || a.days_until - b.days_until || a.client_name.localeCompare(b.client_name, 'pt-BR') || a.appliance_name.localeCompare(b.appliance_name, 'pt-BR');
    }), [dueItems, filter, search]);
  const dueClientCount = new Set(dueItems.map(item => item.client_id)).size;

  function openClient(clientId: string) {
    sessionStorage.setItem('ar-estoque-open-client', clientId);
    onNavigate('clients');
  }

  function registerService(item: MaintenanceOverviewItem) {
    sessionStorage.setItem('ar-estoque-new-maintenance-service', JSON.stringify({ client_id: item.client_id, client_appliance_id: item.client_appliance_id }));
    onNavigate('services');
  }

  if (loading) return <LoadingSpinner label="Carregando avisos de manutenção..." />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;

  return <div>
    <PageHeader title="Avisos de manutenção" subtitle="Acompanhe as manutenções preventivas dos aparelhos cadastrados." />

    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard color="red" icon={Bell} label="Aparelhos atrasados" value={overdueCount} />
      <SummaryCard color="orange" icon={CalendarClock} label="Manutenção para hoje" value={todayCount} />
      <SummaryCard color="yellow" icon={Clock3} label="Próximos do prazo" value={upcomingCount} />
      <SummaryCard color="green" icon={CheckCircle2} label="Em dia" value={onTimeCount} />
    </div>
    <p className="mb-4 text-sm text-slate-500">{overdueClientCount} {overdueClientCount === 1 ? 'cliente possui aparelho' : 'clientes possuem aparelhos'} com manutenção atrasada; {dueClientCount} {dueClientCount === 1 ? 'cliente tem' : 'clientes têm'} alguma manutenção que requer atenção.</p>

    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input aria-label="Pesquisar cliente ou aparelho" placeholder="Pesquisar cliente, aparelho ou local..." value={search} onChange={event => setSearch(event.target.value)} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar avisos">
          {(Object.keys(filterLabels) as MaintenanceFilter[]).map(option => <button key={option} type="button" onClick={() => setFilter(option)} aria-pressed={filter === option} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${filter === option ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{filterLabels[option]}</button>)}
        </div>
      </div>
    </div>

    {dueItems.length === 0 ? <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-900/60 dark:bg-green-950/20">
      <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
      <h2 className="font-semibold text-green-800 dark:text-green-200">Está tudo em dia.</h2>
      <p className="mt-1 text-sm text-green-700 dark:text-green-300">Não existem aparelhos com manutenção atrasada ou próxima da data configurada.</p>
    </div> : filtered.length === 0 ? <EmptyState icon={Bell} title="Nenhum aviso encontrado" description="Altere a pesquisa ou o filtro." /> : <div className="space-y-3">
      {filtered.map(item => <MaintenanceCard key={item.client_appliance_id} item={item} onClient={() => openClient(item.client_id)} onHistory={() => setHistoryFor(item)} onRegister={() => registerService(item)} onSchedule={() => { sessionStorage.setItem('ar-estoque-new-appointment', JSON.stringify({client_id:item.client_id, appliance_ids:[item.client_appliance_id], service_type_id:item.service_type_id})); onNavigate('appointments'); }} />)}
    </div>}

    {historyFor && <MaintenanceHistoryModal item={historyFor} onClose={() => setHistoryFor(null)} />}
  </div>;
}

function SummaryCard({ color, icon: Icon, label, value }: { color: 'red' | 'orange' | 'yellow' | 'green'; icon: typeof Bell; label: string; value: number }) {
  const colors = {
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300',
    orange: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/20 dark:text-orange-300',
    yellow: 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-950/20 dark:text-yellow-300',
    green: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-300',
  };
  return <div className={`flex items-center gap-3 rounded-xl border p-4 ${colors[color]}`}><Icon className="h-6 w-6 shrink-0" /><div><p className="text-sm">{label}</p><p className="text-2xl font-bold">{value}</p></div></div>;
}

function MaintenanceCard({ item, onClient, onHistory, onRegister, onSchedule }: { item: MaintenanceOverviewItem; onClient: () => void; onHistory: () => void; onRegister: () => void; onSchedule: () => void }) {
  const category = maintenanceCategory(item);
  const badgeColor = category === 'overdue' ? 'red' : category === 'today' ? 'yellow' : 'blue';
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <button type="button" onClick={onClient} className="text-left font-semibold text-slate-900 hover:text-sky-700 dark:text-slate-100 dark:hover:text-sky-300">{item.client_name}<ExternalLink className="ml-1 inline h-3.5 w-3.5" /></button>
        <h2 className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200">{item.appliance_name}</h2>
        {item.appliance_location && <p className="text-sm text-slate-500">Local: {item.appliance_location}</p>}
        {item.appliance_description && <p className="mt-1 text-sm text-slate-500">{item.appliance_description}</p>}
      </div>
      <Badge color={badgeColor}>{categoryLabels[category]}</Badge>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div><p className="text-xs text-slate-500">Última manutenção</p><p className="font-medium text-slate-800 dark:text-slate-200">{formatDate(item.last_maintenance_date)}</p></div>
      <div><p className="text-xs text-slate-500">Próxima manutenção</p><p className="font-medium text-slate-800 dark:text-slate-200">{formatDate(item.next_maintenance_date)}</p></div>
      <div className={category === 'overdue' ? 'text-red-700 dark:text-red-300' : category === 'today' ? 'text-orange-700 dark:text-orange-300' : 'text-slate-700 dark:text-slate-300'}>
        <p className="text-xs opacity-75">{category === 'overdue' ? 'Atrasada há' : category === 'today' ? 'Prazo' : 'Faltam'}</p>
        <p className="font-semibold">{category === 'today' ? 'Hoje' : `${Math.abs(item.days_until)} ${Math.abs(item.days_until) === 1 ? 'dia' : 'dias'}`}</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      <Button type="button" size="sm" variant="secondary" onClick={onClient}>Ver cliente</Button>
      <Button type="button" size="sm" variant="secondary" onClick={onHistory}>Ver histórico</Button>
      <Button type="button" size="sm" variant="secondary" onClick={onSchedule}>Agendar limpeza</Button>
      <Button type="button" size="sm" onClick={onRegister}><Wrench className="h-4 w-4" /> Registrar serviço</Button>
    </div>
  </article>;
}

type ApplianceHistoryRow = { id: string; appliance_number: number; service: Pick<Service, 'id' | 'number' | 'service_date' | 'status' | 'description'> };

function MaintenanceHistoryModal({ item, onClose }: { item: MaintenanceOverviewItem; onClose: () => void }) {
  const [rows, setRows] = useState<ApplianceHistoryRow[]>([]);
  const [tasks, setTasks] = useState<PerformedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: queryError } = await supabase.from('service_appliances')
        .select('id, appliance_number, service:services!inner(id, number, service_date, status, description)')
        .eq('client_appliance_id', item.client_appliance_id);
      if (queryError) { if (active) { setError(queryError.message); setLoading(false); } return; }
      const applianceRows = (data ?? []) as unknown as ApplianceHistoryRow[];
      const taskResult = applianceRows.length
        ? await supabase.from('performed_services').select('*').in('appliance_id', applianceRows.map(row => row.id)).order('created_at', { ascending: false })
        : { data: [], error: null };
      if (active) {
        if (taskResult.error) setError(taskResult.error.message);
        else { setRows(applianceRows); setTasks((taskResult.data ?? []) as PerformedService[]); }
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [item.client_appliance_id]);
  return <Modal open title={`Histórico — ${item.appliance_name}`} onClose={onClose} size="lg">
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{item.client_name}{item.appliance_location ? ` · ${item.appliance_location}` : ''}</p>
      {error ? <ErrorState message={error} /> : loading ? <LoadingSpinner label="Carregando histórico..." /> : rows.length === 0 ? <EmptyState icon={CalendarClock} title="Nenhum atendimento encontrado" /> : rows
        .sort((a, b) => b.service.service_date.localeCompare(a.service.service_date))
        .map(row => <div key={row.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap justify-between gap-2"><strong className="text-slate-800 dark:text-slate-100">Serviço #{row.service.number}</strong><span className="text-sm text-slate-500">{formatDate(row.service.service_date)}</span></div>
          <p className="mt-1 text-sm text-slate-500">{row.service.description}</p>
          <Badge color={row.service.status === 'confirmado' ? 'green' : row.service.status === 'rascunho' ? 'blue' : 'gray'}>{row.service.status}</Badge>
          <div className="mt-2 space-y-1">{tasks.filter(task => task.appliance_id === row.id).map(task => <p key={task.id} className="text-sm text-slate-700 dark:text-slate-300">{task.name_snapshot}{task.maintenance_enabled_snapshot ? ' · manutenção recorrente' : ''}</p>)}</div>
        </div>)}
      <div className="flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button></div>
    </div>
  </Modal>;
}
