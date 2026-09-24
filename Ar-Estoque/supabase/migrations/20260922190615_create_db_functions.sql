/*
# Create database functions for atomic operations

1. New Functions
- get_product_balance(p_product_id): returns current stock balance
- register_movement(...): atomic movement with stock validation
- confirm_service(p_service_id): confirms service and deducts materials atomically
- register_payment(...): records payment for a service
- cancel_service(...): cancels service with selective material return
- reverse_movement(...): creates estorno linked to original movement
- import_products(...): bulk import from spreadsheet with deduplication
2. Security
- All functions SECURITY DEFINER for atomic operations
3. Notes
- Stock validation prevents negative balances
- Service confirmation is atomic (all-or-nothing)
- Import preserves codes, skips duplicates
*/

CREATE OR REPLACE FUNCTION get_product_balance(p_product_id uuid)
RETURNS numeric AS $$
DECLARE
  bal numeric;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO bal
  FROM movements
  WHERE product_id = p_product_id;
  RETURN bal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION register_movement(
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT 0,
  p_responsible text DEFAULT '',
  p_notes text DEFAULT '',
  p_client_id uuid DEFAULT NULL,
  p_service_id uuid DEFAULT NULL,
  p_reversal_of uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_balance numeric;
  v_adjusted_qty numeric;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO v_balance
  FROM movements WHERE product_id = p_product_id;

  IF p_type = 'saida' THEN
    IF p_quantity > v_balance THEN
      RAISE EXCEPTION 'Saldo insuficiente. Disponível: %, Solicitado: %', v_balance, p_quantity;
    END IF;
    v_adjusted_qty := -p_quantity;
  ELSIF p_type = 'entrada' THEN
    v_adjusted_qty := p_quantity;
  ELSIF p_type = 'saldo_inicial' THEN
    v_adjusted_qty := p_quantity;
  ELSIF p_type = 'ajuste' THEN
    v_adjusted_qty := p_quantity;
  ELSIF p_type = 'estorno' THEN
    v_adjusted_qty := p_quantity;
  ELSE
    RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_type;
  END IF;

  INSERT INTO movements (id, product_id, type, quantity, unit_cost, responsible, notes, client_id, service_id, reversal_of, created_by)
  VALUES (gen_random_uuid(), p_product_id, p_type, v_adjusted_qty, p_unit_cost, p_responsible, p_notes, p_client_id, p_service_id, p_reversal_of, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION confirm_service(p_service_id uuid)
RETURNS void AS $$
DECLARE
  v_service RECORD;
  v_material RECORD;
  v_balance numeric;
BEGIN
  SELECT * INTO v_service FROM services WHERE id = p_service_id;

  IF v_service.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Serviço não está em rascunho';
  END IF;

  FOR v_material IN SELECT * FROM service_materials WHERE service_id = p_service_id LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_balance
    FROM movements WHERE product_id = v_material.product_id;

    IF v_material.quantity > v_balance THEN
      RAISE EXCEPTION 'Saldo insuficiente para o produto %. Disponível: %, Necessário: %', v_material.product_id, v_balance, v_material.quantity;
    END IF;
  END LOOP;

  FOR v_material IN SELECT * FROM service_materials WHERE service_id = p_service_id LOOP
    INSERT INTO movements (id, product_id, type, quantity, unit_cost, responsible, notes, client_id, service_id, created_by)
    VALUES (gen_random_uuid(), v_material.product_id, 'saida', -v_material.quantity, v_material.unit_cost, v_service.technician, 'Serviço #' || v_service.number, v_service.client_id, p_service_id, auth.uid());
  END LOOP;

  UPDATE services SET status = 'confirmado', updated_at = now() WHERE id = p_service_id;

  INSERT INTO service_history (service_id, action, description, user_name)
  VALUES (p_service_id, 'confirmacao', 'Serviço confirmado e materiais baixados do estoque', auth.uid()::text);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION register_payment(
  p_service_id uuid,
  p_payment_date date,
  p_payment_method text
)
RETURNS void AS $$
DECLARE
  v_service RECORD;
BEGIN
  SELECT * INTO v_service FROM services WHERE id = p_service_id;

  IF v_service.status <> 'confirmado' THEN
    RAISE EXCEPTION 'Apenas serviços confirmados podem receber pagamento';
  END IF;

  UPDATE services
  SET payment_status = 'pago',
      payment_date = p_payment_date,
      payment_method = p_payment_method,
      updated_at = now()
  WHERE id = p_service_id;

  INSERT INTO service_history (service_id, action, description, user_name)
  VALUES (p_service_id, 'pagamento',
    'Pagamento registrado: ' || p_payment_method || ' em ' || p_payment_date::text,
    auth.uid()::text);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cancel_service(
  p_service_id uuid,
  p_return_materials uuid[]
)
RETURNS void AS $$
DECLARE
  v_service RECORD;
  v_material RECORD;
BEGIN
  SELECT * INTO v_service FROM services WHERE id = p_service_id;

  IF v_service.status = 'cancelado' THEN
    RAISE EXCEPTION 'Serviço já está cancelado';
  END IF;

  IF v_service.status = 'confirmado' THEN
    FOR v_material IN SELECT * FROM service_materials WHERE service_id = p_service_id LOOP
      IF v_material.id = ANY(p_return_materials) THEN
        INSERT INTO movements (id, product_id, type, quantity, unit_cost, responsible, notes, client_id, service_id, created_by)
        VALUES (gen_random_uuid(), v_material.product_id, 'estorno', v_material.quantity, v_material.unit_cost,
          v_service.technician, 'Estorno - Cancelamento serviço #' || v_service.number,
          v_service.client_id, p_service_id, auth.uid());
      END IF;
    END LOOP;
  END IF;

  UPDATE services SET status = 'cancelado', updated_at = now() WHERE id = p_service_id;

  INSERT INTO service_history (service_id, action, description, user_name)
  VALUES (p_service_id, 'cancelamento', 'Serviço cancelado', auth.uid()::text);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reverse_movement(
  p_movement_id uuid,
  p_reason text
)
RETURNS uuid AS $$
DECLARE
  v_original RECORD;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_original FROM movements WHERE id = p_movement_id;

  IF v_original IS NULL THEN
    RAISE EXCEPTION 'Movimentação não encontrada';
  END IF;

  IF v_original.type = 'estorno' THEN
    RAISE EXCEPTION 'Não é possível estornar um estorno';
  END IF;

  IF EXISTS (SELECT 1 FROM movements WHERE reversal_of = p_movement_id) THEN
    RAISE EXCEPTION 'Movimentação já foi estornada';
  END IF;

  INSERT INTO movements (id, product_id, type, quantity, unit_cost, responsible, notes, client_id, service_id, reversal_of, created_by)
  VALUES (gen_random_uuid(), v_original.product_id, 'estorno', -v_original.quantity, v_original.unit_cost,
    v_original.responsible, 'Estorno: ' || p_reason,
    v_original.client_id, v_original.service_id, p_movement_id, auth.uid())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION import_products(p_data jsonb)
RETURNS jsonb AS $$
DECLARE
  v_row jsonb;
  v_product_id uuid;
  v_category_id uuid;
  v_unit_id uuid;
  v_supplier_id uuid;
  v_existing uuid;
  v_errors text[] := ARRAY[]::text[];
  v_imported integer := 0;
  v_skipped integer := 0;
  v_code text;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    v_code := v_row->>'code';
    IF v_code IS NULL OR v_code = '' THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_existing FROM products WHERE code = v_code LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_category_id FROM categories WHERE name = v_row->>'category' LIMIT 1;
    IF v_category_id IS NULL AND v_row->>'category' IS NOT NULL AND v_row->>'category' <> '' THEN
      INSERT INTO categories (name) VALUES (v_row->>'category') RETURNING id INTO v_category_id;
    END IF;

    SELECT id INTO v_unit_id FROM units WHERE name = v_row->>'unit' LIMIT 1;
    IF v_unit_id IS NULL AND v_row->>'unit' IS NOT NULL AND v_row->>'unit' <> '' THEN
      INSERT INTO units (name) VALUES (v_row->>'unit') RETURNING id INTO v_unit_id;
    END IF;

    SELECT id INTO v_supplier_id FROM suppliers WHERE name = v_row->>'supplier' LIMIT 1;
    IF v_supplier_id IS NULL AND v_row->>'supplier' IS NOT NULL AND v_row->>'supplier' <> '' THEN
      INSERT INTO suppliers (name) VALUES (v_row->>'supplier') RETURNING id INTO v_supplier_id;
    END IF;

    INSERT INTO products (id, code, category_id, name, unit_id, brand, supplier_id, min_stock, unit_cost, unit_price, notes, is_active)
    VALUES (
      gen_random_uuid(), v_code, v_category_id, v_row->>'name', v_unit_id,
      COALESCE(v_row->>'brand', ''), v_supplier_id,
      COALESCE((v_row->>'min_stock')::numeric, 0),
      COALESCE((v_row->>'unit_cost')::numeric, 0),
      COALESCE((v_row->>'unit_price')::numeric, 0),
      COALESCE(v_row->>'notes', ''), true
    )
    RETURNING id INTO v_product_id;

    IF COALESCE((v_row->>'stock')::numeric, 0) > 0 THEN
      INSERT INTO movements (id, product_id, type, quantity, unit_cost, responsible, notes, created_by)
      VALUES (gen_random_uuid(), v_product_id, 'saldo_inicial',
        (v_row->>'stock')::numeric,
        COALESCE((v_row->>'unit_cost')::numeric, 0),
        'Importação', 'Saldo inicial - Importação de planilha', auth.uid()
      );
    END IF;

    v_imported := v_imported + 1;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'errors', v_errors);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
