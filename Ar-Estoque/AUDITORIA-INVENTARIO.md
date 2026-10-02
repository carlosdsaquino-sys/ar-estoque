# Inventário técnico da auditoria

Gerado a partir das migrations aplicadas em PostgreSQL local/PGlite e dos arquivos atuais. Não descreve o estado do Supabase remoto.

## RPCs chamadas pelo frontend

| Nome | Parâmetros SQL | Retorno | Chamadores | Autenticado | Anônimo |
|---|---|---|---|---|---|
| cancel_service | p_service_id uuid, p_return_materials uuid[] | void | src/pages/Services.tsx | true | false |
| cash_register_history | p_limit integer DEFAULT 90, p_before date DEFAULT NULL::date | jsonb | src/pages/Cash.tsx | true | false |
| cash_register_snapshot | p_cash_register_id uuid DEFAULT NULL::uuid | jsonb | src/pages/Cash.tsx | true | false |
| close_cash_register | p_cash_register_id uuid, p_counted_cash numeric, p_reason text DEFAULT NULL::text | jsonb | src/pages/Cash.tsx | true | false |
| create_product | p_data jsonb, p_code text | uuid | src/pages/Products.tsx | true | false |
| delete_draft_service | p_service_id uuid | void | src/pages/Services.tsx | true | false |
| delete_product | p_product_id uuid | void | src/pages/Products.tsx | true | false |
| delete_service_type | p_service_type_id uuid | void | src/pages/ServiceTypes.tsx | true | false |
| get_product_balance | p_product_id uuid | numeric | src/pages/Movements.tsx, src/pages/Products.tsx | true | false |
| get_product_balances |  | jsonb | src/lib/data.ts | true | false |
| import_products | p_data jsonb | jsonb | src/pages/Import.tsx | true | false |
| maintenance_overview | p_today date | TABLE(service_type_id uuid, client_appliance_id uuid, client_id uuid, client_name text, appliance_name text, appliance_description text, appliance_location text, last_maintenance_date date, next_maintenance_date date, interval_months integer, alert_days integer, days_until integer) | src/context/MaintenanceContext.tsx | true | false |
| open_cash_register | p_register_date date, p_opening_balance numeric | uuid | src/pages/Cash.tsx | true | false |
| permanently_delete_archived_client | p_client_id uuid, p_confirmation_name text | void | src/pages/Clients.tsx | true | false |
| record_cash_movement | p_cash_register_id uuid, p_type text, p_description text, p_amount numeric, p_payment_method text, p_reason text DEFAULT NULL::text | uuid | src/pages/Cash.tsx | true | false |
| record_cash_movement | p_cash_register_id uuid, p_type text, p_description text, p_amount numeric, p_payment_method text, p_reason text, p_request_id uuid | uuid | src/pages/Cash.tsx | true | false |
| register_movement | p_product_id uuid, p_type text, p_quantity numeric, p_unit_cost numeric DEFAULT 0, p_responsible text DEFAULT ''::text, p_notes text DEFAULT ''::text, p_request_id uuid DEFAULT NULL::uuid | uuid | src/pages/Movements.tsx | true | false |
| register_payment | p_service_id uuid, p_payment_date date, p_payment_method text, p_expected_version integer DEFAULT NULL::integer | void | src/pages/Services.tsx | true | false |
| release_product_code_reservation | p_code text | void | src/pages/Products.tsx | true | false |
| reserve_product_code |  | text | src/pages/Products.tsx | true | false |
| reverse_movement | p_movement_id uuid, p_reason text | uuid | src/pages/Movements.tsx | true | false |
| reverse_payment | p_service_id uuid, p_reason text | void | src/pages/Services.tsx | true | false |
| save_appointment | p_id uuid, p_data jsonb, p_appliance_ids uuid[], p_expected_version integer DEFAULT NULL::integer | uuid | src/pages/Appointments.tsx | true | false |
| save_appointment | p_id uuid, p_data jsonb, p_appliance_ids uuid[], p_expected_version integer, p_request_id uuid | uuid | src/pages/Appointments.tsx | true | false |
| save_appointment_service | p_appointment_id uuid, p_service_id uuid, p_data jsonb, p_appliances jsonb, p_confirm boolean, p_request_id uuid, p_expected_version integer DEFAULT NULL::integer | uuid | src/pages/Services.tsx | true | false |
| save_service_visit | p_service_id uuid, p_data jsonb, p_appliances jsonb, p_confirm boolean, p_request_id uuid, p_expected_version integer DEFAULT NULL::integer | uuid | src/pages/Services.tsx | true | false |
| set_client_archived | p_client_id uuid, p_archived boolean | void | src/pages/Clients.tsx | true | false |
| set_user_access | p_user_id uuid, p_role text, p_active boolean | void | src/pages/Users.tsx | true | false |

