import { balances as loadBalances, allRows } from '@/lib/data';
import { todayLocal } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { supabase, type Product, type Movement, type Service } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber, movementTypeLabels } from '@/lib/utils';
import { LoadingSpinner, ErrorState, Badge } from '@/components/ui';
import {
  Package, DollarSign, AlertTriangle, CheckCircle, Wrench,
  TrendingUp, Wallet, Clock, ArrowDownCircle, ArrowUpCircle,
  RefreshCw,
} from 'lucide-react';

interface DashboardData {
  activeProducts: number;
  totalStockValue: number;
  buyCount: number;
  okCount: number;
  recentMovements: (Movement & { product?: Product })[];
  replenishmentProducts: (Product & { balance: number })[];
  confirmedServices: number;
  totalServicesValue: number;
  totalReceived: number;
  totalToReceive: number;
  pendingServices: Service[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, movementsRes, servicesRes] = await Promise.all([
        allRows(() => supabase.from('products').select('*, category:categories(*), unit:units(*)').eq('is_active', true).order('id')).then(data => ({data,error:null})),
        supabase.from('movements').select('*, product:products(*), client:clients(*), service:services(*)').order('created_at', { ascending: false }).limit(10),
        allRows(() => supabase.from('services').select('*, client:clients(*)').order('id')).then(data => ({data,error:null})),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (movementsRes.error) throw movementsRes.error;
      if (servicesRes.error) throw servicesRes.error;

      const products = productsRes.data as Product[];
      const movements = movementsRes.data as (Movement & { product?: Product })[];
      const services = servicesRes.data as Service[];

      const balances = await loadBalances();

      let totalStockValue = 0;
      let buyCount = 0;
      let okCount = 0;
      const replenishmentProducts: (Product & { balance: number })[] = [];

      for (const p of products) {
        const balance = balances[p.id] ?? 0;
        const stockValue = balance * (p.unit_cost || 0);
        totalStockValue += stockValue;
        if (balance <= (p.min_stock || 0)) {
          buyCount++;
          replenishmentProducts.push({ ...p, balance });
        } else {
          okCount++;
        }
      }

      // Service metrics
      const confirmedServices = services.filter((s) => s.status === 'confirmado');
      const now = new Date();
      const periodStart = todayLocal().slice(0,7) + '-01';
      const nextMonth = new Date(now.getFullYear(),now.getMonth()+1,1);
      const periodEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-01`;

      const servicesInPeriod = confirmedServices.filter((s) => s.service_date >= periodStart && s.service_date < periodEnd);
      const totalServicesValue = servicesInPeriod.reduce((sum, s) => sum + (s.total_value || 0), 0);

      const paidInPeriod = confirmedServices.filter(
        (s) => s.payment_status === 'pago' && s.payment_date && s.payment_date >= periodStart && s.payment_date < periodEnd
      );
      const totalReceived = paidInPeriod.reduce((sum, s) => sum + (s.total_value || 0), 0);

      const pendingPayment = confirmedServices.filter((s) => s.payment_status === 'pendente');
      const totalToReceive = pendingPayment.reduce((sum, s) => sum + (s.total_value || 0), 0);

      setData({
        activeProducts: products.length,
        totalStockValue,
        buyCount,
        okCount,
        recentMovements: movements,
        replenishmentProducts,
        confirmedServices: servicesInPeriod.length,
        totalServicesValue,
        totalReceived,
        totalToReceive,
        pendingServices: pendingPayment,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) return <LoadingSpinner label="Carregando dashboard..." />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Visão geral do estoque e serviços</p>
        </div>
        <button
          onClick={loadData}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          title="Atualizar"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Stock indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Package}
          label="Produtos Ativos"
          value={formatNumber(data.activeProducts, 0)}
          color="sky"
        />
        <StatCard
          icon={DollarSign}
          label="Valor em Estoque"
          value={formatCurrency(data.totalStockValue)}
          color="green"
        />
        <StatCard
          icon={AlertTriangle}
          label="Precisa Comprar"
          value={formatNumber(data.buyCount, 0)}
          color="red"
        />
        <StatCard
          icon={CheckCircle}
          label="Estoque OK"
          value={formatNumber(data.okCount, 0)}
          color="emerald"
        />
      </div>

      {/* Service indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Wrench}
          label="Serviços no Período"
          value={formatNumber(data.confirmedServices, 0)}
          color="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="Valor dos Serviços"
          value={formatCurrency(data.totalServicesValue)}
          color="sky"
        />
        <StatCard
          icon={Wallet}
          label="Valor Recebido"
          value={formatCurrency(data.totalReceived)}
          color="green"
        />
        <StatCard
          icon={Clock}
          label="A Receber"
          value={formatCurrency(data.totalToReceive)}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent movements */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-slate-900">Últimas Movimentações</h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {data.recentMovements.length === 0 ? (
              <p className="p-5 text-sm text-slate-400 text-center">Nenhuma movimentação registrada</p>
            ) : (
              data.recentMovements.map((m) => {
                const isEntrada = m.quantity > 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 p-4">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isEntrada ? 'bg-green-100' : 'bg-red-100'
                    }`}>
                      {isEntrada
                        ? <ArrowDownCircle className="w-5 h-5 text-green-600" />
                        : <ArrowUpCircle className="w-5 h-5 text-red-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {m.product?.name ?? 'Produto'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {movementTypeLabels[m.type] ?? m.type} - {formatNumber(Math.abs(m.quantity))} - {formatDate(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Replenishment list */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-slate-900">Produtos para Reposição</h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {data.replenishmentProducts.length === 0 ? (
              <p className="p-5 text-sm text-slate-400 text-center">Todos os produtos com estoque adequado</p>
            ) : (
              data.replenishmentProducts.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-slate-500">Código: {p.code}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="text-sm font-medium text-red-600">
                      Saldo: {formatNumber(p.balance)}
                    </p>
                    <p className="text-xs text-slate-400">
                      Mín: {formatNumber(p.min_stock)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Pending services */}
      {data.pendingServices.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mt-6">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-slate-900">Serviços Aguardando Pagamento</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {data.pendingServices.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    #{s.number} - {s.client?.name ?? 'Cliente'}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(s.service_date)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-900">{formatCurrency(s.total_value)}</span>
                  <Badge color="yellow">Pendente</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, color,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  color: 'sky' | 'green' | 'red' | 'emerald' | 'blue' | 'yellow';
}) {
  const colors = {
    sky: 'bg-sky-50 text-sky-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  };
  return (
    <div className="motion-card bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 truncate">{label}</p>
          <p className="text-lg font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
