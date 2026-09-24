/*
# Create profiles, clients, services, movements, service_materials, service_history

1. New Tables
- profiles: user profiles linked to auth.users with role (admin/operador)
- clients: customer records (name, phone, address, notes)
- services: service records with number, client, date, labor, discount, total, payment status
- movements: stock movements (entrada, saida, ajuste, estorno, saldo_inicial)
- service_materials: materials used in each service
- service_history: audit trail of service changes
2. Security
- RLS enabled on all tables, TO authenticated
- profiles: users can see own; admins can see all and manage roles
3. Notes
- Service numbers auto-generated via sequence
- Movements store historical costs (not affected by product updates)
- Service materials preserve cost and price at time of service
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'operador' CHECK (role IN ('admin', 'operador')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "admin_select_all_profiles" ON profiles;
CREATE POLICY "admin_select_all_profiles" ON profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "admin_insert_profiles" ON profiles;
CREATE POLICY "admin_insert_profiles" ON profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;
CREATE POLICY "admin_update_profiles" ON profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  address text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_clients" ON clients;
CREATE POLICY "select_clients" ON clients FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_clients" ON clients;
CREATE POLICY "insert_clients" ON clients FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_clients" ON clients;
CREATE POLICY "update_clients" ON clients FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_clients" ON clients;
CREATE POLICY "delete_clients" ON clients FOR DELETE
  TO authenticated USING (true);

CREATE SEQUENCE IF NOT EXISTS service_number_seq START 1;

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL DEFAULT nextval('service_number_seq'),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  description text DEFAULT '',
  technician text DEFAULT '',
  labor_value numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente', 'pago', 'cancelado')),
  payment_date date,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('pix', 'dinheiro', 'cartao', 'transferencia', 'outro')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'confirmado', 'cancelado')),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_number ON services(number);
CREATE INDEX IF NOT EXISTS idx_services_client ON services(client_id);
CREATE INDEX IF NOT EXISTS idx_services_date ON services(service_date);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_payment_status ON services(payment_status);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_services" ON services;
CREATE POLICY "select_services" ON services FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_services" ON services;
CREATE POLICY "insert_services" ON services FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_services" ON services;
CREATE POLICY "update_services" ON services FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_services" ON services;
CREATE POLICY "delete_services" ON services FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('entrada', 'saida', 'ajuste', 'estorno', 'saldo_inicial')),
  quantity numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  responsible text DEFAULT '',
  notes text DEFAULT '',
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  reversal_of uuid REFERENCES movements(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_type ON movements(type);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_movements_client ON movements(client_id);
CREATE INDEX IF NOT EXISTS idx_movements_service ON movements(service_id);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_movements" ON movements;
CREATE POLICY "select_movements" ON movements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_movements" ON movements;
CREATE POLICY "insert_movements" ON movements FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_movements" ON movements;
CREATE POLICY "update_movements" ON movements FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_movements" ON movements;
CREATE POLICY "delete_movements" ON movements FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS service_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  quantity numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_materials_service ON service_materials(service_id);
CREATE INDEX IF NOT EXISTS idx_service_materials_product ON service_materials(product_id);

ALTER TABLE service_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_service_materials" ON service_materials;
CREATE POLICY "select_service_materials" ON service_materials FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_service_materials" ON service_materials;
CREATE POLICY "insert_service_materials" ON service_materials FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_service_materials" ON service_materials;
CREATE POLICY "update_service_materials" ON service_materials FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_service_materials" ON service_materials;
CREATE POLICY "delete_service_materials" ON service_materials FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS service_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  action text NOT NULL,
  description text DEFAULT '',
  user_name text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_history_service ON service_history(service_id);

ALTER TABLE service_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_service_history" ON service_history;
CREATE POLICY "select_service_history" ON service_history FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_service_history" ON service_history;
CREATE POLICY "insert_service_history" ON service_history FOR INSERT
  TO authenticated WITH CHECK (true);