## Tabelas

| Tabela | RLS | SELECT anônimo | INSERT direto autenticado |
|---|---|---|---|
| appointment_appliances | true | false | false |
| appointments | true | false | false |
| cash_movements | true | false | false |
| cash_registers | true | false | false |
| categories | true | true | true |
| client_appliances | true | false | true |
| clients | true | true | true |
| movements | true | true | false |
| operation_requests | true | false | false |
| performed_services | true | true | false |
| product_code_aliases | true | false | false |
| product_code_reservations | true | false | false |
| products | true | true | false |
| profiles | true | true | false |
| service_appliances | true | true | false |
| service_history | true | true | false |
| service_materials | true | true | false |
| service_payment_events | true | false | false |
| service_types | true | true | true |
| services | true | true | false |
| suppliers | true | true | true |
| units | true | true | true |

## Policies

| Tabela | Policy | Operação | USING | WITH CHECK |
|---|---|---|---|---|
| appointment_appliances | appointment_appliances_read | SELECT | app_member() |  |
| appointments | appointments_read | SELECT | app_member() |  |
| cash_movements | cash_movements_member_read | SELECT | app_member() |  |
| cash_registers | cash_registers_member_read | SELECT | app_member() |  |
| categories | admin_insert | INSERT |  | app_admin() |
| categories | admin_update | UPDATE | app_admin() | app_admin() |
| categories | member_read | SELECT | app_member() |  |
| client_appliances | client_appliances_admin_insert | INSERT |  | app_admin() |
| client_appliances | client_appliances_admin_update | UPDATE | app_admin() | app_admin() |
| client_appliances | client_appliances_member_read | SELECT | app_member() |  |
| clients | admin_insert | INSERT |  | app_admin() |
| clients | admin_update | UPDATE | app_admin() | app_admin() |
| clients | member_read | SELECT | app_member() |  |
| movements | member_read | SELECT | app_member() |  |
| performed_services | performed_services_member_read | SELECT | app_member() |  |
| products | admin_insert | INSERT |  | app_admin() |
| products | admin_update | UPDATE | app_admin() | app_admin() |
| products | member_read | SELECT | app_member() |  |
| profiles | profile_read | SELECT | ((id = auth.uid()) OR app_admin()) |  |
| service_appliances | service_appliances_member_read | SELECT | app_member() |  |
| service_history | member_read | SELECT | app_member() |  |
| service_materials | member_read | SELECT | app_member() |  |
| service_payment_events | service_payment_events_member_read | SELECT | app_member() |  |
| service_types | service_types_admin_insert | INSERT |  | app_admin() |
| service_types | service_types_admin_update | UPDATE | app_admin() | app_admin() |
| service_types | service_types_member_read | SELECT | app_member() |  |
| services | member_read | SELECT | app_member() |  |
| suppliers | admin_insert | INSERT |  | app_admin() |
| suppliers | admin_update | UPDATE | app_admin() | app_admin() |
| suppliers | member_read | SELECT | app_member() |  |
| units | admin_insert | INSERT |  | app_admin() |
| units | admin_update | UPDATE | app_admin() | app_admin() |
| units | member_read | SELECT | app_member() |  |

## Triggers

