import { dialogAlert } from '@/components/DialogProvider';
import { allRows } from '@/lib/data';
import { operationId, dateBoundary } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, type Product, type Movement, type Client } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber, formatDateTime, movementTypeLabels, exportToCSV } from '@/lib/utils';
import {
  LoadingSpinner, ErrorState, EmptyState, PageHeader,
  Modal, Button, Input, Select, Textarea,
} from '@/components/ui';
import {
  ArrowLeftRight, Plus, Download, Undo2, ArrowDownCircle, ArrowUpCircle,
  Settings2,
} from 'lucide-react';

export default function Movements() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const request = useRef<{payload:string;id:string}|null>(null);
  const loadRevision = useRef(0);
  useEffect(() => () => { loadRevision.current++; }, []);
  const [movements, setMovements] = useState<(Movement & { product?: Product; client?: Client })[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showReversal, setShowReversal] = useState<Movement | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterResponsible, setFilterResponsible] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadMovements = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('movements')
        .select('*, product:products(*), client:clients(*)')
        .order('created_at', { ascending: false })
        .order('id');

      if (filterType) query = query.eq('type', filterType);
      if (filterProduct) query = query.eq('product_id', filterProduct);
      if (filterResponsible) query = query.ilike('responsible', `%${filterResponsible}%`);
      if (dateFrom) query = query.gte('created_at', dateBoundary(dateFrom));
      if (dateTo) query = query.lt('created_at', dateBoundary(dateTo, true));

      const data = await allRows(() => query);
      if (revision === loadRevision.current) setMovements(data as (Movement & { product?: Product; client?: Client })[]);
    } catch (err) {
      if (revision === loadRevision.current) setError(errorMessage(err));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [filterType, filterProduct, filterResponsible, dateFrom, dateTo]);

  useEffect(() => {
    loadMovements();
    supabase.from('products').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setProducts(data as Product[]);
    });
  }, [loadMovements]);

  function handleExport() {
    exportToCSV('movimentacoes.csv', [
      'Data', 'Tipo', 'Produto', 'Código', 'Quantidade', 'Custo Unit.',
      'Responsável', 'Observações', 'Cliente',
    ], movements.map((m) => [
      formatDateTime(m.created_at),
      movementTypeLabels[m.type] ?? m.type,
      m.product?.name ?? '',
      m.product?.code ?? '',
      formatNumber(m.quantity),
      formatCurrency(m.unit_cost),
      m.responsible,
      m.notes,
      m.client?.name ?? '',
    ]));
  }

  async function handleSave(data: {
    product_id: string;
    type: 'entrada' | 'saida' | 'ajuste';
    quantity: number;
    unit_cost: number;
    notes: string;
  }) {
    const { error } = await supabase.rpc('register_movement', {
      p_product_id: data.product_id,
      p_type: data.type,
      p_quantity: data.quantity,
      p_unit_cost: data.unit_cost,
      p_notes: data.notes,
      p_request_id: operationId(request,data),
    });
    if (error) {
      dialogAlert('Erro: ' + error.message);
      return false;
    }
    request.current = null;
    setShowForm(false);
    loadMovements();
    return true;
  }

  async function handleReversal(movement: Movement, reason: string) {
    const { error } = await supabase.rpc('reverse_movement', {
      p_movement_id: movement.id,
      p_reason: reason,
    });
    if (error) {
      dialogAlert('Erro: ' + error.message);
      return;
    }
    setShowReversal(null);
    loadMovements();
  }

  if (loading && movements.length === 0) return <LoadingSpinner label="Carregando movimentações..." />;
  if (error) return <ErrorState message={error} onRetry={loadMovements} />;

  return (
    <div>
      <PageHeader title="Movimentações" subtitle="Entradas, saídas, ajustes e estornos">
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Nova Movimentação
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Todos tipos</option>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
            <option value="ajuste">Ajuste</option>
            <option value="estorno">Estorno</option>
            <option value="saldo_inicial">Saldo Inicial</option>
          </Select>
          <Select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
            <option value="">Todos produtos</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input
            placeholder="Responsável"
            value={filterResponsible}
            onChange={(e) => setFilterResponsible(e.target.value)}
          />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {movements.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="Nenhuma movimentação encontrada" description="Registre uma entrada, saída ou ajuste" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Data</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium">Produto</th>
                <th className="text-right px-4 py-3 font-medium">Qtd.</th>
                <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Custo</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Resp.</th>
                <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Observações</th>
                <th className="text-center px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map((m) => {
                const isPositive = m.quantity > 0;
                const canReverse = isAdmin && !m.service_id && m.type !== 'estorno' && !m.reversal_of && !movements.some(r => r.reversal_of === m.id);
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isPositive
                          ? <ArrowDownCircle className="w-4 h-4 text-green-600" />
                          : <ArrowUpCircle className="w-4 h-4 text-red-600" />}
                        <span className="text-xs font-medium">{movementTypeLabels[m.type] ?? m.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{m.product?.name ?? 'Produto'}</p>
                      <p className="text-xs text-slate-400">{m.product?.code}</p>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{formatNumber(m.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell text-slate-600">{formatCurrency(m.unit_cost)}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-600 text-xs">{m.responsible || '-'}</td>
                    <td className="px-4 py-3 hidden xl:table-cell text-slate-500 text-xs max-w-xs truncate">{m.notes || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {canReverse && (
                        <button
                          onClick={() => setShowReversal(m)}
                          className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                          title="Estornar"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <MovementForm
          products={products}
          isAdmin={isAdmin}
          responsibleName={profile?.name ?? ''}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
        />
      )}

      {showReversal && (
        <ReversalModal
          movement={showReversal}
          productName={showReversal.product?.name ?? ''}
          onConfirm={(reason) => handleReversal(showReversal, reason)}
          onClose={() => setShowReversal(null)}
        />
      )}
    </div>
  );
}

// Keep the typed text (including an empty field or a trailing decimal separator).
// Convert only when submitting; accept either comma or dot without grouping separators.
function parseDecimalInput(value: string): number {
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

function MovementForm({
  products, isAdmin, responsibleName, onSave, onClose,
}: {
  products: Product[];
  isAdmin: boolean;
  responsibleName: string;
  onSave: (data: { product_id: string; type: 'entrada' | 'saida' | 'ajuste'; quantity: number; unit_cost: number; notes: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    product_id: '',
    type: 'entrada' as 'entrada' | 'saida' | 'ajuste',
    quantity: '1',
    unit_cost: '0',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (form.product_id) {
      supabase.rpc('get_product_balance', { p_product_id: form.product_id }).then(({ data, error }) => {
        if (error) { setBalance(null); dialogAlert(error.message); return; }
        setBalance((data as number) ?? 0);
      });
      const product = products.find((p) => p.id === form.product_id);
      if (product && form.type === 'entrada') {
        setForm((f) => ({ ...f, unit_cost: String(product.unit_cost) }));
      }
    }
  }, [form.product_id, form.type, products]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const quantity = parseDecimalInput(form.quantity);
    const unitCost = form.unit_cost.trim() === '' ? 0 : parseDecimalInput(form.unit_cost);
    if (!form.product_id || !Number.isFinite(quantity) || quantity === 0 || (form.type !== 'ajuste' && quantity < 0)) {
      dialogAlert('Selecione um produto e informe a quantidade');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      dialogAlert('Informe um custo válido, igual ou maior que zero.');
      return;
    }
    if (form.type === 'ajuste' && !form.notes.trim()) {
      dialogAlert('Justificativa é obrigatória para ajustes');
      return;
    }
    if (form.type === 'saida' && balance !== null && quantity > balance) {
      dialogAlert(`Saldo insuficiente. Disponível: ${balance}`);
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, quantity, unit_cost: unitCost });
    } catch (err) {
      dialogAlert(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const typeOptions = [
    { value: 'entrada', label: 'Entrada', icon: ArrowDownCircle, color: 'text-green-600' },
    { value: 'saida', label: 'Saída', icon: ArrowUpCircle, color: 'text-red-600' },
  ];
  if (isAdmin) {
    typeOptions.push({ value: 'ajuste', label: 'Ajuste', icon: Settings2, color: 'text-orange-600' });
  }

  return (
    <Modal open={true} onClose={onClose} title="Nova Movimentação" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Tipo</label>
          <div className="grid grid-cols-3 gap-2">
            {typeOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, type: opt.value as 'entrada' | 'saida' | 'ajuste' })}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors ${
                    form.type === opt.value
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${opt.color}`} />
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Select label="Produto *" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} required>
          <option value="">Selecione...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
        </Select>

        {balance !== null && form.product_id && (
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <span className="text-slate-500">Saldo atual: </span>
            <span className="font-medium text-slate-900">{formatNumber(balance)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label={form.type === 'ajuste' ? 'Ajuste (+ adiciona / − retira) *' : 'Quantidade *'}
            type="text"
            inputMode={form.type === 'ajuste' ? 'text' : 'decimal'}
            placeholder="Ex.: 2,5"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            required
          />
          <Input
            label="Custo Unitário (R$)"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
          />
        </div>

        <Input label="Responsável · Usuário atual" value={responsibleName} readOnly aria-readonly="true" />

        <Textarea
          label={form.type === 'ajuste' ? 'Justificativa *' : 'Observações'}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder={form.type === 'ajuste' ? 'Justifique o ajuste' : 'Observações adicionais'}
          required={form.type === 'ajuste'}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReversalModal({
  productName, onConfirm, onClose,
}: {
  movement: Movement;
  productName: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={true} onClose={onClose} title="Estornar Movimentação" size="sm">
      <div className="space-y-4">
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
          <p className="text-sm text-orange-800">
            Você está estornando a movimentação de <strong>{productName}</strong>.
            Isso criará um registro de estorno vinculado, preservando o histórico.
          </p>
        </div>
        <Textarea
          label="Motivo do estorno *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva o motivo do estorno"
          required
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={() => reason.trim() && onConfirm(reason)} disabled={!reason.trim()}>
            Confirmar Estorno
          </Button>
        </div>
      </div>
    </Modal>
  );
}
