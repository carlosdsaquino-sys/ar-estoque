import { allRows } from '@/lib/data';
import { balances as loadBalances } from '@/lib/data';
import { dateBoundary } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { calculateMaterialCost, summarizeConfirmedProfits } from '@/lib/profit';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, type Product, type Movement, type Service, type ServiceMaterial } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatDate, formatDateTime, movementTypeLabels, exportToCSV } from '@/lib/utils';
import {
  LoadingSpinner, ErrorState, EmptyState, PageHeader, Badge, Modal,
  Select, Input, Button,
} from '@/components/ui';
import { FileBarChart, Download, Search, Eye } from 'lucide-react';

export type ReportsMode = 'general' | 'movements';

export default function Reports({ mode = 'general' }: { mode?: ReportsMode }) {
  const tab = mode === 'general' ? 'products' : 'movements';
  const [products, setProducts] = useState<(Product & { category?: { name: string } | null; unit?: { name: string } | null; supplier?: { name: string } | null; balance: number; status: string })[]>([]);
  const [movements, setMovements] = useState<(Movement & { product?: Product; client?: { name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  // Product filters
  const [prodSearch, setProdSearch] = useState('');
  const [prodCategory, setProdCategory] = useState('');
  const [prodSupplier, setProdSupplier] = useState('');
  const [prodStatus, setProdStatus] = useState('');

  // Movement filters
  const [movType, setMovType] = useState('');
  const [movProduct, setMovProduct] = useState('');
  const [movResponsible, setMovResponsible] = useState('');
  const [movDateFrom, setMovDateFrom] = useState('');
  const [movDateTo, setMovDateTo] = useState('');

  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('products')
        .select('*, category:categories(*), unit:units(*), supplier:suppliers(*)')
        .order('name');

      if (prodCategory) query = query.eq('category_id', prodCategory);
      if (prodSupplier) query = query.eq('supplier_id', prodSupplier);

      const data = await allRows(() => query);

      const prods = data as Product[];
      const balanceMap = await loadBalances();

      let filtered = prods.map((p) => {
        const balance = balanceMap[p.id] ?? 0;
        const status = balance <= (p.min_stock || 0) ? 'COMPRAR' : 'OK';
        return { ...p, balance, status };
      });

      if (prodSearch) {
        filtered = filtered.filter((p) =>
          p.name.toLowerCase().includes(prodSearch.toLowerCase()) ||
          p.code.toLowerCase().includes(prodSearch.toLowerCase())
        );
      }
      if (prodStatus) filtered = filtered.filter((p) => p.status === prodStatus);

      setProducts(filtered);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [prodSearch, prodCategory, prodSupplier, prodStatus]);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('movements')
        .select('*, product:products(*), client:clients(*)')
        .order('created_at', { ascending: false })
        .order('id');

      if (movType) query = query.eq('type', movType);
      if (movProduct) query = query.eq('product_id', movProduct);
      if (movResponsible) query = query.ilike('responsible', `%${movResponsible}%`);
      if (movDateFrom) query = query.gte('created_at', dateBoundary(movDateFrom));
      if (movDateTo) query = query.lt('created_at', dateBoundary(movDateTo,true));

      const data = await allRows(() => query);
      setMovements(data as (Movement & { product?: Product; client?: { name: string } })[]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [movType, movProduct, movResponsible, movDateFrom, movDateTo]);

  useEffect(() => {
    supabase.from('categories').select('*').order('name').then(({ data }) => {
      if (data) setCategories(data);
    });
    supabase.from('suppliers').select('*').order('name').then(({ data }) => {
      if (data) setSuppliers(data);
    });
    supabase.from('products').select('*').order('name').then(({ data }) => {
      if (data) setAllProducts(data as Product[]);
    });
  }, []);

  useEffect(() => {
    if (tab === 'products') loadProducts();
    else loadMovements();
  }, [tab, loadProducts, loadMovements]);

  function exportProducts() {
    exportToCSV('relatorio_produtos.csv', [
      'Código', 'Categoria', 'Nome', 'Unidade', 'Marca', 'Fornecedor',
      'Saldo Atual', 'Estoque Mínimo', 'Custo Unit.', 'Preço Venda',
      'Valor em Estoque', 'Margem', 'Status',
    ], products.map((p) => {
      const stockValue = (p as Product & { balance: number }).balance * (p.unit_cost || 0);
      const margin = p.unit_price > 0 ? ((p.unit_price - p.unit_cost) / p.unit_price * 100).toFixed(1) + '%' : 'Não definida';
      return [
        p.code, p.category?.name ?? '', p.name, p.unit?.name ?? '', p.brand, p.supplier?.name ?? '',
        formatNumber((p as Product & { balance: number }).balance),
        formatNumber(p.min_stock),
        formatNumber(p.unit_cost), formatNumber(p.unit_price),
        formatCurrency(stockValue), margin,
        (p as Product & { status: string }).status,
      ];
    }));
  }

  function exportMovements() {
    exportToCSV('relatorio_movimentacoes.csv', [
      'Data/Hora', 'Tipo', 'Produto', 'Código', 'Quantidade', 'Custo Unit.',
      'Responsável', 'Cliente', 'Observações',
    ], movements.map((m) => [
      formatDateTime(m.created_at),
      movementTypeLabels[m.type] ?? m.type,
      m.product?.name ?? '', m.product?.code ?? '',
      formatNumber(m.quantity),
      formatCurrency(m.unit_cost),
      m.responsible,
      m.client?.name ?? '',
      m.notes,
    ]));
  }

  return (
    <div>
      <PageHeader title="Consultas e Relatórios" subtitle="Pesquise e exporte dados" />

      {tab === 'products' && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Código ou nome..."
                  value={prodSearch}
                  onChange={(e) => setProdSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <Select value={prodCategory} onChange={(e) => setProdCategory(e.target.value)}>
                <option value="">Todas categorias</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={prodSupplier} onChange={(e) => setProdSupplier(e.target.value)}>
                <option value="">Todos fornecedores</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Select value={prodStatus} onChange={(e) => setProdStatus(e.target.value)}>
                <option value="">Todos status</option>
                <option value="OK">OK</option>
                <option value="COMPRAR">Comprar</option>
              </Select>
            </div>
          </div>

          {loading ? <LoadingSpinner /> : error ? <ErrorState message={error} onRetry={loadProducts} /> : (
            <>
              <div className="flex justify-end mb-3">
                <Button variant="secondary" size="sm" onClick={exportProducts}>
                  <Download className="w-4 h-4" /> Exportar CSV
                </Button>
              </div>
              {products.length === 0 ? (
                <EmptyState icon={FileBarChart} title="Nenhum produto encontrado" />
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">Código</th>
                        <th className="text-left px-4 py-3 font-medium">Nome</th>
                        <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Categoria</th>
                        <th className="text-right px-4 py-3 font-medium">Saldo</th>
                        <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Custo</th>
                        <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Preço</th>
                        <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Valor Est.</th>
                        <th className="text-center px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {products.map((p) => {
                        const balance = (p as Product & { balance: number }).balance;
                        const status = (p as Product & { status: string }).status;
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                            <td className="px-4 py-3 font-medium">{p.name}</td>
                            <td className="px-4 py-3 hidden md:table-cell">{p.category?.name ?? '-'}</td>
                            <td className="px-4 py-3 text-right">{formatNumber(balance)}</td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">{formatCurrency(p.unit_cost)}</td>
                            <td className="px-4 py-3 text-right hidden lg:table-cell">{formatCurrency(p.unit_price)}</td>
                            <td className="px-4 py-3 text-right hidden lg:table-cell">{formatCurrency(balance * p.unit_cost)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>{status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <Select value={movType} onChange={(e) => setMovType(e.target.value)}>
                <option value="">Todos tipos</option>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
                <option value="ajuste">Ajuste</option>
                <option value="estorno">Estorno</option>
                <option value="saldo_inicial">Saldo Inicial</option>
              </Select>
              <Select value={movProduct} onChange={(e) => setMovProduct(e.target.value)}>
                <option value="">Todos produtos</option>
                {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input placeholder="Responsável" value={movResponsible} onChange={(e) => setMovResponsible(e.target.value)} />
              <Input type="date" value={movDateFrom} onChange={(e) => setMovDateFrom(e.target.value)} />
              <Input type="date" value={movDateTo} onChange={(e) => setMovDateTo(e.target.value)} />
            </div>
          </div>

          {loading ? <LoadingSpinner /> : error ? <ErrorState message={error} onRetry={loadMovements} /> : (
            <>
              <div className="flex justify-end mb-3">
                <Button variant="secondary" size="sm" onClick={exportMovements}>
                  <Download className="w-4 h-4" /> Exportar CSV
                </Button>
              </div>
              {movements.length === 0 ? (
                <EmptyState icon={FileBarChart} title="Nenhuma movimentação encontrada" />
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
                        <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Obs.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {movements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                          <td className="px-4 py-3 text-xs">{movementTypeLabels[m.type] ?? m.type}</td>
                          <td className="px-4 py-3">{m.product?.name ?? '-'}</td>
                          <td className={`px-4 py-3 text-right font-medium ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {m.quantity > 0 ? '+' : ''}{formatNumber(m.quantity)}
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">{formatCurrency(m.unit_cost)}</td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs">{m.responsible || '-'}</td>
                          <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500 max-w-xs truncate">{m.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

    </div>
  );
}

type ProfitMaterial = Pick<ServiceMaterial, 'id' | 'service_id' | 'appliance_id' | 'quantity' | 'unit_cost' | 'unit_price' | 'subtotal'> & {
  product?: Pick<Product, 'name' | 'code'> | null;
};
type ProfitService = Pick<Service, 'id' | 'number' | 'client_id' | 'service_date' | 'description' | 'discount' | 'total_value' | 'status' | 'payment_status' | 'payment_date' | 'payment_method'> & {
  client?: { name: string } | null;
  materials: ProfitMaterial[];
};

const months = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function paymentLabel(status: ProfitService['payment_status']): string {
  if (status === 'pago') return 'Recebido';
  if (status === 'pendente') return 'Pendente';
  return 'Pagamento cancelado';
}

export function ProfitReport() {
  const [services, setServices] = useState<ProfitService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [detail, setDetail] = useState<ProfitService | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serviceRows, materialRows] = await Promise.all([
        allRows<ProfitService>(() => supabase
          .from('services')
          .select('id,number,client_id,service_date,description,discount,total_value,status,payment_status,payment_date,payment_method,client:clients(name)')
          .order('service_date', { ascending: false })
          .order('number', { ascending: false })),
        allRows<ProfitMaterial>(() => supabase
          .from('service_materials')
          .select('id,service_id,appliance_id,quantity,unit_cost,unit_price,subtotal,product:products(name,code)')
          .order('service_id')
          .order('id')),
      ]);

      const materialsByService = new Map<string, ProfitMaterial[]>();
      for (const material of materialRows) {
        const current = materialsByService.get(material.service_id) ?? [];
        current.push(material);
        materialsByService.set(material.service_id, current);
      }
      setServices(serviceRows.map(service => ({
        ...service,
        materials: materialsByService.get(service.id) ?? [],
      })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => [...new Set(services
    .map(service => Number(service.service_date.slice(0, 4)))
    .filter(Number.isInteger))].sort((a, b) => b - a), [services]);

  // O período operacional do relatório é a data do atendimento (service_date),
  // não a data em que um pagamento foi recebido.
  const filteredServices = useMemo(() => services
    .filter(service => service.status === 'confirmado')
    .filter(service => !year || service.service_date.slice(0, 4) === year)
    .filter(service => !month || Number(service.service_date.slice(5, 7)) === Number(month))
    .map(service => {
      const materialsSold = service.materials.reduce((sum, material) => sum + Number(material.subtotal || 0), 0);
      const materialsCost = calculateMaterialCost(service.materials);
      return {
        ...service,
        materialsSold,
        materialsCost,
        grossProfit: Number(service.total_value || 0) - materialsCost,
      };
    }), [services, year, month]);

  const totals = useMemo(() => summarizeConfirmedProfits(filteredServices), [filteredServices]);

  const cards = [
    { label: 'Receita total · confirmada', value: totals.revenue, accent: 'text-sky-700' },
    { label: 'Total de descontos', value: totals.discounts, accent: 'text-slate-800' },
    { label: 'Materiais vendidos', value: totals.materialsSold, accent: 'text-slate-800' },
    { label: 'Custo dos materiais', value: totals.materialCost, accent: 'text-orange-800' },
    { label: 'Lucro bruto', value: totals.grossProfit, accent: 'text-green-700' },
    { label: 'Recebido · destes serviços', value: totals.received, accent: 'text-green-700' },
    { label: 'Pendente · destes serviços', value: totals.pending, accent: 'text-yellow-700' },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Relatório de Lucros</h2>
        <p className="mt-1 text-sm text-slate-500">Lucro bruto antes do custo de mão de obra e de outras despesas da empresa.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Select label="Ano" value={year} onChange={event => setYear(event.target.value)}>
          <option value="">Todos os anos</option>
          {years.map(option => <option key={option} value={String(option)}>{option}</option>)}
        </Select>
        <Select label="Mês" value={month} onChange={event => setMonth(event.target.value)}>
          <option value="">Todos os meses</option>
          {months.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
        </Select>
      </div>

      {loading ? <LoadingSpinner label="Carregando relatório de lucros..." /> : error ? <ErrorState message={error} onRetry={load} /> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map(card => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className={`mt-1 text-xl font-bold ${card.accent}`}>{formatCurrency(card.value)}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          A receita considera o valor final do serviço, já com desconto. “Recebido” e “Pendente” classificam esses atendimentos pelo estado do pagamento; o período usa a data do serviço.
          Rascunhos e serviços cancelados não entram nos totais.
        </p>

        {filteredServices.length === 0 ? <EmptyState icon={FileBarChart} title="Nenhum serviço confirmado neste período" /> : (
          <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Nº do serviço</th>
                  <th className="px-4 py-3 text-left font-medium">Cliente</th>
                  <th className="px-4 py-3 text-right font-medium">Valor final</th>
                  <th className="px-4 py-3 text-right font-medium">Desconto</th>
                  <th className="px-4 py-3 text-right font-medium">Materiais</th>
                  <th className="px-4 py-3 text-right font-medium">Custo materiais</th>
                  <th className="px-4 py-3 text-right font-medium">Lucro bruto</th>
                  <th className="px-4 py-3 text-left font-medium">Situação</th>
                  <th className="px-4 py-3 text-center font-medium">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredServices.map(service => (
                  <tr key={service.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(service.service_date)}</td>
                    <td className="px-4 py-3 font-medium">#{service.number}</td>
                    <td className="px-4 py-3">{service.client?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(service.total_value)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(service.discount)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(service.materialsSold)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(service.materialsCost)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(service.grossProfit)}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><Badge color="blue">Confirmado</Badge><Badge color={service.payment_status === 'pago' ? 'green' : service.payment_status === 'pendente' ? 'yellow' : 'gray'}>{paymentLabel(service.payment_status)}</Badge></div></td>
                    <td className="px-4 py-3 text-center">
                      <button type="button" onClick={() => setDetail(service)} aria-label={`Ver detalhes do serviço ${service.number}`} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700">
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>}

      {detail && <ProfitServiceDetail service={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ProfitServiceDetail({ service, onClose }: { service: ProfitService; onClose: () => void }) {
  const materialsSold = service.materials.reduce((sum, material) => sum + Number(material.subtotal || 0), 0);
  const cost = calculateMaterialCost(service.materials);
  return (
    <Modal open onClose={onClose} title={`Detalhes do serviço #${service.number}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <p><span className="text-slate-500">Cliente: </span><strong>{service.client?.name ?? '-'}</strong></p>
          <p><span className="text-slate-500">Data: </span><strong>{formatDate(service.service_date)}</strong></p>
          <p><span className="text-slate-500">Pagamento: </span><strong>{paymentLabel(service.payment_status)}</strong></p>
          {service.payment_status === 'pago' && service.payment_date && <p><span className="text-slate-500">Data do recebimento: </span><strong>{formatDate(service.payment_date)}</strong></p>}
        </div>
        {service.description && <p className="text-sm text-slate-600">{service.description}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Receita final</p><p className="font-semibold">{formatCurrency(service.total_value)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Desconto já aplicado</p><p className="font-semibold">{formatCurrency(service.discount)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Materiais vendidos</p><p className="font-semibold">{formatCurrency(materialsSold)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-500">Custo dos materiais</p><p className="font-semibold">{formatCurrency(cost)}</p></div>
          <div className="rounded-lg bg-sky-50 p-3 sm:col-span-2"><p className="text-sm text-slate-500">Lucro bruto · receita final menos custo dos materiais</p><p className="text-lg font-bold text-sky-700">{formatCurrency(Number(service.total_value) - cost)}</p></div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Materiais do atendimento</h3>
          {service.materials.length === 0 ? <p className="text-sm text-slate-500">Nenhum material vinculado.</p> : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Material</th><th className="px-3 py-2 text-right">Quantidade</th><th className="px-3 py-2 text-right">Preço de venda</th><th className="px-3 py-2 text-right">Custo unitário</th><th className="px-3 py-2 text-right">Custo total</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{service.materials.map(material => <tr key={material.id}><td className="px-3 py-2">{material.product?.name ?? 'Material'}{material.product?.code ? ` (${material.product.code})` : ''}</td><td className="px-3 py-2 text-right">{formatNumber(Number(material.quantity))}</td><td className="px-3 py-2 text-right">{formatCurrency(Number(material.unit_price))}</td><td className="px-3 py-2 text-right">{formatCurrency(Number(material.unit_cost))}</td><td className="px-3 py-2 text-right">{formatCurrency(calculateMaterialCost([material]))}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500">O custo considera todos os materiais vinculados ao serviço, inclusive os distribuídos entre aparelhos. Não inclui custo de mão de obra ou outras despesas.</p>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
      </div>
    </Modal>
  );
}
