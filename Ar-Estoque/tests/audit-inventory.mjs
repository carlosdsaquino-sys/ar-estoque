import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated,anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated,anon;`);
const migrations = (await readdir('supabase/migrations')).sort();
for (const migration of migrations) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
// New migration must be safe to reapply without erasing business data.
await db.exec(await readFile('supabase/migrations/20261002100000_audit_integrity.sql', 'utf8'));

const sources = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else if (/\.(tsx?|css)$/.test(path)) sources.push({ path, text: await readFile(path, 'utf8') });
  }
}
await scan('src');
const names = new Map();
for (const source of sources) for (const match of source.text.matchAll(/\.rpc\('([^']+)'/g)) {
  names.set(match[1], [...new Set([...(names.get(match[1]) ?? []), source.path])]);
}
names.set('save_appointment_service', ['src/pages/Services.tsx']);
names.set('save_service_visit', ['src/pages/Services.tsx']);
const functions = (await db.query(`SELECT p.proname AS name, pg_get_function_arguments(p.oid) AS arguments,
pg_get_function_result(p.oid) AS result, p.prosecdef AS definer,
has_function_privilege('authenticated',p.oid,'EXECUTE') AS member_execute,
has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,p.oid`)).rows;
assert.ok(functions.every(fn => !fn.definer || !fn.anon_execute), 'A SECURITY DEFINER function is callable anonymously');
for (const name of names.keys()) {
  const signatures = functions.filter(fn => fn.name === name);
  assert.ok(signatures.length, `Missing frontend RPC: ${name}`);
  assert.ok(signatures.every(fn => fn.member_execute && !fn.anon_execute), `Unsafe RPC permissions: ${name}`);
  assert.ok(signatures.every(fn => fn.definition.includes('require_member') || ['get_product_balance','get_product_balances'].includes(name)), `Missing active-profile guard: ${name}`);
}
const tables = (await db.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
has_table_privilege('authenticated',c.oid,'INSERT') AS direct_insert
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows;
assert.ok(tables.every(table => table.rls), 'A public business table has no RLS');
for (const name of ['movements','services','service_materials','performed_services','service_appliances','appointments','appointment_appliances','cash_movements','cash_registers','service_payment_events']) {
  assert.equal(tables.find(table => table.name === name)?.direct_insert, false, `Direct write: ${name}`);
}
const policies = (await db.query('SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname=\'public\' ORDER BY tablename,policyname')).rows;
const triggers = (await db.query(`SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal ORDER BY c.relname,t.tgname`)).rows;
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
let report = '# Inventário técnico da auditoria\n\nGerado a partir das migrations aplicadas em PostgreSQL local/PGlite e dos arquivos atuais. Não descreve o estado do Supabase remoto.\n\n## RPCs chamadas pelo frontend\n\n| Nome | Parâmetros SQL | Retorno | Chamadores | Autenticado | Anônimo |\n|---|---|---|---|---|---|\n';
for (const fn of functions.filter(fn => names.has(fn.name))) report += `| ${fn.name} | ${escape(fn.arguments)} | ${escape(fn.result)} | ${names.get(fn.name).join(', ')} | ${fn.member_execute} | ${fn.anon_execute} |\n`;
report += '\n## Tabelas\n\n| Tabela | RLS | SELECT anônimo | INSERT direto autenticado |\n|---|---|---|---|\n';
for (const table of tables) report += `| ${table.name} | ${table.rls} | ${table.anon_select} | ${table.direct_insert} |\n`;
report += '\n## Policies\n\n| Tabela | Policy | Operação | USING | WITH CHECK |\n|---|---|---|---|---|\n';
for (const p of policies) report += `| ${p.tablename} | ${p.policyname} | ${p.cmd} | ${escape(p.qual)} | ${escape(p.with_check)} |\n`;
report += '\n## Triggers\n\n';
for (const trigger of triggers) report += `- ${trigger.table_name}: ${trigger.name} — ${trigger.definition}\n`;
report += '\n## Migrations aplicadas\n\n' + migrations.map(name => `- ${name}`).join('\n');
report += '\n\n## Arquivos inventariados\n\n' + sources.map(source => `- ${source.path} (${source.text.split('\n').length} linhas)`).join('\n') + '\n';
await writeFile('AUDITORIA-INVENTARIO.md', report);
await db.close();
console.log(`PASS: ${names.size} frontend RPC names, ${tables.length} RLS tables, ${triggers.length} triggers, ${migrations.length} migrations, ${sources.length} source files; correction migration reapplied.`);
