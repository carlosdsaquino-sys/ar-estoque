import { useCallback, useEffect, useState } from 'react';
import { Banknote, CalendarDays, CheckCircle2, Clock3, Eye, Minus, Plus, RefreshCw, Wallet } from 'lucide-react';
import { dialogAlert, dialogConfirm } from '@/components/DialogProvider';
import { Badge, Button, EmptyState, ErrorState, Input, LoadingSpinner, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabels } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type PaymentMethod = 'dinheiro' | 'pix' | 'cartao' | 'transferencia' | 'outro';
type MovementType = 'entrada' | 'saida' | 'ajuste';
type CashMovement = {
  id: string;
  type: MovementType;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  source: 'manual' | 'service_payment' | 'payment_reversal';
  service_id: string | null;
  service_number: number | null;
  reason: string | null;
  created_by_name: string;
  created_at: string;
};
type CashRegister = {
  id: string;
  register_date: string;
  status: 'aberto' | 'fechado';
  opening_balance: number;
  opening_user_name: string;
  opened_at: string;
  closing_balance: number | null;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  closing_reason: string | null;
  closed_by_name: string;
  closed_at: string | null;
  income: number;
  outgoing: number;
  adjustment: number;
  expected_balance: number;
  expected_cash_live: number;
  method_totals: Record<PaymentMethod, number>;
  movements: CashMovement[];
};
type CashHistoryEntry = Pick<CashRegister,
  'id' | 'register_date' | 'status' | 'opening_balance' | 'closing_balance' | 'expected_cash' |
  'counted_cash' | 'difference' | 'closing_reason' | 'opened_at' | 'opening_user_name' |
  'closed_by_name' | 'closed_at' | 'income' | 'outgoing' | 'adjustment'>;

const paymentMethods = Object.entries(paymentMethodLabels) as [PaymentMethod, string][];
const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function parseAmount(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
  return Number(normalized);
}

function movementOrigin(movement: CashMovement): string {
  if (movement.source === 'service_payment') return movement.service_number ? `Serviço #${movement.service_number}` : 'Pagamento de serviço';
  if (movement.source === 'payment_reversal') return `Estorno${movement.service_number ? ` · Serviço #${movement.service_number}` : ''}`;
  return movement.type === 'ajuste' ? 'Ajuste manual' : 'Manual';
}

