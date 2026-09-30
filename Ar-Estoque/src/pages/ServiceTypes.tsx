import { dialogAlert, dialogConfirm } from '@/components/DialogProvider';
import { useCallback, useEffect, useState } from 'react';
import { supabase, type ServiceType } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, formatCurrency } from '@/lib/utils';
import { Badge, Button, EmptyState, ErrorState, Input, LoadingSpinner, Modal, PageHeader, Textarea } from '@/components/ui';
import { Wrench, Plus, Pencil, Power, Trash2 } from 'lucide-react';

export default function ServiceTypes() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceType | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const typeResult = await supabase.from('service_types').select('*').order('name');
      if (typeResult.error) throw typeResult.error;
      setTypes((typeResult.data ?? []) as ServiceType[]);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleActive(type: ServiceType) {
    await setActive(type, !type.is_active);
  }

  async function setActive(type: ServiceType, isActive: boolean) {
    const { error: updateError } = await supabase.from('service_types').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', type.id);
    if (updateError) { dialogAlert('Erro: ' + updateError.message); return; }
    await load();
  }

  async function deleteType(type: ServiceType) {
    const confirmed = await dialogConfirm(
      `ATENÇÃO: esta ação é irreversível.\n\nEste tipo de serviço já pode estar associado a atendimentos existentes.\n\nO cadastro do tipo de serviço será excluído permanentemente.\n\nO histórico dos atendimentos que já utilizaram este serviço será preservado.\n\nTipo: "${type.name}"\n\nEsta ação não pode ser desfeita.`,
      { title: 'Excluir tipo de serviço permanentemente?', confirmLabel: 'Excluir permanentemente', cancelLabel: 'Cancelar', destructive: true }
    );
    if (!confirmed) return;

    const { error: deleteError } = await supabase.rpc('delete_service_type', { p_service_type_id: type.id });
    if (deleteError) {
      dialogAlert('Não foi possível excluir o tipo de serviço: ' + deleteError.message);
      return;
    }

    await load();
    dialogAlert('Tipo de serviço excluído permanentemente.');
  }

  if (loading) return <LoadingSpinner label="Carregando tipos de serviço..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <PageHeader title="Tipos de serviço" subtitle={`${types.filter(type => type.is_active).length} tipos ativos`}>
        {isAdmin && <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="h-4 w-4" /> Novo tipo</Button>}
      </PageHeader>
      {types.length === 0 ? (
        <EmptyState icon={Wrench} title="Nenhum tipo de serviço cadastrado" description="Cadastre tipos para selecioná-los nos atendimentos." />
      ) : (
        <div className="space-y-3">
          {types.map(type => (
            <div key={type.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">{type.name}</p>
                  <Badge color={type.is_active ? 'green' : 'gray'}>{type.is_active ? 'Ativo' : 'Inativo'}</Badge>
                </div>
                {type.description && <p className="mt-1 text-sm text-slate-500">{type.description}</p>}
                {type.maintenance_enabled && <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">Manutenção recorrente a cada {type.maintenance_interval_months} meses · aviso {type.maintenance_alert_days} dias antes</p>}
              </div>
              <p className="text-sm font-semibold text-slate-700">Padrão: {formatCurrency(type.default_price)}</p>
              {isAdmin && <div className="flex items-center gap-1">
                <button type="button" onClick={() => { setEditing(type); setShowForm(true); }} className="rounded-lg p-2 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600" aria-label={`Editar ${type.name}`} title="Editar"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => void toggleActive(type)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label={type.is_active ? `Inativar ${type.name}` : `Ativar ${type.name}`} title={type.is_active ? 'Inativar' : 'Ativar'}><Power className="h-4 w-4" /></button>
                <button type="button" onClick={() => void deleteType(type)} className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`Excluir ${type.name}`} title="Excluir"><Trash2 className="h-4 w-4" /></button>
              </div>}
            </div>
          ))}
        </div>
      )}
      {showForm && <ServiceTypeForm key={editing?.id ?? 'new'} type={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); void load(); }} />}
    </div>
  );
}

function ServiceTypeForm({ type, onClose, onSaved }: { type: ServiceType | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(type?.name ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [price, setPrice] = useState(String(type?.default_price ?? 0));
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(type?.maintenance_enabled ?? false);
  const [maintenanceInterval, setMaintenanceInterval] = useState(String(type?.maintenance_interval_months ?? ''));
  const [maintenanceAlertDays, setMaintenanceAlertDays] = useState(String(type?.maintenance_alert_days ?? 14));
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedPrice = price.trim() === '' ? NaN : Number(price.trim().replace(',', '.'));
    if (!name.trim() || !Number.isFinite(normalizedPrice) || normalizedPrice < 0) { dialogAlert('Informe nome e preço padrão válidos.'); return; }
    const interval = Number(maintenanceInterval);
    const alertDays = Number(maintenanceAlertDays);
    if (maintenanceEnabled && (!Number.isInteger(interval) || interval < 1 || !Number.isInteger(alertDays) || alertDays < 0)) {
      dialogAlert('Informe um intervalo de pelo menos 1 mês e uma antecedência de 0 dias ou mais.');
      return;
    }
    setSaving(true);
    const values = {
      name: name.trim(), description: description.trim(), default_price: normalizedPrice,
      maintenance_enabled: maintenanceEnabled,
      maintenance_interval_months: maintenanceEnabled ? interval : null,
      maintenance_alert_days: maintenanceEnabled ? alertDays : 14,
      updated_at: new Date().toISOString(),
    };
    const result = type
      ? await supabase.from('service_types').update(values).eq('id', type.id)
      : await supabase.from('service_types').insert(values);
    setSaving(false);
    if (result.error) { dialogAlert(result.error.code === '23505' ? 'Já existe um tipo de serviço com esse nome.' : 'Erro: ' + result.error.message); return; }
    onSaved();
  }

  return <Modal open onClose={onClose} title={type ? 'Editar tipo de serviço' : 'Novo tipo de serviço'} size="md">
    <form onSubmit={submit} className="space-y-4">
      <Input label="Nome *" value={name} onChange={event => setName(event.target.value)} required placeholder="Ex.: Limpeza de ar-condicionado" />
      <Textarea label="Descrição" value={description} onChange={event => setDescription(event.target.value)} placeholder="Descrição opcional" />
      <Input label="Preço padrão (R$) *" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} required />
      <p className="text-xs text-slate-500">O preço padrão poderá ser ajustado para cada atendimento.</p>
      <section className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Manutenção preventiva</h3>
          <p className="mt-1 text-xs text-slate-500">Use esta configuração para serviços que precisam ser repetidos periodicamente.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={maintenanceEnabled} onChange={event => setMaintenanceEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
          Gera aviso de manutenção
        </label>
        {maintenanceEnabled && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Intervalo para nova manutenção (meses) *" type="number" min="1" step="1" value={maintenanceInterval} onChange={event => setMaintenanceInterval(event.target.value)} required />
          <Input label="Avisar com antecedência (dias) *" type="number" min="0" step="1" value={maintenanceAlertDays} onChange={event => setMaintenanceAlertDays(event.target.value)} required />
        </div>}
      </section>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button></div>
    </form>
  </Modal>;
}
