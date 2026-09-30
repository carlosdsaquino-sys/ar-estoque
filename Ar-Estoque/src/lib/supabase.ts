import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurationMissing = !supabaseUrl || !supabaseAnonKey;
export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'configuration-required', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'estoque-ar',
    },
  },
});

export type UserRole = 'admin' | 'operador';

export interface Profile {
  id: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface Unit {
  id: string;
  name: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  code: string;
  category_id: string | null;
  name: string;
  unit_id: string | null;
  brand: string;
  supplier_id: string | null;
  min_stock: number;
  unit_cost: number;
  unit_price: number;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: Category | null;
  unit?: Unit | null;
  supplier?: Supplier | null;
}

export interface Movement {
  id: string;
  product_id: string;
  type: 'entrada' | 'saida' | 'ajuste' | 'estorno' | 'saldo_inicial';
  quantity: number;
  unit_cost: number;
  responsible: string;
  notes: string;
  client_id: string | null;
  service_id: string | null;
  reversal_of: string | null;
  created_at: string;
  created_by: string | null;
  product?: Product | null;
  client?: Client | null;
  service?: Service | null;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Service {
  version: number;
  id: string;
  number: number;
  client_id: string;
  service_date: string;
  description: string;
  technician: string;
  technician_id: string | null;
  labor_value: number;
  discount: number;
  total_value: number;
  payment_status: 'pendente' | 'pago' | 'cancelado';
  payment_date: string | null;
  payment_method: string | null;
  status: 'rascunho' | 'confirmado' | 'cancelado';
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  client?: Client | null;
}

export interface ServiceMaterial {
  id: string;
  service_id: string;
  appliance_id?: string | null;
  product_id: string;
  unit_id: string | null;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  subtotal: number;
  product?: Product | null;
  unit?: Unit | null;
}

export interface ServiceType {
  id: string;
  name: string;
  description: string;
  default_price: number;
  is_active: boolean;
  maintenance_enabled: boolean;
  maintenance_interval_months: number | null;
  maintenance_alert_days: number;
  created_at: string;
  updated_at: string;
}

export interface ClientAppliance {
  id: string;
  client_id: string;
  name: string;
  description: string;
  location: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceAppliance {
  id: string;
  service_id: string;
  appliance_number: number;
  notes: string;
  client_appliance_id: string | null;
  client_appliance?: ClientAppliance | null;
  created_at: string;
}

export interface PerformedService {
  id: string;
  appliance_id: string;
  service_type_id: string | null;
  name_snapshot: string;
  description_snapshot: string;
  unit_price: number;
  maintenance_enabled_snapshot: boolean;
  maintenance_interval_months_snapshot: number | null;
  maintenance_alert_days_snapshot: number;
  created_at: string;
}

export interface MaintenanceOverviewItem {
  client_appliance_id: string;
  client_id: string;
  client_name: string;
  appliance_name: string;
  appliance_description: string;
  appliance_location: string;
  last_maintenance_date: string;
  next_maintenance_date: string;
  interval_months: number;
  alert_days: number;
  days_until: number;
}

export interface ServiceHistory {
  id: string;
  service_id: string;
  action: string;
  description: string;
  user_name: string;
  created_at: string;
}

export interface ProductWithBalance extends Product {
  balance: number;
  stock_value: number;
  margin: number | null;
  status: 'OK' | 'COMPRAR';
}
