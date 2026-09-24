import { dialogAlert } from '@/components/DialogProvider';
import { parseSpreadsheetNumber } from '@/lib/utils';
import { errorMessage } from '@/lib/utils';
import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { PageHeader, Button, Badge } from '@/components/ui';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, ArrowRight,
} from 'lucide-react';

interface ImportRow {
  code: string;
  category: string;
  name: string;
  unit: string;
  brand: string;
  supplier: string;
  stock: number;
  min_stock: number;
  unit_cost: number;
  unit_price: number;
  notes: string;
  errors: string[];
  willImport: boolean;
}

export default function Import() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = profile?.role === 'admin';

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Importar Planilha" />
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
          <p className="text-yellow-700 font-medium">Apenas administradores podem importar planilhas</p>
        </div>
      </div>
    );
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });

      // Try "Estoque" sheet first, then first sheet
      const sheet = workbook.Sheets['Estoque'] ?? workbook.Sheets[Object.keys(workbook.Sheets)[0]];
      if (!sheet) {
        dialogAlert('Nenhuma aba encontrada na planilha');
        return;
      }

      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const parsed: ImportRow[] = [];

      for (const row of jsonData) {
        const code = String(row['Código'] ?? row['Codigo'] ?? '').trim();
        if (!code && Object.values(row).every(v => v === '' || v == null)) continue;

        const r: ImportRow = {
          code,
          category: String(row['Categoria'] ?? '').trim(),
          name: String(row['Produto / Material'] ?? row['Produto / Material'] ?? row['Produto'] ?? '').trim(),
          unit: String(row['Unidade'] ?? row['Un'] ?? '').trim(),
          brand: String(row['Marca'] ?? '').trim(),
          supplier: String(row['Fornecedor'] ?? '').trim(),
          stock: parseSpreadsheetNumber(row['Estoque Atual'] ?? '0'),
          min_stock: parseSpreadsheetNumber(row['Estoque Mínimo'] ?? row['Estoque Minimo'] ?? '0'),
          unit_cost: parseSpreadsheetNumber(row['Custo Unitário (R$)'] ?? row['Custo Unitario (R$)'] ?? '0'),
          unit_price: parseSpreadsheetNumber(row['Preço de Venda (R$)'] ?? row['Preco de Venda (R$)'] ?? '0'),
          notes: String(row['Observações'] ?? row['Observacoes'] ?? '').trim(),
          errors: [],
          willImport: true,
        };

        if (!r.code) r.errors.push('Código da planilha obrigatório');
        if ([r.stock,r.min_stock,r.unit_cost,r.unit_price].some(v => !Number.isFinite(v))) r.errors.push('Número inválido');
        if (r.min_stock < 0) r.errors.push('Estoque mínimo não pode ser negativo');
        if (!r.name) r.errors.push('Nome do produto é obrigatório');
        if (r.stock < 0) r.errors.push('Estoque atual não pode ser negativo');
        if (r.unit_cost < 0) r.errors.push('Custo unitário não pode ser negativo');
        if (r.unit_price < 0) r.errors.push('Preço de venda não pode ser negativo');

        if (r.errors.length > 0) r.willImport = false;
        parsed.push(r);
      }

      // Check for duplicate codes within the file
      const codeCounts: Record<string, number> = {};
      for (const r of parsed) codeCounts[r.code] = (codeCounts[r.code] || 0) + 1;
      for (const r of parsed) {
        if (codeCounts[r.code] > 1) {
          r.errors.push('Código duplicado na planilha');
          r.willImport = false;
        }
      }

      setRows(parsed);
      setStep('preview');
      } catch (err) { dialogAlert('Não foi possível ler a planilha: ' + errorMessage(err)); }
    };
    reader.onerror = () => dialogAlert('Não foi possível abrir o arquivo');
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    try {
      const toImport = rows.filter((r) => r.willImport);

      if (toImport.length === 0) {
        dialogAlert('Nenhum produto válido para importar');
        setImporting(false);
        return;
      }

      const jsonData = toImport.map((r) => ({
        code: r.code,
        category: r.category,
        name: r.name,
        unit: r.unit,
        brand: r.brand,
        supplier: r.supplier,
        stock: r.stock,
        min_stock: r.min_stock,
        unit_cost: r.unit_cost,
        unit_price: r.unit_price,
        notes: r.notes,
      }));

      const { data, error } = await supabase.rpc('import_products', { p_data: jsonData });
      if (error) throw error;

      const result = data as { imported: number; skipped: number };
      setResult({ imported: result.imported, skipped: result.skipped });
      setStep('done');
    } catch (err) {
      dialogAlert(errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setRows([]);
    setFileName('');
    setStep('upload');
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const validCount = rows.filter((r) => r.willImport).length;
  const errorCount = rows.filter((r) => !r.willImport).length;

  return (
    <div>
      <PageHeader title="Importar Planilha" subtitle="Importe produtos de um arquivo XLSX" />

      {step === 'upload' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/50 transition-colors"
          >
            <FileSpreadsheet className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium mb-1">Selecione um arquivo XLSX</p>
            <p className="text-sm text-slate-400">Clique para escolher o arquivo da planilha</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className="hidden"
            />
          </div>
          <div className="mt-6 bg-slate-50 rounded-lg p-4 text-sm text-slate-600">
            <p className="font-medium mb-2">Colunas esperadas (aba "Estoque"):</p>
            <ul className="grid grid-cols-2 gap-1 text-xs">
              <li>Código na planilha</li>
              <li>Categoria</li>
              <li>Produto / Material</li>
              <li>Unidade</li>
              <li>Marca</li>
              <li>Fornecedor</li>
              <li>Estoque Atual</li>
              <li>Estoque Mínimo</li>
              <li>Custo Unitário (R$)</li>
              <li>Preço de Venda (R$)</li>
              <li>Observações</li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              O código informado será usado para reconhecer reimportações; cada novo produto receberá um código PROD gerado pelo sistema. Valor em estoque, margem e status serão recalculados.
            </p>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium">{fileName}</span>
                <Badge color="blue">{rows.length} linhas</Badge>
                <Badge color="green">{validCount} válidas</Badge>
                {errorCount > 0 && <Badge color="red">{errorCount} com erro</Badge>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={reset}>Cancelar</Button>
                <Button size="sm" onClick={handleImport} disabled={importing || validCount === 0}>
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {importing ? 'Importando...' : `Confirmar Importação (${validCount})`}
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Código na planilha</th>
                  <th className="text-left px-3 py-2 font-medium">Nome</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Categoria</th>
                  <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Un.</th>
                  <th className="text-right px-3 py-2 font-medium">Estoque</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Custo</th>
                  <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">Preço</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className={r.willImport ? 'hover:bg-slate-50' : 'bg-red-50'}>
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2">{r.name || <span className="text-red-500">Sem nome</span>}</td>
                    <td className="px-3 py-2 hidden md:table-cell text-xs">{r.category || '-'}</td>
                    <td className="px-3 py-2 hidden lg:table-cell text-xs">{r.unit || '-'}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(r.stock)}</td>
                    <td className="px-3 py-2 text-right hidden md:table-cell">{formatCurrency(r.unit_cost)}</td>
                    <td className="px-3 py-2 text-right hidden lg:table-cell">{formatCurrency(r.unit_price)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.willImport
                        ? <Badge color="green">OK</Badge>
                        : <Badge color="red">{r.errors.join('; ')}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Importação Concluída</h2>
          <div className="flex justify-center gap-6 mt-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">{result.imported}</p>
              <p className="text-sm text-slate-500">Produtos importados</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-400">{result.skipped}</p>
              <p className="text-sm text-slate-500">Ignorados (duplicados)</p>
            </div>
          </div>
          <Button className="mt-6" onClick={reset}>Nova Importação</Button>
        </div>
      )}
    </div>
  );
}
