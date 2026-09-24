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
