import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
process.env.TZ='America/Sao_Paulo';
const source=readFileSync('src/lib/utils.ts','utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const u=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
assert.equal(u.formatDate('2026-09-22'),'22/09/2026');
assert.equal(u.formatDate('2026-01-01'),'01/01/2026');
assert.equal(u.parseSpreadsheetNumber('1.234,56'),1234.56);
assert.equal(u.parseSpreadsheetNumber('2,5'),2.5);
assert.equal(u.parseSpreadsheetNumber(12.5),12.5);
assert.equal(u.parseSpreadsheetNumber('R$ 45,90'),45.9);
assert.equal(u.parseSpreadsheetNumber(''),0);
assert.ok(Number.isNaN(u.parseSpreadsheetNumber('inválido')));
assert.equal(u.calculateMargin(10,0),null);
assert.equal(u.getStockStatus(10,10),'COMPRAR');
assert.equal(u.dateBoundary('2026-09-22'),'2026-09-22T03:00:00.000Z');
assert.equal(u.dateBoundary('2026-09-22',true),'2026-09-23T03:00:00.000Z');
assert.equal(u.hasLocalDayChanged('2026-09-24','2026-09-24'),false);
assert.equal(u.hasLocalDayChanged('2026-09-24','2026-09-25'),true);
assert.equal(u.hasLocalDayChanged(null,'2026-09-25'),false);
assert.equal(u.millisecondsUntilNextLocalMidnight(new Date(2026,8,24,23,59,59)),1000);
const ref={current:null};const key=u.operationId(ref,{a:1});assert.equal(u.operationId(ref,{a:1}),key);assert.notEqual(u.operationId(ref,{a:2}),key);
console.log('PASS: 18 assertions for dates, daily session expiry, numeric import, margins, stock and request identifiers.');
const profitSource=readFileSync('src/lib/profit.ts','utf8');
const profitOutput=ts.transpileModule(profitSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const profit=await import('data:text/javascript;base64,'+Buffer.from(profitOutput).toString('base64'));
const profitSummary=profit.summarizeConfirmedProfits([
  {status:'confirmado',payment_status:'pago',total_value:500,discount:0,materials:[
    {quantity:2,unit_cost:10,subtotal:40},
    {quantity:1,unit_cost:40,subtotal:60},
  ]},
  {status:'confirmado',payment_status:'pendente',total_value:300,discount:0,materials:[
    {quantity:1,unit_cost:30,subtotal:50},
  ]},
  {status:'rascunho',payment_status:'pendente',total_value:900,discount:0,materials:[]},
  {status:'cancelado',payment_status:'cancelado',total_value:800,discount:0,materials:[]},
]);
assert.deepEqual(profitSummary,{revenue:800,discounts:0,materialsSold:150,materialCost:90,grossProfit:710,received:500,pending:300});
const discountSummary=profit.summarizeConfirmedProfits([
  {status:'confirmado',payment_status:'pago',total_value:450,discount:50,materials:[{quantity:3,unit_cost:20,subtotal:100}]},
]);
assert.equal(discountSummary.revenue,450);
assert.equal(discountSummary.discounts,50);
assert.equal(discountSummary.grossProfit,390);
console.log('PASS: profit summary covers confirmed services, multi-line material costs, payment states, excluded statuses and applied discounts.');

const appointmentsSource=readFileSync('src/lib/appointments.ts','utf8');
const appointmentsOutput=ts.transpileModule(appointmentsSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const agenda=await import('data:text/javascript;base64,'+Buffer.from(appointmentsOutput).toString('base64'));
assert.equal(agenda.shiftLocalDate('2026-12-31',1),'2027-01-01');
assert.equal(agenda.shiftLocalDate('2026-03-01',-1),'2026-02-28');
assert.deepEqual(agenda.appointmentCounts([
  ...['agendado','confirmado','cancelado','concluido','nao_compareceu'].map(status=>({status,scheduled_date:'2026-10-01'})),
  {status:'confirmado',scheduled_date:'2026-10-02'},
  {status:'cancelado',scheduled_date:'2026-10-02'},
], '2026-10-01'),{todayCount:2,tomorrowCount:1});
assert.deepEqual(agenda.appointmentCounts([],'2026-10-01'),{todayCount:0,tomorrowCount:0});
assert.equal(agenda.dailyAlertsKey('user1','2026-10-01'),'ar-estoque-daily-alerts-user1-2026-10-01');
assert.notEqual(agenda.dailyAlertsKey('user1','2026-10-01'),agenda.dailyAlertsKey('user2','2026-10-01'));
assert.notEqual(agenda.dailyAlertsKey('user1','2026-10-01'),agenda.dailyAlertsKey('user1','2026-10-02'));
console.log('PASS: appointment pending counts, local dates and daily per-user alert keys.');

assert.equal(agenda.durationHoursToMinutes('3'),180);
assert.equal(agenda.durationHoursToMinutes('3,5'),210);
assert.equal(agenda.durationHoursToMinutes('4.5'),270);
assert.equal(agenda.durationHoursToMinutes(''),null);
for (const value of ['0','-1','2.5','abc','Infinity']) assert.throws(()=>agenda.durationHoursToMinutes(value));
assert.equal(agenda.durationMinutesToHours(210),'3,5');
assert.equal(agenda.durationMinutesToHours(60),'1');
assert.equal(agenda.durationMinutesToHours(null),'');
assert.equal(agenda.appointmentEndTime('07:30',180),'10:30');
assert.equal(agenda.appointmentEndTime('07:30',210),'11:00');
assert.equal(agenda.appointmentEndTime('23:30',210),'03:00 (+1 dia)');
assert.equal(agenda.appointmentEndTime('07:30',null),null);
const routesSource=readFileSync('src/lib/routes.ts','utf8');
const routesOutput=ts.transpileModule(routesSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const routes=await import('data:text/javascript;base64,'+Buffer.from(routesOutput).toString('base64'));
assert.equal(routes.routeForPage('services'),'/servicos');
assert.equal(routes.routeForPage('appointments'),'/agendamentos');
assert.equal(routes.pageForLocation('/servicos',null),'services');
assert.equal(routes.pageForLocation('/agendamentos',null),'appointments');
assert.equal(routes.pageForLocation('/',{arEstoquePage:'services'}),'services');
console.log('PASS: duration hours/minutes conversion, minimum, end time and real service routes.');

assert.equal(routes.routeForPage('dashboard'),'/dashboard');
assert.equal(routes.pageForLocation('/dashboard',{arEstoquePage:'profit-report'}),'dashboard');
for (const [path,page] of [['/relatorios/lucros','profit-report'],['/estoque/produtos','products'],['/avisos','maintenance-alerts'],['/agendamentos','appointments']]) {
  assert.equal(routes.pageForLocation(path,null),page);
  assert.equal(routes.pageForLocation(path,{arEstoquePage:'dashboard'}),page);
}
console.log('PASS: dashboard route and URL precedence during session restoration.');

assert.equal(agenda.shiftLocalMonth('2026-10-31',-1),'2026-09-30');
assert.equal(agenda.shiftLocalMonth('2026-01-31',1),'2026-02-28');
assert.equal(agenda.shiftLocalMonth('2028-01-31',1),'2028-02-29');
const overlaysSource=readFileSync('src/lib/overlays.ts','utf8');
const overlaysOutput=ts.transpileModule(overlaysSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const overlays=await import('data:text/javascript;base64,'+Buffer.from(overlaysOutput).toString('base64'));
globalThis.document={body:{style:{overflow:'auto'}}};
const outer=overlays.activateOverlay(); const confirmation=overlays.activateOverlay(100);
assert.equal(overlays.isTopOverlay(outer),false);assert.equal(overlays.isTopOverlay(confirmation),true);
const inner=overlays.activateOverlay();assert.equal(overlays.isTopOverlay(confirmation),true);
overlays.releaseOverlay(outer);assert.equal(document.body.style.overflow,'hidden');
overlays.releaseOverlay(confirmation);assert.equal(overlays.isTopOverlay(inner),true);
overlays.releaseOverlay(inner);assert.equal(document.body.style.overflow,'auto');
delete globalThis.document;
console.log('PASS: month navigation, overlay priority and scroll lock across nested dialogs.');
