import { dialogAlert, dialogConfirm, dialogPrompt } from '@/components/DialogProvider';
import { allRows } from '@/lib/data';
import { useAuth } from '@/context/AuthContext';
import { balances as loadBalances } from '@/lib/data';
import { errorMessage } from '@/lib/utils';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, type Product, type Category, type Unit, type Supplier, type ProductWithBalance } from '@/lib/supabase';
import { formatCurrency, formatNumber, calculateMargin, formatMargin, getStockStatus, exportToCSV } from '@/lib/utils';
import {
  LoadingSpinner, ErrorState, EmptyState, PageHeader, Badge,
  Modal, Button, Input, Select, Textarea,
} from '@/components/ui';
import {
  Package, Plus, Search, Pencil, Download, PackageX, Trash2,

} from 'lucide-react';

export default function Products() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [products, setProducts] = useState<ProductWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newUnitName, setNewUnitName] = useState('');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await allRows(() => supabase.from('products').select('*, category:categories(*), unit:units(*), supplier:suppliers(*)').order('name').order('id'));

      const prods = data as Product[];
      const balanceMap = await loadBalances();

      const withData: ProductWithBalance[] = prods.map((p) => {
        const balance = balanceMap[p.id] ?? 0;
        const stockValue = balance * (p.unit_cost || 0);
        const margin = calculateMargin(p.unit_cost, p.unit_price);
        const status = getStockStatus(balance, p.min_stock || 0);
        return { ...p, balance, stock_value: stockValue, margin, status };
      });

      setProducts(withData);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMetadata() {
    const [catRes, unitRes, supRes] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('units').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    if (catRes.data) setCategories(catRes.data as Category[]);
    if (unitRes.data) setUnits(unitRes.data as Unit[]);
    if (supRes.data) setSuppliers(supRes.data as Supplier[]);
  }

  useEffect(() => {
    loadProducts();
    loadMetadata();
  }, [loadProducts]);

  const filtered = products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.code.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (filterCategory && p.category_id !== filterCategory) return false;
    if (filterSupplier && p.supplier_id !== filterSupplier) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  function handleExport() {
    exportToCSV('produtos.csv', [
      'Código', 'Categoria', 'Nome', 'Unidade', 'Marca', 'Fornecedor',
      'Saldo Atual', 'Estoque Mínimo', 'Custo Unit.', 'Preço Venda',
      'Valor em Estoque', 'Margem', 'Status',
    ], filtered.map((p) => [
      p.code, p.category?.name ?? '', p.name, p.unit?.name ?? '', p.brand, p.supplier?.name ?? '',
      formatNumber(p.balance), formatNumber(p.min_stock),
      formatNumber(p.unit_cost), formatNumber(p.unit_price),
      formatCurrency(p.stock_value),
      p.margin === null ? 'Não definida' : formatMargin(p.margin),
      p.status,
    ]));
  }

  async function handleSave(product: Partial<Product> & Record<string, unknown>) {
    const data = { name: product.name?.trim(),
      category_id: product.category_id || null, unit_id: product.unit_id || null,
      supplier_id: product.supplier_id || null, brand: product.brand, min_stock: product.min_stock,
      unit_cost: product.unit_cost, unit_price: product.unit_price, notes: product.notes, is_active: product.is_active };
    if (editing) {
      const { error } = await supabase.from('products').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) { dialogAlert('Erro: ' + error.message); return; }
    } else {
      const { error } = await supabase.rpc('create_product', { p_data: data, p_code: product.code?.trim() });
      if (error) { dialogAlert('Erro: ' + error.message); return; }
    }
    setShowForm(false);
    setEditing(null);
    loadProducts();
  }

  async function handleToggleActive(p: Product) {
    const { error } = await supabase.from('products').update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { dialogAlert('Erro: ' + error.message); return; }
    loadProducts();
  }

  async function handleDelete(p: ProductWithBalance) {
    const [movementCount, materialCount, stock] = await Promise.all([
      supabase.from('movements').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
      supabase.from('service_materials').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
      supabase.rpc('get_product_balance', { p_product_id: p.id }),
    ]);
    if (movementCount.error || materialCount.error || stock.error) {
      dialogAlert('Não foi possível verificar os registros relacionados ao produto. Nenhuma alteração foi feita.');
      return;
    }

    const hasHistory = (movementCount.count ?? 0) > 0 || (materialCount.count ?? 0) > 0;
    const currentBalance = Number(stock.data ?? 0);
    const stockMessage = currentBalance !== 0
      ? `\n\nEste produto também possui estoque atual: ${formatNumber(currentBalance)} ${p.unit?.name ?? 'unidades'}. O saldo será removido junto com o produto.`
      : '';
    const historyMessage = hasHistory
      ? `\n\nAtenção: este produto possui histórico de movimentações e/ou serviços.\nMovimentações: ${movementCount.count ?? 0}\nMateriais utilizados em serviços: ${materialCount.count ?? 0}.\n\nSe você continuar, o produto e os registros relacionados a ele serão apagados.`
      : `\n\nO produto será removido permanentemente.`;
    const confirmed = await dialogConfirm(
      `Todos os registros relacionados a este produto serão apagados.\n\nProduto: ${p.name}${historyMessage}${stockMessage}\n\nEssa ação não pode ser desfeita.`,
      { title: 'Excluir produto permanentemente?', confirmLabel: 'Excluir permanentemente', cancelLabel: 'Cancelar', destructive: true },
    );
    if (!confirmed) return;

    const { error } = await supabase.rpc('delete_product', { p_product_id: p.id });
    if (error) {
      dialogAlert('Erro: ' + error.message);
      return;
    }
    loadProducts();
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    const { error } = await supabase.from('categories').insert({ name: newCategoryName.trim() });
    if (error) { if (error.code === '23505') dialogAlert('Categoria já existe'); else dialogAlert('Erro: ' + error.message); return; }
    setNewCategoryName('');
    setShowCategoryModal(false);
    loadMetadata();
  }

  async function handleAddUnit() {
    if (!newUnitName.trim()) return;
    const { error } = await supabase.from('units').insert({ name: newUnitName.trim() });
    if (error) { if (error.code === '23505') dialogAlert('Unidade já existe'); else dialogAlert('Erro: ' + error.message); return; }
    setNewUnitName('');
    setShowUnitModal(false);
    loadMetadata();
  }

  if (loading) return <LoadingSpinner label="Carregando produtos..." />;
  if (error) return <ErrorState message={error} onRetry={loadProducts} />;

  return (
    <div>
      <PageHeader title="Produtos" subtitle={`${products.length} produtos cadastrados`}>
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
        <Button disabled={!isAdmin} size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Novo Produto
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código ou nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">Todas categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
            <option value="">Todos fornecedores</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todos status</option>
            <option value="OK">OK</option>
            <option value="COMPRAR">Comprar</option>
          </Select>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum produto encontrado" description="Cadastre um novo produto ou ajuste os filtros" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Código</th>
                <th className="text-left px-4 py-3 font-medium">Produto</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Categoria</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Un.</th>
                <th className="text-right px-4 py-3 font-medium">Saldo</th>
                <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Custo</th>
                <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Preço</th>
                <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Margem</th>
                <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Valor Est.</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className={`hover:bg-slate-50 ${!p.is_active ? 'opacity-50' : ''}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-slate-700">{p.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.brand}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-600">{p.category?.name ?? '-'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-slate-600">{p.unit?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatNumber(p.balance)}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-slate-600">{formatCurrency(p.unit_cost)}</td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell text-slate-600">{formatCurrency(p.unit_price)}</td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell text-slate-600">{formatMargin(p.margin)}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-slate-600">{formatCurrency(p.stock_value)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={p.status === 'OK' ? 'green' : 'red'}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        disabled={!isAdmin} onClick={() => { setEditing(p); setShowForm(true); }}
                        className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        disabled={!isAdmin} onClick={() => handleToggleActive(p)}
                        className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                        title={p.is_active ? 'Inativar' : 'Ativar'}
                      >
                        <PackageX className="w-4 h-4" />
                      </button>
                      <button
                        disabled={!isAdmin} onClick={() => void handleDelete(p)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Excluir"
                        aria-label={`Excluir ${p.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ProductForm
          product={editing}
          categories={categories}
          units={units}
          suppliers={suppliers}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onAddCategory={() => setShowCategoryModal(true)}
          onAddUnit={() => setShowUnitModal(true)}
        />
      )}

      <Modal open={showCategoryModal} onClose={() => setShowCategoryModal(false)} title="Nova Categoria">
        <div className="space-y-4">
          <Input
            label="Nome da categoria"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Ex: Ferramentas"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCategoryModal(false)}>Cancelar</Button>
            <Button onClick={handleAddCategory}>Adicionar</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showUnitModal} onClose={() => setShowUnitModal(false)} title="Nova Unidade de Medida">
        <div className="space-y-4">
          <Input
            label="Nome da unidade"
            value={newUnitName}
            onChange={(e) => setNewUnitName(e.target.value)}
            placeholder="Ex: un, m, kg"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowUnitModal(false)}>Cancelar</Button>
            <Button onClick={handleAddUnit}>Adicionar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Preserve the input text while editing; convert only when saving.
