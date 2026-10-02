import { dialogAlert, dialogConfirm } from '@/components/DialogProvider';
import { allRows } from '@/lib/data';
import { useAuth } from '@/context/AuthContext';
import { notifyMaintenanceDataChanged } from '@/lib/maintenance';
import { errorMessage } from '@/lib/utils';
import { useEffect, useState, useCallback } from 'react';
import { supabase, type Client, type ClientAppliance, type Service, type ServiceMaterial, type ServiceAppliance, type PerformedService, type Product } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber, paymentMethodLabels } from '@/lib/utils';
import {
  LoadingSpinner, ErrorState, EmptyState, PageHeader, Badge,
  Modal, Button, Input, Select, Textarea,
} from '@/components/ui';
import {
  Users, Plus, Pencil, Archive, ArchiveRestore, Trash2, Phone, MapPin, Wrench,
  ChevronRight,
} from 'lucide-react';

export default function Clients() {
  const {profile}=useAuth();
  const isAdmin=profile?.role==='admin';
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clientStatus, setClientStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await allRows(() => supabase.from('clients').select('*').order('name').order('id'));
      setClients(data as Client[]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    const pendingClientId = sessionStorage.getItem('ar-estoque-open-client');
    if (!pendingClientId) return;
    const pendingClient = clients.find(client => client.id === pendingClientId);
    if (pendingClient) {
      setViewing(pendingClient);
      sessionStorage.removeItem('ar-estoque-open-client');
    }
  }, [clients]);

  const filtered = clients.filter((c) =>
    (clientStatus === 'all' || (clientStatus === 'archived' ? Boolean(c.archived_at) : !c.archived_at)) &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
  );

  async function handleSave(data: Partial<Client>) {
    const rest = {name:data.name?.trim(),phone:data.phone,address:data.address,notes:data.notes};
    if (editing) {
      const { error } = await supabase.from('clients').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) { dialogAlert('Erro: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('clients').insert(rest);
      if (error) { dialogAlert('Erro: ' + error.message); return; }
    }
    setShowForm(false);
    setEditing(null);
    loadClients();
  }

  async function updateArchivedState(client: Client, archived: boolean) {
    const { error: archiveError } = await supabase.rpc('set_client_archived', {
      p_client_id: client.id,
      p_archived: archived,
    });
    if (archiveError) {
      dialogAlert('Não foi possível ' + (archived ? 'arquivar' : 'restaurar') + ' o cliente: ' + archiveError.message);
      return;
    }
    await loadClients();
    dialogAlert(archived ? 'Cliente arquivado com sucesso.' : 'Cliente restaurado com sucesso.');
  }

  async function handleArchive(client: Client) {
    const confirmed = await dialogConfirm(
      'Este cliente será retirado da lista de clientes ativos, mas todos os seus serviços, histórico e registros serão preservados.',
      { title: 'Arquivar cliente?', confirmLabel: 'Arquivar', cancelLabel: 'Cancelar' }
    );
    if (confirmed) await updateArchivedState(client, true);
  }

  async function handlePermanentDelete(client: Client, confirmationName: string): Promise<boolean> {
    try {
      const { error: deleteError } = await supabase.rpc('permanently_delete_archived_client', {
        p_client_id: client.id,
        p_confirmation_name: confirmationName,
      });
      if (deleteError) {
        dialogAlert('Não foi possível excluir o cliente: ' + deleteError.message);
        return false;
      }
      if (viewing?.id === client.id) setViewing(null);
      await loadClients();
      dialogAlert('Cliente excluído permanentemente.');
      return true;
    } catch (deleteError) {
      dialogAlert('Não foi possível excluir o cliente: ' + errorMessage(deleteError));
      return false;
    }
  }

  if (loading) return <LoadingSpinner label="Carregando clientes..." />;
  if (error) return <ErrorState message={error} onRetry={loadClients} />;

  return (
    <div>
      <PageHeader title="Clientes" subtitle={`${clients.length} clientes cadastrados`}>
        <Button disabled={!isAdmin} size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Novo Cliente
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 items-end gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Input
          label="Buscar"
          placeholder="Buscar por nome ou telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select label="Status" value={clientStatus} onChange={event => setClientStatus(event.target.value as typeof clientStatus)}>
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum cliente encontrado" description="Ajuste a busca ou o filtro de status." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setViewing(c)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-slate-900">{c.name}</h3>
                  {c.archived_at && <div className="mt-1"><Badge color="gray">Arquivado</Badge></div>}
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </div>
              <div className="space-y-1.5 text-sm text-slate-500">
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    <span>{c.phone}</span>
                  </div>
                )}
                {c.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span className="truncate">{c.address}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={!isAdmin} onClick={() => { setEditing(c); setShowForm(true); }}
                  aria-label={`Editar ${c.name}`}
                  className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {c.archived_at ? <>
                  <button type="button" disabled={!isAdmin} onClick={() => void updateArchivedState(c, false)} aria-label={`Restaurar ${c.name}`} title="Restaurar" className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors">
                    <ArchiveRestore className="w-4 h-4" />
                  </button>
                  <button type="button" disabled={!isAdmin} onClick={() => setDeleting(c)} aria-label={`Excluir permanentemente ${c.name}`} title="Excluir permanentemente" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </> : <button type="button" disabled={!isAdmin} onClick={() => void handleArchive(c)} aria-label={`Arquivar ${c.name}`} title="Arquivar" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                  <Archive className="w-4 h-4" />
                </button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ClientForm
          client={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {viewing && (
        <ClientDetail
          client={viewing}
          isAdmin={isAdmin}
          onClose={() => setViewing(null)}
        />
      )}
      {deleting && (
        <PermanentDeleteClientModal
          client={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={handlePermanentDelete}
        />
      )}
    </div>
  );
}

function ClientForm({
  client, onSave, onClose,
}: {
  client: Client | null;
  onSave: (c: Partial<Client>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: client?.name ?? '',
    phone: client?.phone ?? '',
    address: client?.address ?? '',
    notes: client?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) { dialogAlert('Nome é obrigatório'); return; }
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <Modal open={true} onClose={() => { if (!saving) onClose(); }} title={client ? 'Editar Cliente' : 'Novo Cliente'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nome *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Telefone/WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" />
        <Input label="Endereço" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua, número, bairro, cidade" />
        <Textarea label="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PermanentDeleteClientModal({
  client, onClose, onConfirm,
}: {
  client: Client;
  onClose: () => void;
  onConfirm: (client: Client, confirmationName: string) => Promise<boolean>;
}) {
  const [confirmationName, setConfirmationName] = useState('');
  const [saving, setSaving] = useState(false);
  const matchesName = confirmationName === client.name;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!matchesName || saving) return;
    setSaving(true);
    try {
      if (await onConfirm(client, confirmationName)) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose(); }} title="Excluir cliente permanentemente?" size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-bold">ATENÇÃO: esta ação é irreversível.</p>
          <p className="mt-2">A exclusão permanente removerá o cliente e os registros relacionados, incluindo o histórico de serviços.</p>
          <p className="mt-2">Movimentações de estoque serão preservadas e desvinculadas do cliente para manter o histórico e os saldos corretos.</p>
          <p className="mt-2">Depois da exclusão, os dados removidos não poderão ser recuperados.</p>
        </div>
        <Input
          label="Digite o nome exato do cliente para confirmar"
          value={confirmationName}
          onChange={event => setConfirmationName(event.target.value)}
          placeholder={client.name}
          autoComplete="off"
          required
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="danger" disabled={saving || !matchesName}>
            {saving ? 'Excluindo...' : 'Excluir permanentemente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type ClientService = Service & {
  materials?: (ServiceMaterial & { product?: Product })[];
  appliances?: (ServiceAppliance & { performed: PerformedService[] })[];
};

function ClientDetail({ client, isAdmin, onClose }: { client: Client; isAdmin: boolean; onClose: () => void }) {
  const [services, setServices] = useState<ClientService[]>([]);
  const [clientAppliances, setClientAppliances] = useState<ClientAppliance[]>([]);
  const [appliancesLoading, setAppliancesLoading] = useState(true);
  const [appliancesError, setAppliancesError] = useState('');
  const [applianceFormOpen, setApplianceFormOpen] = useState(false);
  const [editingAppliance, setEditingAppliance] = useState<ClientAppliance | null>(null);
  const [loading, setLoading] = useState(true);

  const loadClientAppliances = useCallback(async () => {
    setAppliancesLoading(true);
    setAppliancesError('');
    const { data, error: queryError } = await supabase.from('client_appliances').select('*').eq('client_id', client.id).order('name');
    if (queryError) setAppliancesError(errorMessage(queryError));
    else setClientAppliances((data ?? []) as ClientAppliance[]);
    setAppliancesLoading(false);
  }, [client.id]);

  useEffect(() => { void loadClientAppliances(); }, [loadClientAppliances]);

  async function setApplianceActive(appliance: ClientAppliance, is_active: boolean) {
    const { error: updateError } = await supabase.from('client_appliances').update({ is_active, updated_at: new Date().toISOString() }).eq('id', appliance.id);
    if (updateError) { dialogAlert('Não foi possível alterar o status do aparelho: ' + updateError.message); return; }
    notifyMaintenanceDataChanged();
    await loadClientAppliances();
  }

  async function saveAppliance(data: Pick<ClientAppliance, 'name' | 'location' | 'description'>) {
    const query = editingAppliance
      ? await supabase.from('client_appliances').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editingAppliance.id)
      : await supabase.from('client_appliances').insert({ ...data, client_id: client.id });
    if (query.error) { dialogAlert('Não foi possível salvar o aparelho: ' + query.error.message); return; }
    setApplianceFormOpen(false);
    setEditingAppliance(null);
    notifyMaintenanceDataChanged();
    await loadClientAppliances();
  }

  const [detailError,setDetailError]=useState('');
  useEffect(() => {
    let active=true;
    (async()=>{try{
      const data=await allRows<Service>(()=>supabase.from('services').select('*').eq('client_id',client.id).order('service_date',{ascending:false}).order('id'));
      const result=await Promise.all(data.map(async s=>{
        const [materials, applianceRows] = await Promise.all([
          allRows<ServiceMaterial & {product?:Product}>(()=>supabase.from('service_materials').select('*, product:products(*)').eq('service_id',s.id).order('id')),
          allRows<ServiceAppliance>(()=>supabase.from('service_appliances').select('*, client_appliance:client_appliances(*)').eq('service_id',s.id).order('appliance_number')),
        ]);
        const tasks=applianceRows.length?await allRows<PerformedService>(()=>supabase.from('performed_services').select('*').in('appliance_id',applianceRows.map(a=>a.id)).order('created_at')):[];
        return {...s,materials,appliances:applianceRows.map(a=>({...a,performed:tasks.filter(t=>t.appliance_id===a.id)}))};
      }));
      if(active)setServices(result);
    }catch(e){if(active)setDetailError(errorMessage(e));}finally{if(active)setLoading(false);}})();
    return ()=>{active=false;};
  },[client.id]);

  const totalServices = services.filter((s) => s.status === 'confirmado').reduce((sum, s) => sum + s.total_value, 0);
  const totalPaid = services.filter((s) => s.status === 'confirmado' && s.payment_status === 'pago').reduce((sum, s) => sum + s.total_value, 0);
  const totalPending = services.filter((s) => s.status === 'confirmado' && s.payment_status === 'pendente').reduce((sum, s) => sum + s.total_value, 0);

  return (
    <>
    <Modal open={true} onClose={onClose} title={client.name} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {client.phone && (
            <div className="flex items-center gap-2 text-slate-600">
              <Phone className="w-4 h-4 text-slate-400" />
              {client.phone}
            </div>
          )}
          {client.address && (
            <div className="flex items-center gap-2 text-slate-600">
              <MapPin className="w-4 h-4 text-slate-400" />
              {client.address}
            </div>
          )}
        </div>
        {client.notes && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">{client.notes}</div>
        )}

        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900 dark:text-slate-100">Aparelhos cadastrados</h3>
            {isAdmin && !client.archived_at && <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingAppliance(null); setApplianceFormOpen(true); }}><Plus className="h-4 w-4" /> Adicionar aparelho</Button>}
          </div>
          {appliancesError ? <ErrorState message={appliancesError} onRetry={loadClientAppliances} /> : appliancesLoading ? <LoadingSpinner label="Carregando aparelhos..." /> : clientAppliances.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800">Nenhum aparelho cadastrado para este cliente.</p>
          ) : <div className="space-y-2">
            {clientAppliances.map(appliance => <div key={appliance.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{appliance.name}</p><Badge color={appliance.is_active ? 'green' : 'gray'}>{appliance.is_active ? 'Ativo' : 'Inativo'}</Badge></div>
                {appliance.location && <p className="mt-1 text-xs text-slate-500">Local: {appliance.location}</p>}
                {appliance.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{appliance.description}</p>}
              </div>
              {isAdmin && <div className="flex items-center gap-1">
                <button type="button" onClick={() => { setEditingAppliance(appliance); setApplianceFormOpen(true); }} className="rounded-lg p-2 text-slate-400 hover:bg-sky-50 hover:text-sky-600" aria-label={`Editar ${appliance.name}`}><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => void setApplianceActive(appliance, !appliance.is_active)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">{appliance.is_active ? 'Inativar' : 'Reativar'}</button>
              </div>}
            </div>)}
          </div>}
        </section>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-sky-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Total Serviços</p>
            <p className="font-bold text-sky-700">{formatCurrency(totalServices)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Pago</p>
            <p className="font-bold text-green-700">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Pendente</p>
            <p className="font-bold text-yellow-700">{formatCurrency(totalPending)}</p>
          </div>
        </div>

        <div>
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Wrench className="w-5 h-5" /> Serviços Realizados
          </h3>
          {detailError ? <ErrorState message={detailError}/> : loading ? (
            <LoadingSpinner label="Carregando serviços..." />
          ) : services.length === 0 ? (
            <EmptyState icon={Wrench} title="Nenhum serviço registrado" />
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {services.map((s) => (
                <div key={s.id} className="border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-slate-900">#{s.number} - {formatDate(s.service_date)}</p>
                      <p className="text-sm text-slate-500">{s.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={s.status === 'cancelado' ? 'gray' : s.status === 'rascunho' ? 'blue' : 'green'}>
                        {s.status === 'rascunho' ? 'Rascunho' : s.status === 'confirmado' ? 'Confirmado' : 'Cancelado'}
                      </Badge>
                      {s.status === 'confirmado' && (
                        <Badge color={s.payment_status === 'pago' ? 'green' : 'yellow'}>
                          {s.payment_status === 'pago' ? 'Pago' : 'Pendente'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {s.appliances?.length ? <div className="mt-3 space-y-2">
                    {s.appliances.map(appliance => <div key={appliance.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                      <p className="font-semibold text-slate-700">{appliance.client_appliance?.name ?? `Ar-condicionado ${appliance.appliance_number}`}</p>
                      {appliance.client_appliance?.location && <p className="text-slate-500">Local: {appliance.client_appliance.location}</p>}
                      {appliance.notes && <p className="mt-1 whitespace-pre-wrap text-slate-500">{appliance.notes}</p>}
                      {appliance.performed.map(task => <div key={task.id} className="flex justify-between gap-2 pl-2 text-slate-600"><span>{task.name_snapshot}</span><span>{formatCurrency(task.unit_price)}</span></div>)}
                      {s.materials?.filter(m=>m.appliance_id===appliance.id).map(m=><div key={m.id} className="flex justify-between gap-2 pl-2 text-slate-600"><span>{m.product?.name ?? 'Produto'} · {formatNumber(m.quantity)} × {formatCurrency(m.unit_price)}</span><span>{formatCurrency(m.subtotal)}</span></div>)}
                    </div>)}
                  </div> : s.materials?.length ? <div className="mt-2 text-xs">{s.materials.map(m=><div key={m.id} className="flex justify-between text-slate-600 pl-3"><span>{m.product?.name ?? 'Produto'} - {formatNumber(m.quantity)}x</span><span>{formatCurrency(m.subtotal)}</span></div>)}</div> : null}
                  <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-sm">
                    <span className="text-slate-500">
                      Serviços: {formatCurrency(s.labor_value)}
                      {s.discount > 0 && ` - Desconto: ${formatCurrency(s.discount)}`}
                    </span>
                    <span className="font-bold text-slate-900">{formatCurrency(s.total_value)}</span>
                  </div>
                  {s.payment_status === 'pago' && s.payment_date && (
                    <p className="text-xs text-green-600 mt-1">
                      Pago em {formatDate(s.payment_date)} via {paymentMethodLabels[s.payment_method ?? ''] ?? s.payment_method}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
    {applianceFormOpen && <ClientApplianceForm
      appliance={editingAppliance}
      onClose={() => { setApplianceFormOpen(false); setEditingAppliance(null); }}
      onSave={saveAppliance}
    />}
    </>
  );
}

function ClientApplianceForm({ appliance, onClose, onSave }: {
  appliance: ClientAppliance | null;
  onClose: () => void;
  onSave: (data: Pick<ClientAppliance, 'name' | 'location' | 'description'>) => Promise<void>;
}) {
  const [name, setName] = useState(appliance?.name ?? '');
  const [location, setLocation] = useState(appliance?.location ?? '');
  const [description, setDescription] = useState(appliance?.description ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { dialogAlert('Informe o nome do aparelho.'); return; }
    setSaving(true);
    await onSave({ name: name.trim(), location: location.trim(), description: description.trim() });
    setSaving(false);
  }

  return <Modal open title={appliance ? 'Editar aparelho' : 'Novo aparelho'} onClose={() => { if (!saving) onClose(); }} size="sm">
    <form onSubmit={submit} className="space-y-4">
      <Input label="Nome *" value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Ar-condicionado Sala" required />
      <Input label="Local" value={location} onChange={event => setLocation(event.target.value)} placeholder="Ex.: Sala" />
      <Textarea label="Descrição" value={description} onChange={event => setDescription(event.target.value)} />
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button></div>
    </form>
  </Modal>;
}