function timeOnly(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function businessToday(): string {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export default function Cash() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [history, setHistory] = useState<CashHistoryEntry[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [movementType, setMovementType] = useState<MovementType | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [historyDetails, setHistoryDetails] = useState<CashRegister | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [snapshot, historyResult] = await Promise.all([
        supabase.rpc('cash_register_snapshot', { p_cash_register_id: null }),
        supabase.rpc('cash_register_history', { p_limit: 91, p_before: null }),
      ]);
      if (snapshot.error) throw snapshot.error;
      if (historyResult.error) throw historyResult.error;
      setRegister(snapshot.data as unknown as CashRegister | null);
      const historyRows = (historyResult.data ?? []) as unknown as CashHistoryEntry[];
      setHistory(historyRows.slice(0, 90));
      setHasMoreHistory(historyRows.length > 90);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitOpen(date: string, openingBalance: number) {
    const { error: openError } = await supabase.rpc('open_cash_register', {
      p_register_date: date,
      p_opening_balance: openingBalance,
    });
    if (openError) { dialogAlert(openError.message); return false; }
    setShowOpenModal(false);
    await load(true);
    return true;
  }

  async function submitMovement(type: MovementType, description: string, amount: number, method: PaymentMethod, reason: string) {
    if (!register) return false;
    const { error: movementError } = await supabase.rpc('record_cash_movement', {
      p_cash_register_id: register.id,
      p_type: type,
      p_description: description,
      p_amount: amount,
      p_payment_method: method,
      p_reason: reason || null,
    });
    if (movementError) { dialogAlert(movementError.message); return false; }
    setMovementType(null);
    await load(true);
    return true;
  }

  async function submitClose(countedCash: number, reason: string) {
    if (!register) return false;
    const { error: closeError } = await supabase.rpc('close_cash_register', {
      p_cash_register_id: register.id,
      p_counted_cash: countedCash,
      p_reason: reason || null,
    });
    if (closeError) { dialogAlert(closeError.message); return false; }
    setShowCloseModal(false);
    await load(true);
    return true;
  }

  async function openHistory(entry: CashHistoryEntry) {
    const { data, error: detailError } = await supabase.rpc('cash_register_snapshot', { p_cash_register_id: entry.id });
    if (detailError) { dialogAlert(detailError.message); return; }
    setHistoryDetails(data as unknown as CashRegister);
  }

  async function loadMoreHistory() {
    const cursor = history[history.length - 1]?.register_date;
    if (!cursor || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    const { data, error: historyError } = await supabase.rpc('cash_register_history', { p_limit: 91, p_before: cursor });
    if (historyError) dialogAlert(historyError.message);
    else {
      const rows = (data ?? []) as unknown as CashHistoryEntry[];
      setHistory(current => [...current, ...rows.slice(0, 90)]);
      setHasMoreHistory(rows.length > 90);
    }
    setLoadingMoreHistory(false);
  }

  if (loading) return <LoadingSpinner label="Carregando caixa..." />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Caixa" subtitle="Acompanhe entradas, saídas e conferência diária">
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </PageHeader>

      {register ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-sky-100 p-2.5 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"><Wallet className="h-5 w-5" /></span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Caixa de {formatDate(register.register_date)}</h2>
                    <Badge color="green">Aberto</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Aberto por {register.opening_user_name} às {timeOnly(register.opened_at)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setMovementType('entrada')}><Plus className="h-4 w-4" /> Entrada</Button>
                <Button size="sm" variant="secondary" onClick={() => setMovementType('saida')}><Minus className="h-4 w-4" /> Saída</Button>
                {isAdmin && <Button size="sm" variant="secondary" onClick={() => setMovementType('ajuste')}>Ajuste</Button>}
                <Button size="sm" variant="success" onClick={() => setShowCloseModal(true)}><CheckCircle2 className="h-4 w-4" /> Fechar caixa</Button>
              </div>
            </div>
          </section>

          <section aria-label="Resumo financeiro" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Saldo inicial" amount={register.opening_balance} icon={<Wallet className="h-4 w-4" />} />
            <SummaryCard label="Entradas" amount={register.income} tone="green" icon={<Plus className="h-4 w-4" />} />
            <SummaryCard label="Saídas" amount={register.outgoing} tone="red" icon={<Minus className="h-4 w-4" />} />
            <SummaryCard label="Saldo esperado total" amount={register.expected_balance} tone="blue" icon={<Banknote className="h-4 w-4" />} />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Valores por forma de pagamento</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">O saldo inicial integra o dinheiro físico.</p>
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Dinheiro esperado: <span className="text-slate-950 dark:text-white">{formatCurrency(register.expected_cash_live)}</span></p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {paymentMethods.map(([method, label]) => <SummaryCard key={method} label={label} amount={register.method_totals?.[method] ?? 0} compact />)}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-5">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Movimentações do dia</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Ajuste líquido: {formatCurrency(register.adjustment)}</p>
              </div>
              <span className="text-sm text-slate-500 dark:text-slate-400">{register.movements.length} registros</span>
            </div>
            {register.movements.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Nenhuma movimentação" description="Os pagamentos de serviços e os lançamentos manuais aparecerão aqui." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>
                    <th className="px-4 py-3 text-left font-medium">Horário</th><th className="px-4 py-3 text-left font-medium">Descrição</th>
                    <th className="px-4 py-3 text-left font-medium">Origem</th><th className="px-4 py-3 text-right font-medium">Entrada</th>
                    <th className="px-4 py-3 text-right font-medium">Saída</th><th className="px-4 py-3 text-left font-medium">Forma</th>
                    <th className="px-4 py-3 text-left font-medium">Usuário</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {register.movements.map(movement => <MovementRow key={movement.id} movement={movement} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8">
          <div className="mx-auto max-w-lg text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"><Wallet className="h-6 w-6" /></span>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Nenhum caixa aberto</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Abra o caixa de hoje e informe o dinheiro físico que já existe antes das movimentações.</p>
            <div className="mt-5 flex justify-center"><Button onClick={() => setShowOpenModal(true)}><Plus className="h-4 w-4" /> Abrir caixa de hoje</Button></div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-5">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Histórico de caixas</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Caixas fechados não podem ser alterados ou reabertos.</p>
        </div>
        {history.length === 0 ? (
          <EmptyState icon={Clock3} title="Nenhum caixa fechado" description="Quando um caixa for fechado, ele ficará disponível neste histórico." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>
                <th className="px-4 py-3 text-left font-medium">Data</th><th className="px-4 py-3 text-right font-medium">Saldo inicial</th>
                <th className="px-4 py-3 text-right font-medium">Entradas</th><th className="px-4 py-3 text-right font-medium">Saídas</th>
                <th className="px-4 py-3 text-right font-medium">Saldo final</th><th className="px-4 py-3 text-right font-medium">Diferença</th>
                <th className="px-4 py-3 text-left font-medium">Fechado por</th><th className="px-4 py-3 text-center font-medium">Status</th><th className="px-4 py-3" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.map(entry => <tr key={entry.id} className="text-slate-700 dark:text-slate-300">
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(entry.register_date)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(entry.opening_balance)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-green-700 dark:text-green-400">{formatCurrency(entry.income)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-red-700 dark:text-red-400">{formatCurrency(entry.outgoing)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium">{formatCurrency(entry.closing_balance ?? 0)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${(entry.difference ?? 0) === 0 ? '' : 'text-amber-700 dark:text-amber-400'}`}>{formatCurrency(entry.difference ?? 0)}</td>
                  <td className="px-4 py-3">{entry.closed_by_name || '—'}</td>
                  <td className="px-4 py-3 text-center"><Badge color="gray">Fechado</Badge></td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => void openHistory(entry)} className="rounded-lg p-2 text-slate-500 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-sky-950/40 dark:hover:text-sky-300" aria-label={`Ver caixa de ${formatDate(entry.register_date)}`} title="Consultar movimentações"><Eye className="h-4 w-4" /></button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
        {hasMoreHistory && <div className="flex justify-center border-t border-slate-200 p-4 dark:border-slate-700"><Button variant="secondary" onClick={() => void loadMoreHistory()} disabled={loadingMoreHistory}>{loadingMoreHistory ? 'Carregando...' : 'Carregar caixas anteriores'}</Button></div>}
      </section>

      {showOpenModal && <OpenRegisterModal onClose={() => setShowOpenModal(false)} onSubmit={submitOpen} />}
      {movementType && <MovementModal type={movementType} canAdjust={isAdmin} onClose={() => setMovementType(null)} onSubmit={submitMovement} />}
      {showCloseModal && register && <CloseRegisterModal register={register} onClose={() => setShowCloseModal(false)} onSubmit={submitClose} />}
      {historyDetails && <RegisterDetailsModal register={historyDetails} onClose={() => setHistoryDetails(null)} />}
    </div>
  );
}

function SummaryCard({ label, amount, icon, tone = 'default', compact = false }: { label: string; amount: number; icon?: React.ReactNode; tone?: 'default' | 'green' | 'red' | 'blue'; compact?: boolean }) {
  const amountTone = {
    default: 'text-slate-900 dark:text-slate-100', green: 'text-green-700 dark:text-green-400',
    red: 'text-red-700 dark:text-red-400', blue: 'text-sky-700 dark:text-sky-300',
  }[tone];
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400"><span>{label}</span>{icon && <span className="text-slate-400">{icon}</span>}</div>
      <p className={`mt-2 font-semibold tabular-nums ${compact ? 'text-lg' : 'text-xl'} ${amountTone}`}>{formatCurrency(amount)}</p>
    </div>
  );
}

function MovementRow({ movement }: { movement: CashMovement }) {
  const incoming = movement.amount > 0 && movement.type !== 'ajuste';
  const outgoing = movement.amount < 0 && movement.type !== 'ajuste';
  return (
    <tr className="text-slate-700 dark:text-slate-300">
      <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{timeOnly(movement.created_at)}</td>
      <td className="px-4 py-3"><p className="font-medium text-slate-900 dark:text-slate-100">{movement.description}</p>{movement.reason && <p className="text-xs text-slate-500 dark:text-slate-400">Motivo: {movement.reason}</p>}</td>
      <td className="whitespace-nowrap px-4 py-3">{movementOrigin(movement)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-green-700 dark:text-green-400">{incoming ? `+ ${formatCurrency(movement.amount)}` : movement.type === 'ajuste' && movement.amount > 0 ? `+ ${formatCurrency(movement.amount)}` : '—'}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-red-700 dark:text-red-400">{outgoing ? formatCurrency(Math.abs(movement.amount)) : movement.type === 'ajuste' && movement.amount < 0 ? formatCurrency(Math.abs(movement.amount)) : '—'}</td>
      <td className="whitespace-nowrap px-4 py-3">{paymentMethodLabels[movement.payment_method]}</td>
      <td className="whitespace-nowrap px-4 py-3">{movement.created_by_name}</td>
    </tr>
  );
}

function OpenRegisterModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (date: string, balance: number) => Promise<boolean> }) {
  const [balance, setBalance] = useState('0,00');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = parseAmount(balance);
    if (!Number.isFinite(amount) || amount < 0) { dialogAlert('Informe um saldo inicial válido, igual ou maior que zero.'); return; }
    setSaving(true);
    if (!await onSubmit(businessToday(), amount)) setSaving(false);
  }
  return <Modal open onClose={onClose} title="Abrir caixa" size="sm">
    <form onSubmit={submit} className="space-y-4">
      <Input label="Data" type="date" value={businessToday()} readOnly className={fieldClass} />
      <Input label="Saldo inicial em dinheiro (R$)" inputMode="decimal" value={balance} onChange={event => setBalance(event.target.value)} className={fieldClass} />
      <p className="text-xs text-slate-500 dark:text-slate-400">Informe o valor físico que já está no caixa. Será permitido apenas um caixa aberto por vez.</p>
      <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Abrindo...' : 'Abrir caixa'}</Button></div>
    </form>
  </Modal>;
}

function MovementModal({ type, canAdjust, onClose, onSubmit }: { type: MovementType; canAdjust: boolean; onClose: () => void; onSubmit: (type: MovementType, description: string, amount: number, method: PaymentMethod, reason: string) => Promise<boolean> }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const title = type === 'entrada' ? 'Registrar entrada' : type === 'saida' ? 'Registrar saída' : 'Ajustar caixa';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(amount);
    if (!description.trim() || !Number.isFinite(parsed) || parsed === 0 || (type !== 'ajuste' && parsed < 0)) {
      dialogAlert(type === 'ajuste' ? 'Informe uma descrição e um valor de ajuste diferente de zero.' : 'Informe uma descrição e um valor maior que zero.');
      return;
    }
    if (type === 'ajuste' && (!canAdjust || !reason.trim())) { dialogAlert('Ajustes exigem permissão de administrador e motivo.'); return; }
    setSaving(true);
    if (!await onSubmit(type, description.trim(), parsed, method, reason.trim())) setSaving(false);
  }
  return <Modal open onClose={onClose} title={title} size="sm">
    <form onSubmit={submit} className="space-y-4">
      {type === 'ajuste' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Valor positivo acrescenta saldo; valor negativo reduz o saldo. O ajuste fica registrado no histórico.</div>}
      <Input label="Descrição *" value={description} onChange={event => setDescription(event.target.value)} required maxLength={200} placeholder={type === 'saida' ? 'Ex.: Combustível' : type === 'entrada' ? 'Ex.: Troco recebido' : 'Ex.: Correção de saldo'} className={fieldClass} />
      <Input label={type === 'ajuste' ? 'Valor do ajuste (R$)' : 'Valor (R$)'} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required className={fieldClass} />
      <Select label="Forma de pagamento" value={method} onChange={event => setMethod(event.target.value as PaymentMethod)} className={fieldClass}>
        {paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      {type === 'ajuste' && <Textarea label="Motivo *" value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} placeholder="Explique a correção realizada" className={fieldClass} />}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</Button></div>
    </form>
  </Modal>;
}

function CloseRegisterModal({ register, onClose, onSubmit }: { register: CashRegister; onClose: () => void; onSubmit: (counted: number, reason: string) => Promise<boolean> }) {
  const [counted, setCounted] = useState(String(register.expected_cash_live.toFixed(2)).replace('.', ','));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const countedValue = parseAmount(counted);
  const difference = Number.isFinite(countedValue) ? Math.round((countedValue - register.expected_cash_live) * 100) / 100 : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(countedValue) || countedValue < 0) { dialogAlert('Informe um valor contado válido, igual ou maior que zero.'); return; }
    if (difference !== 0 && !reason.trim()) { dialogAlert('Informe o motivo da diferença do caixa.'); return; }
    const confirmed = await dialogConfirm(
      `Saldo esperado total: ${formatCurrency(register.expected_balance)}\nDinheiro esperado: ${formatCurrency(register.expected_cash_live)}\nDinheiro contado: ${formatCurrency(countedValue)}\nDiferença: ${formatCurrency(difference ?? 0)}${reason.trim() ? `\nMotivo: ${reason.trim()}` : ''}\n\nDepois de fechado, este caixa não poderá ser alterado ou reaberto.`,
      { title: 'Confirmar fechamento do caixa?', confirmLabel: 'Fechar caixa', cancelLabel: 'Voltar', destructive: true },
    );
    if (!confirmed) return;
    setSaving(true);
    if (!await onSubmit(countedValue, reason.trim())) setSaving(false);
  }
  return <Modal open onClose={onClose} title="Fechar caixa" size="md">
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Saldo inicial" amount={register.opening_balance} compact />
        <SummaryCard label="Entradas" amount={register.income} tone="green" compact />
        <SummaryCard label="Saídas" amount={register.outgoing} tone="red" compact />
        <SummaryCard label="Saldo total esperado" amount={register.expected_balance} tone="blue" compact />
      </div>
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
        <p className="text-slate-600 dark:text-slate-300">Dinheiro físico esperado</p><p className="text-lg font-semibold text-slate-950 dark:text-white">{formatCurrency(register.expected_cash_live)}</p>
      </div>
      <Input label="Dinheiro contado (R$)" inputMode="decimal" value={counted} onChange={event => setCounted(event.target.value)} required className={fieldClass} />
      <div className={`rounded-lg border p-3 text-sm ${difference === null || difference === 0 ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>
        <p className="font-medium">Diferença: {difference === null ? '—' : formatCurrency(difference)}</p>
        {difference === 0 ? <p className="mt-1">Caixa conferido. Nenhuma diferença encontrada.</p> : <p className="mt-1">Diferença = dinheiro contado − dinheiro esperado.</p>}
      </div>
      {difference !== null && difference !== 0 && <Textarea label="Motivo da diferença *" value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} placeholder="Descreva o motivo da diferença" className={fieldClass} />}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" variant="danger" disabled={saving}>{saving ? 'Fechando...' : 'Fechar caixa'}</Button></div>
    </form>
  </Modal>;
}

function RegisterDetailsModal({ register, onClose }: { register: CashRegister; onClose: () => void }) {
  return <Modal open onClose={onClose} title={`Caixa de ${formatDate(register.register_date)}`} size="xl">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
        <Badge color="gray">Fechado</Badge><span>Aberto por {register.opening_user_name}</span>
        {register.closed_at && <span>Fechado por {register.closed_by_name} em {formatDateTime(register.closed_at)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Saldo inicial" amount={register.opening_balance} compact />
        <SummaryCard label="Entradas" amount={register.income} tone="green" compact />
        <SummaryCard label="Saídas" amount={register.outgoing} tone="red" compact />
        <SummaryCard label="Saldo final" amount={register.closing_balance ?? 0} tone="blue" compact />
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700 sm:grid-cols-3">
        <p>Dinheiro esperado: <strong>{formatCurrency(register.expected_cash ?? 0)}</strong></p>
        <p>Dinheiro contado: <strong>{formatCurrency(register.counted_cash ?? 0)}</strong></p>
        <p>Diferença: <strong className={(register.difference ?? 0) === 0 ? '' : 'text-amber-700 dark:text-amber-400'}>{formatCurrency(register.difference ?? 0)}</strong></p>
        {register.closing_reason && <p className="sm:col-span-3">Motivo da diferença: {register.closing_reason}</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[650px] text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-3 py-2 text-left">Horário</th><th className="px-3 py-2 text-left">Descrição / origem</th><th className="px-3 py-2 text-left">Forma</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-left">Usuário</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{register.movements.map(m => <tr key={m.id} className="text-slate-700 dark:text-slate-300"><td className="whitespace-nowrap px-3 py-2">{timeOnly(m.created_at)}</td><td className="px-3 py-2">{m.description}<span className="ml-2 text-xs text-slate-500">{movementOrigin(m)}</span>{m.reason && <p className="text-xs text-slate-500">{m.reason}</p>}</td><td className="px-3 py-2">{paymentMethodLabels[m.payment_method]}</td><td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(m.amount)}</td><td className="px-3 py-2">{m.created_by_name}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </div>
  </Modal>;
}
