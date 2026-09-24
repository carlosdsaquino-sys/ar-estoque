import { dialogAlert, dialogConfirm, dialogPrompt } from '@/components/DialogProvider';
import { allRows } from '@/lib/data';
import { operationId } from '@/lib/utils';
import { todayLocal } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, type Service, type Client, type Product, type Unit, type ServiceMaterial, type ServiceAppliance, type PerformedService, type ServiceType } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, formatNumber, paymentMethodLabels } from '@/lib/utils';
import {
  LoadingSpinner, ErrorState, EmptyState, PageHeader, Badge,
  Modal, Button, Input, Select, Textarea,
} from '@/components/ui';
import {
  Wrench, Plus, Search, Eye, Pencil, DollarSign, XCircle,
  CheckCircle2, Printer, Trash2,
} from 'lucide-react';

export default function Services() {
  const { profile } = useAuth();
  const [services, setServices] = useState<(Service & { client?: Client })[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [viewing, setViewing] = useState<Service | null>(null);
  const [paying, setPaying] = useState<Service | null>(null);
  const [canceling, setCanceling] = useState<Service | null>(null);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('services')
        .select('*, client:clients(*)')
        .order('service_date', { ascending: false })
        .order('id');

      if (filterClient) query = query.eq('client_id', filterClient);
      if (filterStatus) query = query.eq('status', filterStatus);
      if (filterPayment) query = query.eq('payment_status', filterPayment);
      if (dateFrom) query = query.gte('service_date', dateFrom);
      if (dateTo) query = query.lte('service_date', dateTo);

      const data = await allRows(() => query);
      setServices(data as (Service & { client?: Client })[]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filterClient, filterStatus, filterPayment, dateFrom, dateTo]);

  useEffect(() => {
    loadServices();
    allRows<Client>(() => supabase.from('clients').select('*').order('name').order('id'))
      .then(setClients)
      .catch(e => setError(errorMessage(e)));
  }, [loadServices]);

  const filtered = services.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !s.description?.toLowerCase().includes(q) &&
        !s.client?.name?.toLowerCase().includes(q) &&
        !String(s.number).includes(q)
      ) return false;
    }
    return true;
  });

  async function handleDelete(s: Service) {
    if (s.status === 'confirmado') {
      dialogAlert('Não é possível excluir um serviço confirmado. Cancele-o primeiro.');
      return;
    }
    if (!await dialogConfirm(`Arquivar o serviço #${s.number}?`)) return;
    const { error } = await supabase.rpc('delete_draft_service', { p_service_id: s.id });
    if (error) { dialogAlert('Erro: ' + error.message); return; }
    loadServices();
  }

  if (loading && services.length === 0) return <LoadingSpinner label="Carregando serviços..." />;
  if (error) return <ErrorState message={error} onRetry={loadServices} />;

  return (
    <div>
      <PageHeader title="Serviços" subtitle={`${services.length} serviços`}>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Novo Serviço
        </Button>
      </PageHeader>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <Select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
            <option value="">Todos clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todos status</option>
            <option value="rascunho">Rascunho</option>
            <option value="confirmado">Confirmado</option>
            <option value="cancelado">Cancelado</option>
          </Select>
          <Select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}>
            <option value="">Todos pagamentos</option>
            <option value="pendente">Pendente</option>
            <option value="pago">Pago</option>
          </Select>
          <Input aria-label="Data inicial" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input aria-label="Data final" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Wrench} title="Nenhum serviço encontrado" description="Crie um novo serviço" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Data</th>
                <th className="text-left px-4 py-3 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Descrição</th>
                <th className="text-right px-4 py-3 font-medium">Valor Total</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Pagamento</th>
                <th className="text-center px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">#{s.number}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(s.service_date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{s.client?.name ?? '-'}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-600 max-w-xs truncate">{s.description || '-'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(s.total_value)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={s.status === 'confirmado' ? 'green' : s.status === 'rascunho' ? 'blue' : 'gray'}>
                      {s.status === 'rascunho' ? 'Rascunho' : s.status === 'confirmado' ? 'Confirmado' : 'Cancelado'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.status === 'confirmado' && (
                      <Badge color={s.payment_status === 'pago' ? 'green' : 'yellow'}>
                        {s.payment_status === 'pago' ? 'Pago' : 'Pendente'}
                      </Badge>
                    )}
                    {s.status === 'rascunho' && <span className="text-xs text-slate-400">-</span>}
                    {s.status === 'cancelado' && <span className="text-xs text-slate-400">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewing(s)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Visualizar">
                        <Eye className="w-4 h-4" />
                      </button>
                      {s.status !== 'cancelado' && s.payment_status !== 'pago' && (
                        <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {s.status === 'confirmado' && s.payment_status === 'pendente' && (
                        <button onClick={() => setPaying(s)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Marcar como pago">
                          <DollarSign className="w-4 h-4" />
                        </button>
                      )}
                      {s.payment_status === 'pago' && profile?.role === 'admin' && (
                        <button className="text-xs text-orange-700" onClick={async () => {
                          const reason = await dialogPrompt('Justifique a correção do pagamento. Isso marca o serviço como pendente; não executa reembolso bancário.');
                          if (!reason?.trim()) return;
                          const { error } = await supabase.rpc('reverse_payment', { p_service_id: s.id, p_reason: reason });
                          if (error) dialogAlert(error.message); else loadServices();
                        }}>Corrigir pagamento</button>
                      )}
                      {s.status !== 'cancelado' && s.payment_status !== 'pago' && (
                        <button onClick={() => setCanceling(s)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Cancelar">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      {s.status === 'rascunho' && profile?.role === 'admin' && (
                        <button onClick={() => handleDelete(s)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Arquivar rascunho">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ServiceForm
          service={editing}
          clients={clients}
          onSave={async () => { setShowForm(false); setEditing(null); loadServices(); }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {viewing && (
        <ServiceDetail service={viewing} onClose={() => setViewing(null)} />
      )}

      {paying && (
        <PaymentModal
          service={paying}
          onClose={() => setPaying(null)}
          onPaid={() => { setPaying(null); loadServices(); }}
        />
      )}

      {canceling && (
        <CancelModal
          service={canceling}
          onClose={() => setCanceling(null)}
          onCancelled={() => { setCanceling(null); loadServices(); }}
        />
      )}
    </div>
  );
}

type MaterialDraft = Omit<ServiceMaterial, 'quantity' | 'unit_price'> & { quantity: string; unit_price: string };
type TaskDraft = Omit<PerformedService, 'unit_price' | 'id' | 'created_at'> & { id: string | null; created_at?: string; unit_price: string; is_legacy?: boolean };
type ApplianceDraft = { id: string; notes: string; services: TaskDraft[]; materials: MaterialDraft[] };

function newAppliance(): ApplianceDraft {
  return { id: crypto.randomUUID(), notes: '', services: [], materials: [] };
}

function applianceHasData(appliance: ApplianceDraft): boolean {
  return Boolean(appliance.notes.trim()) || appliance.services.length > 0 || appliance.materials.length > 0;
}

function parseDecimalInput(value: string): number {
  const text = value.trim();
  if (text === '') return 0;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

function ServiceForm({
  service, clients, onSave, onClose,
}: {
  service: Service | null;
  clients: Client[];
  onSave: () => void;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [appliances, setAppliances] = useState<ApplianceDraft[]>(() => [newAppliance()]);
  const [editingApplianceCount, setEditingApplianceCount] = useState(false);
  const [applianceCountInput, setApplianceCountInput] = useState('1');
  const [form, setForm] = useState({
    client_id: service?.client_id ?? '',
    service_date: service?.service_date ?? todayLocal(),
    description: service?.description ?? '',
    technician: service?.technician ?? '',
    discount: String(service?.discount ?? 0),
    notes: service?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef<{payload:string;id:string}|null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [pr, tr, ar, mr] = await Promise.all([
          allRows(() => supabase.from('products').select('*, unit:units(*)').order('name').order('id')).then(data => ({ data, error: null })),
          supabase.from('service_types').select('*').order('name'),
          service ? supabase.from('service_appliances').select('*').eq('service_id', service.id).order('appliance_number') : Promise.resolve({ data: [], error: null }),
          service ? supabase.from('service_materials').select('*, product:products(*), unit:units(*)').eq('service_id', service.id) : Promise.resolve({ data: [], error: null }),
        ]);
        if (pr.error || tr.error || ar.error || mr.error) throw pr.error || tr.error || ar.error || mr.error;

        const applianceRows = (ar.data ?? []) as ServiceAppliance[];
        const taskResult = applianceRows.length
          ? await supabase.from('performed_services').select('*').in('appliance_id', applianceRows.map(a => a.id)).order('created_at')
          : { data: [], error: null };
        if (taskResult.error) throw taskResult.error;

        const taskRows = (taskResult.data ?? []) as PerformedService[];
        const materialRows = (mr.data ?? []) as ServiceMaterial[];
        const loadedAppliances = applianceRows.map(a => ({
          id: a.id,
          notes: a.notes,
          services: taskRows.filter(t => t.appliance_id === a.id).map(t => ({ ...t, is_legacy: !t.service_type_id, unit_price: String(t.unit_price) })),
          materials: materialRows.filter(m => m.appliance_id === a.id).map(m => ({ ...m, quantity: String(m.quantity), unit_price: String(m.unit_price) })),
        }));
        const legacyAppliance = service && !applianceRows.length ? [{
          id: crypto.randomUUID(),
          notes: '',
          services: [{ id: null, appliance_id: '', service_type_id: null, name_snapshot: service.description || 'Serviço registrado', description_snapshot: 'Registro anterior', unit_price: String(service.labor_value), created_at: '', is_legacy: true }],
          materials: materialRows.map(m => ({ ...m, quantity: String(m.quantity), unit_price: String(m.unit_price) })),
        }] : [];
        if (active) {
          setProducts(pr.data ?? []);
          setServiceTypes((tr.data ?? []) as ServiceType[]);
          const initialAppliances = loadedAppliances.length
            ? loadedAppliances
            : legacyAppliance.length
              ? legacyAppliance
              : [newAppliance()];
          setAppliances(initialAppliances);
          setApplianceCountInput(String(initialAppliances.length));
          setReady(true);
        }
      } catch (err) {
        if (active) setLoadError(errorMessage(err));
      }
    })();
    return () => { active = false; };
  }, [service]);

  const servicesTotal = appliances.reduce((sum, a) => sum + a.services.reduce((s, task) => s + parseDecimalInput(task.unit_price), 0), 0);
  const materialsTotal = appliances.reduce((sum, a) => sum + a.materials.reduce((s, m) => s + m.subtotal, 0), 0);
  const discountValue = parseDecimalInput(form.discount);
  const totalValue = materialsTotal + servicesTotal - discountValue;

  async function setApplianceCount(count: number) {
    if (!Number.isInteger(count) || count < 1) return;
    if (count < appliances.length) {
      const removed = appliances.slice(count);
      if (removed.some(applianceHasData) && !(await dialogConfirm('Os aparelhos removidos têm informações preenchidas. Deseja removê-los e todos os seus serviços, materiais e observações?'))) return;
      setAppliances(appliances.slice(0, count));
    } else if (count > appliances.length) {
      setAppliances([...appliances, ...Array.from({ length: count - appliances.length }, newAppliance)]);
    }

    setApplianceCountInput(String(count));
  }

  function addTask(applianceIndex: number) {
    setAppliances(current => current.map((a, i) => i === applianceIndex ? { ...a, services: [...a.services, {
      id: null, appliance_id: a.id, service_type_id: null, name_snapshot: '', description_snapshot: '', unit_price: '0', created_at: '',
    }] } : a));
  }

  function updateTask(applianceIndex: number, taskIndex: number, field: 'service_type_id' | 'unit_price', value: string) {
    setAppliances(current => current.map((a, i) => i !== applianceIndex ? a : { ...a, services: a.services.map((task, j) => {
      if (j !== taskIndex) return task;
      if (field === 'unit_price') return { ...task, unit_price: value };
      const type = serviceTypes.find(t => t.id === value);
      return { ...task, service_type_id: value || null, name_snapshot: type?.name ?? '', description_snapshot: type?.description ?? '', unit_price: String(type?.default_price ?? 0) };
    }) }));
  }

  function addMaterial(applianceIndex: number) {
    setAppliances(current => current.map((a, i) => i !== applianceIndex ? a : { ...a, materials: [...a.materials, {
      id: '', service_id: service?.id ?? '', appliance_id: a.id, product_id: '', unit_id: null, quantity: '1', unit_cost: 0, unit_price: '0', subtotal: 0,
    }] }));
  }

  function updateMaterial(applianceIndex: number, materialIndex: number, field: 'product_id' | 'quantity' | 'unit_price', value: string) {
    setAppliances(current => current.map((a, i) => i !== applianceIndex ? a : { ...a, materials: a.materials.map((material, j) => {
      if (j !== materialIndex) return material;
      const updated = { ...material, [field]: value };
      if (field === 'product_id') {
        const product = products.find(p => p.id === value);
        updated.unit_id = product?.unit_id ?? null;
        updated.unit_cost = product?.unit_cost ?? 0;
        updated.unit_price = String(product?.unit_price ?? 0);
      }
      updated.subtotal = Math.round(parseDecimalInput(updated.quantity) * parseDecimalInput(updated.unit_price) * 100) / 100;
      return updated;
    }) }));
  }

  async function handleSave(confirm: boolean) {
    if (busy.current || !ready) return;
    if (!applianceCountInput.trim() || !Number.isInteger(Number(applianceCountInput)) || Number(applianceCountInput) < 1) {
      dialogAlert('Informe a quantidade de aparelhos.');
      return;
    }
    if (!form.client_id || !form.service_date || !form.description.trim() || !form.technician.trim()) {
      dialogAlert('Preencha cliente, data, descrição e técnico responsável.');
      return;
    }
    if ([servicesTotal, materialsTotal, discountValue, totalValue].some(v => !Number.isFinite(v) || v < 0)) {
      dialogAlert('Confira os valores e o desconto.');
      return;
    }
    if (appliances.some(a => a.services.length === 0 || a.services.some(t => !t.service_type_id && !t.id && !t.is_legacy || !Number.isFinite(parseDecimalInput(t.unit_price)) || parseDecimalInput(t.unit_price) < 0))) {
      dialogAlert('Adicione ao menos um tipo de serviço válido para cada aparelho e confira os preços.');
      return;
    }
    if (appliances.some(a => a.materials.some(m => !m.product_id || !Number.isFinite(parseDecimalInput(m.quantity)) || parseDecimalInput(m.quantity) <= 0 || !Number.isFinite(parseDecimalInput(m.unit_price)) || parseDecimalInput(m.unit_price) < 0))) {
      dialogAlert('Confira os materiais, quantidades e preços.');
      return;
    }
    if (appliances.some(a => new Set(a.materials.map(m => m.product_id)).size !== a.materials.length)) {
      dialogAlert('Não repita o material no mesmo aparelho; some as quantidades na mesma linha.');
      return;
    }

    const appliancePayload = appliances.map(a => ({
      notes: a.notes,
      services: a.services.map(t => ({ id: t.id, service_type_id: t.service_type_id, is_legacy: t.is_legacy ?? false, unit_price: parseDecimalInput(t.unit_price) })),
      materials: a.materials.map(m => ({ id: m.id || null, product_id: m.product_id, quantity: parseDecimalInput(m.quantity), unit_price: parseDecimalInput(m.unit_price) })),
    }));

    const payload = {
      p_service_id: service?.id ?? null,
      p_data: {
        ...form,
        technician: form.technician,
        discount: discountValue,
      },
      p_appliances: appliancePayload,
      p_confirm: confirm || service?.status === 'confirmado',
      p_expected_version: service?.version ?? null,
    };

    busy.current = true;
    setSaving(true);
    setConfirming(confirm);

    try {
      const { error } = await supabase.rpc('save_service_visit', {
        ...payload,
        p_request_id: operationId(request, payload),
      });
      if (error) throw error;
      onSave();
    } catch (err) {
      dialogAlert(errorMessage(err));
    } finally {
      busy.current = false;
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <Modal open={true} onClose={() => { if (!saving) onClose(); }} title={service ? `Editar Serviço #${service.number}` : 'Novo Serviço'} size="xl">
      <div className="space-y-4">
        {loadError && <p className="text-red-700">{loadError}</p>}
        {!ready && !loadError && <LoadingSpinner />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Cliente *" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required>
            <option value="">Selecione...</option>
            {clients.filter(c => !c.archived_at || c.id === service?.client_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (Arquivado — atendimento existente)' : ''}</option>)}
          </Select>
          <Input label="Data do Serviço" type="date" value={form.service_date} onChange={(e) => setForm({ ...form, service_date: e.target.value })} />
        </div>

        <Textarea label="Descrição do Atendimento *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Resumo do atendimento" required />

        {/* Técnico digitado manualmente. Não é o usuário logado e não é um select. */}
        <Input
          label="Técnico Responsável *"
          type="text"
          value={form.technician}
          onChange={(e) => setForm({ ...form, technician: e.target.value })}
          placeholder="Digite o nome do técnico"
          required
        />

        <Textarea label="Observações gerais" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="max-w-xs">
          <Input
            label="Quantidade de aparelhos *"
            type="text"
            inputMode="numeric"
            value={applianceCountInput}
            required
            readOnly={appliances.some(applianceHasData) && !editingApplianceCount}
            onChange={e => {
              const value = e.target.value.replace(/\D/g, '');
              setApplianceCountInput(value);

              if (
                (!appliances.some(applianceHasData) || editingApplianceCount) &&
                value !== ''
              ) {
                const count = Number(value);
                if (Number.isInteger(count) && count > 0) {
                  setApplianceCount(count);
                }
              }
            }}
            onBlur={() => {
              if (applianceCountInput === '' || Number(applianceCountInput) < 1) {
                setApplianceCountInput(String(appliances.length));
              }
            }}
          />

          {appliances.some(applianceHasData) && !editingApplianceCount && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                if (await dialogConfirm('Alterar a quantidade pode adicionar ou remover aparelhos. Os aparelhos existentes serão preservados; a remoção de aparelhos preenchidos exigirá nova confirmação. Deseja continuar?')) {
                  setEditingApplianceCount(true);
                }
              }}
            >
              Alterar quantidade de aparelhos
            </Button>
          )}

          {editingApplianceCount && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-amber-700">
                Aparelhos existentes serão preservados. Ao reduzir, será solicitada confirmação se houver dados nos aparelhos removidos.
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditingApplianceCount(false)}>
                Concluir alteração
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {appliances.map((appliance, applianceIndex) => {
            const deviceServicesTotal = appliance.services.reduce((sum, task) => sum + parseDecimalInput(task.unit_price), 0);
            const deviceMaterialsTotal = appliance.materials.reduce((sum, material) => sum + material.subtotal, 0);

            return (
              <section key={appliance.id} className="motion-item rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-slate-800">AR-CONDICIONADO {applianceIndex + 1}</h3>
                <Textarea label="Observações deste aparelho" value={appliance.notes} onChange={e => setAppliances(current => current.map((a, i) => i === applianceIndex ? { ...a, notes: e.target.value } : a))} />

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-700">Serviços realizados</h4>
                    <Button type="button" size="sm" variant="secondary" onClick={() => addTask(applianceIndex)}>
                      <Plus className="h-4 w-4" /> Adicionar serviço
                    </Button>
                  </div>

                  {appliance.services.length === 0 && (
                    <p className="rounded-lg bg-slate-50 py-3 text-center text-sm text-slate-400">Adicione ao menos um serviço para este aparelho.</p>
                  )}

                  <div className="space-y-2">
                    {appliance.services.map((task, taskIndex) => {
                      const legacy = !task.service_type_id && (Boolean(task.id) || Boolean(task.is_legacy));
                      return (
                        <div key={task.id ?? `${appliance.id}-service-${taskIndex}`} className="motion-item grid grid-cols-12 items-end gap-2 rounded-lg bg-slate-50 p-2">
                          <div className="col-span-12 sm:col-span-7">
                            <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de serviço</label>
                            <select
                              value={task.service_type_id ?? ''}
                              disabled={legacy}
                              onChange={e => updateTask(applianceIndex, taskIndex, 'service_type_id', e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                            >
                              {legacy ? <option value="">Registro anterior: {task.name_snapshot}</option> : <option value="">Selecione...</option>}
                              {serviceTypes.filter(type => type.is_active || type.id === task.service_type_id).map(type => (
                                <option key={type.id} value={type.id} disabled={!type.is_active}>
                                  {type.name}{type.is_active ? '' : ' (inativo)'}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-10 sm:col-span-4">
                            <label className="mb-1 block text-xs font-medium text-slate-600">Preço do serviço (R$)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={task.unit_price}
                              onChange={e => updateTask(applianceIndex, taskIndex, 'unit_price', e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                            />
                          </div>

                          <div className="col-span-2 flex justify-center pb-1">
                            <button
                              type="button"
                              onClick={() => setAppliances(current => current.map((a, i) => i === applianceIndex ? { ...a, services: a.services.filter((_, j) => j !== taskIndex) } : a))}
                              className="rounded p-1 text-red-400 hover:text-red-600"
                              aria-label="Excluir serviço"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-700">Materiais utilizados</h4>
                    <Button type="button" size="sm" variant="secondary" onClick={() => addMaterial(applianceIndex)}>
                      <Plus className="h-4 w-4" /> Adicionar material
                    </Button>
                  </div>

                  {appliance.materials.length === 0 && (
                    <p className="rounded-lg bg-slate-50 py-3 text-center text-sm text-slate-400">Nenhum material adicionado</p>
                  )}

                  <div className="space-y-2">
                    {appliance.materials.map((m, materialIndex) => (
                      <div key={m.id || `${appliance.id}-material-${materialIndex}`} className="motion-item grid grid-cols-12 items-start gap-2 rounded-lg bg-slate-50 p-2">
                        <div className="col-span-12 sm:col-span-4">
                          <label className="mb-1 block min-h-6 text-[10px] leading-3 text-slate-500 sm:text-[11px]">Material</label>
                          <select value={m.product_id} onChange={e => updateMaterial(applianceIndex, materialIndex, 'product_id', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                            <option value="">Produto...</option>
                            {products.filter(p => p.is_active || appliance.materials.some(item => item.product_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                          </select>
                        </div>

                        <div className="col-span-3 sm:col-span-2">
                          <label className="mb-1 block min-h-6 text-[10px] leading-3 text-slate-500 sm:text-[11px]">Quantidade</label>
                          <input type="text" inputMode="decimal" placeholder="Qtd" value={m.quantity} onChange={e => updateMaterial(applianceIndex, materialIndex, 'quantity', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                        </div>

                        <div className="col-span-4 sm:col-span-2">
                          <label className="mb-1 block min-h-6 text-[10px] leading-3 text-slate-500 sm:text-[11px]">Preço unitário (R$)</label>
                          <input type="text" inputMode="decimal" placeholder="Preço" value={m.unit_price} onChange={e => updateMaterial(applianceIndex, materialIndex, 'unit_price', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                        </div>

                        <div className="col-span-4 sm:col-span-3 text-right text-xs font-medium">
                          <span className="mb-1 block min-h-6 text-[10px] leading-3 text-slate-500 sm:text-[11px]">Total</span>
                          {Number.isFinite(m.subtotal) ? formatCurrency(m.subtotal) : '—'}
                        </div>

                        <div className="col-span-1 flex justify-center pt-7">
                          <button
                            type="button"
                            onClick={() => setAppliances(current => current.map((a, i) => i === applianceIndex ? { ...a, materials: a.materials.filter((_, j) => j !== materialIndex) } : a))}
                            className="p-1 text-red-400 hover:text-red-600"
                            aria-label="Excluir material"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-slate-200 pt-3 text-sm">
                  <span className="text-slate-500">Serviços: <strong className="text-slate-800">{formatCurrency(deviceServicesTotal)}</strong></span>
                  <span className="text-slate-500">Materiais: <strong className="text-slate-800">{formatCurrency(deviceMaterialsTotal)}</strong></span>
                  <span className="text-slate-700">Total do aparelho: <strong>{formatCurrency(deviceServicesTotal + deviceMaterialsTotal)}</strong></span>
                </div>
              </section>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Serviços realizados</p><p className="font-semibold">{formatCurrency(servicesTotal)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Materiais</p><p className="font-semibold">{formatCurrency(materialsTotal)}</p></div>
          <Input label="Desconto (R$)" type="text" inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Total</label>
            <div className="px-3 py-2.5 bg-sky-50 rounded-lg font-bold text-sky-700">
              {Number.isFinite(totalValue) ? formatCurrency(totalValue) : '—'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="secondary" onClick={() => handleSave(false)} disabled={saving || !ready}>
            {saving ? 'Salvando...' : service?.status === 'confirmado' ? 'Salvar correção' : 'Salvar rascunho'}
          </Button>
          <Button type="button" variant="success" onClick={() => handleSave(true)} disabled={saving || confirming || !ready}>
            {confirming ? 'Confirmando...' : 'Salvar e Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type HistoryEntry = { id: string; action: string; description: string; user_name: string; created_at: string };

const historyTitles: Record<string, string> = {
  criacao: 'Serviço criado', edicao: 'Serviço atualizado',
  confirmacao: 'Serviço confirmado', pagamento: 'Pagamento registrado',
  correcao_pagamento: 'Pagamento corrigido', cancelamento: 'Serviço cancelado',
};

function historyLines(entry: HistoryEntry, materials: ServiceMaterial[]): string[] {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(entry.description);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['Alteração registrada.'];
    data = parsed as Record<string, unknown>;
  } catch {
    return [entry.description || 'Alteração registrada.'];
  }
  const lines: string[] = [];
  const money = (value: unknown) => {
    if (value === null || value === undefined || value === '') return 'Não informado';
    const number = Number(value);
    return Number.isFinite(number) ? formatCurrency(number) : 'Não informado';
  };
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDate(value) : 'Não informada';
  const method = (value: unknown) => typeof value === 'string'
    ? paymentMethodLabels[value] ?? value : 'Não informada';
  if (entry.action === 'pagamento') {
    return [`Valor recebido: ${money(data.valor)}`, `Data: ${date(data.data)}`, `Forma de pagamento: ${method(data.forma)}`];
  }
  if (entry.action === 'correcao_pagamento') {
    return [
      'Pagamento anterior desfeito no controle do sistema.',
      `Valor anterior: ${money(data.valor)}`,
      `Data anterior: ${date(data.data_anterior)}`,
      `Forma anterior: ${method(data.forma_anterior)}`,
      `Motivo: ${typeof data.motivo === 'string' ? data.motivo : 'Não informado'}`,
    ];
  }
  if (entry.action === 'cancelamento') {
    const ids = Array.isArray(data.materiais_devolvidos) ? data.materiais_devolvidos : null;
    if (!ids) return ['Serviço cancelado. Devoluções não detalhadas neste registro.'];
    if (!ids.length) return ['Serviço cancelado sem devolução de materiais ao estoque.'];
    return ['Materiais devolvidos ao estoque:', ...ids.map(id => {
      const material = materials.find(m => m.id === id);
      return material
        ? `${material.product?.name ?? 'Material'}: ${formatNumber(material.quantity)} ${material.unit?.name ?? ''}`.trim()
        : 'Material devolvido (detalhes não disponíveis neste registro).';
    })];
  }
  if (entry.action === 'criacao' || entry.action === 'edicao') {
    const snapshot = (value: unknown, heading: string) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const item = value as Record<string, unknown>;
      lines.push(heading);
      if (typeof item.description === 'string' && item.description) lines.push(`Descrição: ${item.description}`);
      if (item.service_date) lines.push(`Data do serviço: ${date(item.service_date)}`);
      if (typeof item.technician === 'string' && item.technician) lines.push(`Técnico: ${item.technician}`);
      if (item.labor_value !== undefined) lines.push(`Mão de obra: ${money(item.labor_value)}`);
      if (item.discount !== undefined) lines.push(`Desconto: ${money(item.discount)}`);
      if (typeof item.notes === 'string' && item.notes) lines.push(`Observações: ${item.notes}`);
    };
    const materialLines = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (!value.length) { lines.push('Sem materiais.'); return; }
      value.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return;
        const row = item as Record<string, unknown>;
        const known = materials.find(m => m.product_id === row.product_id);
        const quantity = Number(row.quantity);
        lines.push(`${known?.product?.name ?? 'Material do registro'}: ${Number.isFinite(quantity) ? formatNumber(quantity) : 'Quantidade não informada'}${known?.unit?.name ? ' ' + known.unit.name : ''} × ${money(row.unit_price)}`);
      });
    };
    const applianceLines = (value: unknown, heading: string) => {
      if (!Array.isArray(value)) return;
      lines.push(heading);
      value.forEach((rawDevice, index) => {
        if (!rawDevice || typeof rawDevice !== 'object') return;
        const device = rawDevice as Record<string, unknown>;
        lines.push(`Ar-condicionado ${device.appliance_number ?? index + 1}`);
        if (typeof device.notes === 'string' && device.notes) lines.push(`Observações: ${device.notes}`);
        if (Array.isArray(device.services)) device.services.forEach(rawTask => {
          if (!rawTask || typeof rawTask !== 'object') return;
          const task = rawTask as Record<string, unknown>;
          lines.push(`Serviço: ${String(task.name ?? 'Serviço')} · ${money(task.unit_price)}`);
        });
        if (Array.isArray(device.materials)) device.materials.forEach(rawMaterial => {
          if (!rawMaterial || typeof rawMaterial !== 'object') return;
          const material = rawMaterial as Record<string, unknown>;
          lines.push(`Material: ${String(material.product_name ?? 'Material')} · ${String(material.quantity ?? '')} × ${money(material.unit_price)} = ${money(material.subtotal)}`);
        });
      });
    };
    if (entry.action === 'edicao' && data.antes) {
      snapshot(data.antes, 'Antes da alteração:');
      if (Array.isArray(data.aparelhos_antes)) applianceLines(data.aparelhos_antes, 'Detalhamento anterior:');
      else materialLines(data.materiais_antes);
    }
    snapshot(data.depois, entry.action === 'criacao' ? 'Dados do serviço:' : 'Após a alteração:');
    if (Array.isArray(data.aparelhos_depois)) applianceLines(data.aparelhos_depois, 'Detalhamento por aparelho:');
    else materialLines(data.materiais_depois);
    return lines.length ? lines : ['Dados do serviço registrados.'];
  }
  return ['Alteração registrada no histórico do serviço.'];
}

function ServiceDetail({ service, onClose }: { service: Service; onClose: () => void }) {
  const [client, setClient] = useState<Client | null>(null);
  const [materials, setMaterials] = useState<(ServiceMaterial & { product?: Product; unit?: Unit })[]>([]);
  const [appliances, setAppliances] = useState<(ServiceAppliance & { services: PerformedService[]; materials: (ServiceMaterial & { product?: Product; unit?: Unit })[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [history,setHistory]=useState<HistoryEntry[]>([]);

  useEffect(() => {
    (async () => {
      const [clientRes, matsRes, historyRes, appliancesRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', service.client_id).maybeSingle(),
        supabase.from('service_materials').select('*, product:products(*), unit:units(*)').eq('service_id', service.id),
        supabase.from('service_history').select('*').eq('service_id',service.id).order('created_at',{ascending:false}),
        supabase.from('service_appliances').select('*').eq('service_id',service.id).order('appliance_number'),
      ]);
      if (clientRes.error || matsRes.error || historyRes.error || appliancesRes.error) setDetailError(errorMessage(clientRes.error || matsRes.error || historyRes.error || appliancesRes.error));
      const applianceRows = (appliancesRes.data ?? []) as ServiceAppliance[];
      const taskRes = applianceRows.length ? await supabase.from('performed_services').select('*').in('appliance_id', applianceRows.map(a => a.id)).order('created_at') : { data: [], error: null };
      if (taskRes.error) setDetailError(errorMessage(taskRes.error));
      const allTasks = (taskRes.data ?? []) as PerformedService[];
      const allMaterials = (matsRes.data ?? []) as (ServiceMaterial & { product?: Product; unit?: Unit })[];
      setHistory(historyRes.data ?? []);
      if (clientRes.data) setClient(clientRes.data as Client);
      setMaterials(allMaterials);
      setAppliances(applianceRows.map(a => ({ ...a, services: allTasks.filter(t => t.appliance_id === a.id), materials: allMaterials.filter(m => m.appliance_id === a.id) })));
      setLoading(false);
    })();
  }, [service]);

  function handlePrint() {
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) {
      dialogAlert('Permita abrir uma nova janela para imprimir o serviço.');
      return;
    }
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char] ?? char));
    const status = service.status === 'confirmado' ? 'Confirmado'
      : service.status === 'cancelado' ? 'Cancelado' : 'Rascunho';
    const paymentStatus = service.payment_status === 'pago' ? 'Pago'
      : service.payment_status === 'cancelado' ? 'Cancelado' : 'Pendente';
    const materialTotal = materials.reduce((sum, m) => sum + m.subtotal, 0);
    const applianceSections = appliances.length ? appliances.map(appliance => {
      const taskTotal = appliance.services.reduce((sum, task) => sum + task.unit_price, 0);
      const deviceMaterials = appliance.materials.reduce((sum, material) => sum + material.subtotal, 0);
      const taskRows = appliance.services.map(task => `<tr><td>${escape(task.name_snapshot)}</td><td class="number">${escape(formatCurrency(task.unit_price))}</td></tr>`).join('');
      const materialRows = appliance.materials.map(m => `<tr><td>${escape(m.product?.name ?? 'Material')}</td><td class="number">${escape(formatNumber(m.quantity))} ${escape(m.unit?.name ?? '')}</td><td class="number">${escape(formatCurrency(m.unit_price))}</td><td class="number">${escape(formatCurrency(m.subtotal))}</td></tr>`).join('');
      return `<section><h2>Ar-condicionado ${appliance.appliance_number}</h2>${appliance.notes ? `<p class="text">${escape(appliance.notes)}</p>` : ''}<h3>Serviços realizados</h3><table><thead><tr><th>Tipo de serviço</th><th class="number">Preço</th></tr></thead><tbody>${taskRows}</tbody></table><h3>Materiais utilizados</h3><table><thead><tr><th>Material</th><th class="number">Quantidade</th><th class="number">Preço unitário</th><th class="number">Subtotal</th></tr></thead><tbody>${materialRows || '<tr><td colspan="4">Nenhum material</td></tr>'}</tbody></table><p class="number"><strong>Total do aparelho: ${escape(formatCurrency(taskTotal + deviceMaterials))}</strong></p></section>`;
    }).join('') : `<h2>Materiais utilizados</h2><table><thead><tr><th>Material</th><th class="number">Quantidade</th><th class="number">Preço unitário</th><th class="number">Subtotal</th></tr></thead><tbody>${materials.map(m => `<tr><td>${escape(m.product?.name ?? 'Material')}</td><td class="number">${escape(formatNumber(m.quantity))}</td><td class="number">${escape(formatCurrency(m.unit_price))}</td><td class="number">${escape(formatCurrency(m.subtotal))}</td></tr>`).join('')}</tbody></table>`;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8">
      <title>Serviço ${escape(service.number)}</title>
      <style>
        @page { size: A4; margin: 16mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #172033; background: white; font: 12px Arial, sans-serif; line-height: 1.5; }
        main { max-width: 780px; margin: 24px auto; padding: 20px; }
        h1 { font-size: 24px; margin: 0 0 4px; }
        h2 { font-size: 14px; margin: 24px 0 8px; } h3 { font-size: 12px; margin: 12px 0 4px; }
        header { border-bottom: 2px solid #0284c7; padding-bottom: 14px; }
        .muted, dt { color: #64748b; }
        dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; }
        dl div { min-width: 0; } dt { font-size: 11px; } dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
        p { margin: 4px 0; } .text { white-space: pre-wrap; overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { padding: 9px 6px; border-bottom: 1px solid #dce3ec; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
        th { background: #f1f5f9; font-size: 11px; }
        th:first-child { width: 40%; } .number { text-align: right; }
        thead { display: table-header-group; } tr, .totals, dl div { break-inside: avoid; }
        .totals { margin-top: 22px; margin-left: auto; width: 300px; max-width: 100%; }
        .totals div { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
        .total { border-top: 2px solid #cbd5e1; font-size: 17px; font-weight: bold; }
        button { padding: 10px 18px; border: 0; border-radius: 6px; background: #0284c7; color: white; cursor: pointer; }
        .toolbar { max-width: 780px; margin: 16px auto; padding: 0 20px; }
        @media print { .toolbar { display: none; } main { max-width: none; margin: 0; padding: 0; } }
      </style></head><body>
      <div class="toolbar"><button id="print-button" type="button">Imprimir / Salvar como PDF</button></div>
      <main>
        <header><h1>Serviço #${escape(service.number)}</h1><p class="muted">Resumo do serviço</p></header>
        <dl>
          <div><dt>Cliente</dt><dd>${escape(client?.name ?? 'Não informado')}</dd></div>
          <div><dt>Data do serviço</dt><dd>${escape(formatDate(service.service_date))}</dd></div>
          <div><dt>Telefone</dt><dd>${escape(client?.phone || 'Não informado')}</dd></div>
          <div><dt>Técnico responsável</dt><dd>${escape(service.technician || 'Não informado')}</dd></div>
          <div><dt>Endereço</dt><dd>${escape(client?.address || 'Não informado')}</dd></div>
          <div><dt>Situação do serviço</dt><dd>${escape(status)}</dd></div>
        </dl>
        <h2>Descrição do serviço</h2><p class="text">${escape(service.description || 'Não informada')}</p>
        <h2>Materiais utilizados</h2>
        ${applianceSections}
        <section class="totals">
          <div><span>Materiais</span><span>${escape(formatCurrency(materialTotal))}</span></div>
          <div><span>Serviços realizados</span><span>${escape(formatCurrency(service.labor_value))}</span></div>
          <div><span>Desconto</span><span>${escape(formatCurrency(service.discount))}</span></div>
          <div class="total"><span>Total</span><span>${escape(formatCurrency(service.total_value))}</span></div>
        </section>
        <h2>Pagamento</h2><p>Situação: <strong>${escape(paymentStatus)}</strong></p>
        ${service.payment_status === 'pago' ? `<p>Data: ${escape(service.payment_date ? formatDate(service.payment_date) : 'Não informada')} · Forma: ${escape(paymentMethodLabels[service.payment_method ?? ''] ?? service.payment_method ?? 'Não informada')}</p>` : ''}
        ${service.notes ? `<h2>Observações</h2><p class="text">${escape(service.notes)}</p>` : ''}
      </main></body></html>`);
    printWindow.document.close();
    const print = () => {
      if (printWindow.closed) return;
      printWindow.focus();
      printWindow.print();
    };
    printWindow.document.getElementById('print-button')?.addEventListener('click', print);
    void printWindow.document.fonts.ready.then(() => {
      if (!printWindow.closed) printWindow.setTimeout(print, 250);
    });
  }

  if (loading) return <Modal open={true} onClose={onClose} title={`Serviço #${service.number}`}><LoadingSpinner /></Modal>;

  if (detailError) return <Modal open onClose={onClose} title="Erro"><ErrorState message={detailError}/></Modal>;
  return (
    <Modal open={true} onClose={onClose} title={`Serviço #${service.number}`} size="lg">
      <div className="space-y-4 print:p-0">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Cliente</p>
            <p className="font-medium">{client?.name ?? '-'}</p>
            {client?.phone && <p className="text-xs text-slate-500">{client.phone}</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500">Data</p>
            <p className="font-medium">{formatDate(service.service_date)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Técnico</p>
            <p className="font-medium">{service.technician || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Status</p>
            <div className="flex gap-2">
              <Badge color={service.status === 'confirmado' ? 'green' : service.status === 'rascunho' ? 'blue' : 'gray'}>
                {service.status === 'rascunho' ? 'Rascunho' : service.status === 'confirmado' ? 'Confirmado' : 'Cancelado'}
              </Badge>
              {service.status === 'confirmado' && (
                <Badge color={service.payment_status === 'pago' ? 'green' : 'yellow'}>
                  {service.payment_status === 'pago' ? 'Pago' : 'Pendente'}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {service.description && (
          <div>
            <p className="text-xs text-slate-500 mb-1">Descrição</p>
            <p className="text-sm text-slate-700">{service.description}</p>
          </div>
        )}

        {appliances.length > 0 ? appliances.map(appliance => {
          const taskTotal = appliance.services.reduce((sum, task) => sum + task.unit_price, 0);
          const deviceMaterialsTotal = appliance.materials.reduce((sum, material) => sum + material.subtotal, 0);
          return <section key={appliance.id} className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-800">AR-CONDICIONADO {appliance.appliance_number}</h3>
            {appliance.notes && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-600">{appliance.notes}</p>}
            <p className="mb-1 text-xs font-semibold text-slate-500">Serviços realizados</p>
            <div className="space-y-1">
              {appliance.services.map(task => <div key={task.id} className="flex justify-between gap-3 text-sm"><span>{task.name_snapshot}</span><span className="shrink-0">{formatCurrency(task.unit_price)}</span></div>)}
            </div>
            <p className="mb-1 mt-3 text-xs font-semibold text-slate-500">Materiais utilizados</p>
            {appliance.materials.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-2 text-left">Material</th><th className="px-2 py-2 text-right">Qtd</th><th className="px-2 py-2 text-right">Preço unitário</th><th className="px-2 py-2 text-right">Subtotal</th></tr></thead><tbody className="divide-y divide-slate-100">{appliance.materials.map(m => <tr key={m.id}><td className="px-2 py-2">{m.product?.name ?? 'Produto'}</td><td className="px-2 py-2 text-right">{formatNumber(m.quantity)} {m.unit?.name ?? ''}</td><td className="px-2 py-2 text-right">{formatCurrency(m.unit_price)}</td><td className="px-2 py-2 text-right">{formatCurrency(m.subtotal)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-400">Nenhum material.</p>}
            <div className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold"><span>Total do aparelho</span><span>{formatCurrency(taskTotal + deviceMaterialsTotal)}</span></div>
          </section>;
        }) : materials.length > 0 && <div className="text-sm">{materials.map(m => <p key={m.id}>{m.product?.name} · {formatNumber(m.quantity)} × {formatCurrency(m.unit_price)}</p>)}</div>}

        <div className="bg-slate-50 rounded-lg p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Materiais:</span>
            <span>{formatCurrency(materials.reduce((s, m) => s + m.subtotal, 0))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Serviços realizados:</span>
            <span>{formatCurrency(service.labor_value)}</span>
          </div>
          {service.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Desconto:</span>
              <span>-{formatCurrency(service.discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200">
            <span>Total:</span>
            <span className="text-sky-700">{formatCurrency(service.total_value)}</span>
          </div>
        </div>

        {service.payment_status === 'pago' && service.payment_date && (
          <div className="bg-green-50 rounded-lg p-3 text-sm">
            <p className="text-green-700">
              Pago em {formatDate(service.payment_date)} via {paymentMethodLabels[service.payment_method ?? ''] ?? service.payment_method}
            </p>
          </div>
        )}

        {service.notes && (
          <div>
            <p className="text-xs text-slate-500 mb-1">Observações</p>
            <p className="text-sm text-slate-600">{service.notes}</p>
          </div>
        )}

        <div className="space-y-4 pt-4 border-t border-slate-200 print:hidden">
          <details className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
              Histórico de alterações ({history.length})
            </summary>
            <div className="max-h-80 overflow-y-auto px-3 pb-3 space-y-3">
              {history.length === 0 && <p className="p-2 text-sm text-slate-500">Nenhuma alteração registrada.</p>}
              {history.map(h => (
                <div key={h.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {historyTitles[h.action] ?? 'Alteração no serviço'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 break-words">
                    {new Date(h.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{!h.user_name || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(h.user_name) ? 'Usuário' : h.user_name}
                  </p>
                  <div className="mt-2 space-y-1 text-sm text-slate-600 break-words [overflow-wrap:anywhere]">
                    {historyLines(h, materials).map((line, index) => <p key={index} className="whitespace-pre-wrap">{line}</p>)}
                  </div>
                </div>
              ))}
            </div>
          </details>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={handlePrint}>
              <Printer className="w-4 h-4" /> Imprimir
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ service, onClose, onPaid }: { service: Service; onClose: () => void; onPaid: () => void }) {
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (saving || !paymentDate) return;
    setSaving(true);
    const { error } = await supabase.rpc('register_payment', {
      p_service_id: service.id,
      p_payment_date: paymentDate,
      p_payment_method: paymentMethod,
      p_expected_version: service.version,
    });
    if (error) { dialogAlert('Erro: ' + error.message); setSaving(false); return; }
    setSaving(false);
    onPaid();
  }

  return (
    <Modal open={true} onClose={onClose} title={`Registrar Pagamento - #${service.number}`} size="sm">
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-sm text-slate-500">Valor a receber</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(service.total_value)}</p>
        </div>
        <Input label="Data do Pagamento" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        <Select label="Forma de Pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="pix">Pix</option>
          <option value="dinheiro">Dinheiro</option>
          <option value="cartao">Cartão</option>
          <option value="transferencia">Transferência</option>
          <option value="outro">Outro</option>
        </Select>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="success" onClick={handleConfirm} disabled={saving || !paymentDate}>
            <CheckCircle2 className="w-4 h-4" /> {saving ? 'Registrando...' : 'Confirmar Pagamento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ service, onClose, onCancelled }: { service: Service; onClose: () => void; onCancelled: () => void }) {
  const [materials, setMaterials] = useState<(ServiceMaterial & { product?: Product })[]>([]);
  const [returnIds, setReturnIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (service.status === 'confirmado') {
      supabase.from('service_materials').select('*, product:products(*)').eq('service_id', service.id).then(({ data, error }) => {
        if (error) setLoadError(error.message);
        if (data) setMaterials(data as (ServiceMaterial & { product?: Product })[]);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [service]);

  function toggleReturn(id: string) {
    const next = new Set(returnIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setReturnIds(next);
  }

  async function handleCancel() {
    setSaving(true);
    const { error } = await supabase.rpc('cancel_service', {
      p_service_id: service.id,
      p_return_materials: Array.from(returnIds),
    });
    if (error) { dialogAlert('Erro: ' + error.message); setSaving(false); return; }
    setSaving(false);
    onCancelled();
  }

  return (
    <Modal open={true} onClose={onClose} title={`Cancelar Serviço #${service.number}`} size="md">
      {loadError ? <ErrorState message={loadError}/> : loading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">
              {service.status === 'confirmado'
                ? 'Este serviço já teve materiais baixados do estoque. Selecione quais materiais realmente voltaram ao estoque.'
                : 'Confirma o cancelamento deste serviço?'}
            </p>
          </div>

          {service.status === 'confirmado' && materials.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Materiais para devolver ao estoque:</p>
              <div className="space-y-2">
                {materials.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={returnIds.has(m.id)}
                      onChange={() => toggleReturn(m.id)}
                      className="w-4 h-4 rounded text-sky-500"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{m.product?.name ?? 'Produto'}</p>
                      <p className="text-xs text-slate-500">{formatNumber(m.quantity)} un.</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Materiais não selecionados serão considerados consumidos e não voltarão ao estoque.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Voltar</Button>
            <Button variant="danger" onClick={handleCancel} disabled={saving}>
              {saving ? 'Cancelando...' : 'Confirmar Cancelamento'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