function parseDecimalInput(value: string): number {
  const text = value.trim();
  if (text === '') return 0;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

function ProductForm({
  product, categories, units, suppliers, onSave, onClose, onAddCategory, onAddUnit,
}: {
  product: Product | null;
  categories: Category[];
  units: Unit[];
  suppliers: Supplier[];
  onSave: (p: Partial<Product>) => Promise<void>;
  onClose: () => void;
  onAddCategory: () => void;
  onAddUnit: () => void;
}) {
  const [form, setForm] = useState({
    code: product?.code ?? '',
    category_id: product?.category_id ?? '',
    name: product?.name ?? '',
    unit_id: product?.unit_id ?? '',
    brand: product?.brand ?? '',
    supplier_id: product?.supplier_id ?? '',
    min_stock: String(product?.min_stock ?? 0),
    unit_cost: String(product?.unit_cost ?? 0),
    unit_price: String(product?.unit_price ?? 0),
    notes: product?.notes ?? '',
    is_active: product?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [codeError, setCodeError] = useState('');
  const reservedCode = useRef<string | null>(null);

  useEffect(() => {
    if (product?.id) return;
    let mounted = true;
    void (async () => {
      const { data, error } = await supabase.rpc('reserve_product_code');
      if (error) {
        if (mounted) setCodeError('Não foi possível gerar o código. Feche e abra o cadastro novamente.');
        return;
      }
      const code = String(data);
      reservedCode.current = code;
      if (mounted) setForm(current => ({ ...current, code }));
      else void supabase.rpc('release_product_code_reservation', { p_code: code });
    })();
    return () => {
      mounted = false;
      if (reservedCode.current) {
        void supabase.rpc('release_product_code_reservation', { p_code: reservedCode.current });
        reservedCode.current = null;
      }
    };
  }, [product?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.code.trim() || !form.name.trim()) {
      dialogAlert(form.name.trim() ? 'Aguarde a geração do código do produto.' : 'Nome do produto é obrigatório');
      return;
    }
    const numericValues = {
      min_stock: parseDecimalInput(form.min_stock),
      unit_cost: parseDecimalInput(form.unit_cost),
      unit_price: parseDecimalInput(form.unit_price),
    };
    if (Object.values(numericValues).some(v => !Number.isFinite(v) || v < 0)) {
      dialogAlert('Informe valores válidos, iguais ou maiores que zero. Use vírgula ou ponto para os decimais.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, ...numericValues });
    } catch (err) {
      dialogAlert(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={product ? 'Editar Produto' : 'Novo Produto'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Input
              label="Código"
              value={form.code}
              readOnly
              placeholder={product ? '' : codeError ? 'Não foi possível gerar' : 'Gerando automaticamente...'}
            />
            <p className="mt-1.5 text-xs text-slate-500">{codeError || (product ? 'Código fixo do produto.' : 'Gerado automaticamente pelo sistema.')}</p>
          </div>
          <Input
            label="Nome do Produto *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="Ex: Split 12000 BTUs"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700">Categoria</label>
              <button type="button" onClick={onAddCategory} className="text-xs text-sky-600 hover:underline">+ Nova</button>
            </div>
            <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Selecione...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700">Unidade</label>
              <button type="button" onClick={onAddUnit} className="text-xs text-sky-600 hover:underline">+ Nova</button>
            </div>
            <Select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
              <option value="">Selecione...</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Marca"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            placeholder="Ex: LG, Midea"
          />
          <button type="button" className="text-xs text-sky-700" onClick={async () => {
            const name = await dialogPrompt('Nome do novo fornecedor:');
            if (!name?.trim()) return;
            const {data,error} = await supabase.from('suppliers').insert({name:name.trim()}).select().single();
            if (error) { dialogAlert(error.message); return; }
            suppliers.push(data);
            setForm(f => ({...f,supplier_id:data.id}));
          }}>+ Novo fornecedor</button>
          <Select label="Fornecedor" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">Sem fornecedor</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Estoque Mínimo"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={form.min_stock}
            onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
          />
          <Input
            label="Custo Unitário (R$)"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
          />
          <Input
            label="Preço de Venda (R$)"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={form.unit_price}
            onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
          />
        </div>
        <Textarea
          label="Observações"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Notas adicionais sobre o produto"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving || !form.code}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
