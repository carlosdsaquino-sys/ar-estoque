import { supabase } from './supabase';
// Each factory creates a new ordered PostgREST query, avoiding mutation between pages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function allRows<T = any>(factory: () => any): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await factory().range(start, start + 499);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < 500) return result;
  }
}
export async function balances(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('get_product_balances');
  if (error) throw error;
  return data;
}
