export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value || 0);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T12:00:00' : date) : date;
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T12:00:00' : date) : date;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function calculateMargin(cost: number, price: number): number | null {
  if (!price || price === 0) return null;
  return ((price - cost) / price) * 100;
}

export function formatMargin(margin: number | null): string {
  if (margin === null) return 'Não definida';
  return margin.toFixed(1) + '%';
}

export function getStockStatus(balance: number, minStock: number): 'OK' | 'COMPRAR' {
  return balance <= minStock ? 'COMPRAR' : 'OK';
}

export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [
    headers.join(';'),
    ...rows.map((row) =>
      row.map((cell) => {
        const str = String(cell ?? '');
        if (str.includes(';') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(';')
    ),
  ].join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const paymentMethodLabels: Record<string, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  transferencia: 'Transferência',
  outro: 'Outro',
};

export const movementTypeLabels: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  ajuste: 'Ajuste',
  estorno: 'Estorno',
  saldo_inicial: 'Saldo Inicial',
};

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function hasLocalDayChanged(savedDay: string | null, currentDay = todayLocal()): boolean {
  return savedDay !== null && savedDay !== currentDay;
}

export function millisecondsUntilNextLocalMidnight(now = new Date()): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, nextMidnight.getTime() - now.getTime());
}

export function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Não foi possível concluir. Tente novamente.';
}
export function parseSpreadsheetNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  let text = String(value ?? '').trim().replace(/R\$|\s/g, '');
  if (!text) return 0;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  return Number(text);
}
export function dateBoundary(date: string, nextDay = false): string {
  const d = new Date(date + 'T00:00:00');
  if (nextDay) d.setDate(d.getDate()+1);
  return d.toISOString();
}
export function operationId(ref: { current: { payload: string; id: string } | null }, payload: unknown): string {
  const serialized = JSON.stringify(payload);
  if (!ref.current || ref.current.payload !== serialized) ref.current = { payload: serialized, id: crypto.randomUUID() };
  return ref.current.id;
}