- appointments: appointments_capture_actor — CREATE TRIGGER appointments_capture_actor BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION capture_appointment_actor()
- appointments: appointments_validate_duration — CREATE TRIGGER appointments_validate_duration BEFORE INSERT OR UPDATE OF duration_minutes ON public.appointments FOR EACH ROW EXECUTE FUNCTION validate_appointment_duration()
- performed_services: performed_services_capture_maintenance — CREATE TRIGGER performed_services_capture_maintenance BEFORE INSERT ON public.performed_services FOR EACH ROW EXECUTE FUNCTION capture_performed_service_maintenance_snapshot()
- products: products_code_guard — CREATE TRIGGER products_code_guard BEFORE INSERT OR UPDATE OF code ON public.products FOR EACH ROW EXECUTE FUNCTION consume_product_code_reservation()
- services: services_authenticated_actor — CREATE TRIGGER services_authenticated_actor BEFORE INSERT OR UPDATE OF technician, technician_id ON public.services FOR EACH ROW EXECUTE FUNCTION set_service_actor()
- services: services_complete_appointment — CREATE TRIGGER services_complete_appointment AFTER UPDATE OF status ON public.services FOR EACH ROW EXECUTE FUNCTION complete_linked_appointment()
- services: services_require_active_client — CREATE TRIGGER services_require_active_client BEFORE INSERT OR UPDATE OF client_id ON public.services FOR EACH ROW EXECUTE FUNCTION guard_active_client_on_service()
- users: app_user_profile — CREATE TRIGGER app_user_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_user_profile()
- users: guard_auth_user_delete — CREATE TRIGGER guard_auth_user_delete BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION guard_auth_user_delete()

## Migrations aplicadas

- 20260922190524_create_core_tables.sql
- 20260922190551_create_services_and_movements.sql
- 20260922190615_create_db_functions.sql
- 20260922200000_integrity_and_access.sql
- 20260923120000_authenticated_movement_responsible.sql
- 20260923140000_service_appliances_and_types.sql
- 20260924100000_service_technician_and_appliance_count.sql
- 20260924103000_service_technician_text.sql
- 20260924110000_delete_unused_service_types.sql
- 20260924120000_client_archive_and_permanent_delete.sql
- 20260924130000_secure_user_deletion.sql
- 20260924140000_standardize_product_codes.sql
- 20260928100000_permanent_product_deletion.sql
- 20260928120000_cash_register.sql
- 20260928130000_permanent_service_type_deletion.sql
- 20260928140000_preserve_cash_events_on_client_delete.sql
- 20260930100000_preventive_maintenance.sql
- 20261001180000_appointments.sql
- 20261001190000_service_actor_and_appointment_hours.sql
- 20261002100000_audit_integrity.sql

## Arquivos inventariados

- src/App.tsx (108 linhas)
- src/components/AppLayout.tsx (788 linhas)
- src/components/DailyAlertsPopup.tsx (34 linhas)
- src/components/DialogProvider.tsx (219 linhas)
- src/components/SearchableSelect.tsx (191 linhas)
- src/components/ui.tsx (246 linhas)
- src/context/AppointmentsContext.tsx (47 linhas)
- src/context/AuthContext.tsx (271 linhas)
- src/context/MaintenanceContext.tsx (99 linhas)
- src/context/ThemeContext.tsx (41 linhas)
- src/index.css (232 linhas)
- src/lib/appointments.ts (56 linhas)
- src/lib/data.ts (18 linhas)
- src/lib/maintenance.ts (19 linhas)
- src/lib/overlays.ts (12 linhas)
- src/lib/profit.ts (39 linhas)
- src/lib/routes.ts (44 linhas)
- src/lib/supabase.ts (210 linhas)
- src/lib/utils.ts (118 linhas)
- src/main.tsx (11 linhas)
- src/pages/Appointments.tsx (145 linhas)
- src/pages/AuthPage.tsx (243 linhas)
- src/pages/Cash.tsx (470 linhas)
- src/pages/Clients.tsx (530 linhas)
- src/pages/Dashboard.tsx (314 linhas)
- src/pages/Import.tsx (296 linhas)
- src/pages/Maintenance.tsx (155 linhas)
- src/pages/Movements.tsx (446 linhas)
- src/pages/Products.tsx (526 linhas)
- src/pages/Reports.tsx (536 linhas)
- src/pages/Services.tsx (1339 linhas)
- src/pages/ServiceTypes.tsx (158 linhas)
- src/pages/Users.tsx (40 linhas)
- src/vite-env.d.ts (2 linhas)
