const {test}=require('node:test');const assert=require('node:assert/strict');
const load=require('./helpers/load-typescript.cjs');const ledger=load('lib/ledger.ts');const money=load('lib/money.ts');
const parser=load('lib/telegram-journal.ts',{modules:{'@/lib/money':money}});
const {demoAccounts:accounts}=ledger;
function entry(dr,cr,amount,options={}){return {id:options.id??'test',entry_date:options.date??'2026-10-27',created_at:'2026-10-27T08:00:00Z',entry_type:options.type??'journal',category:'Test',memo:'Test',reversal_of:options.reversal_of??null,reversed_by:null,journal_lines:[{account_id:'demo-'+dr,debit:amount,credit:0},{account_id:'demo-'+cr,debit:0,credit:amount}]}}
test('rupiah parser accepts clear abbreviations and rejects unsafe or ambiguous values',()=>{
  for(const [input,expected]of [['30ribu',30000],['30rb',30000],['30K',30000],['1,5jt',1500000],['1.5 juta',1500000],['Rp 30.000',30000],['30,000',30000],['1miliar',1000000000],['9007199254740991',Number.MAX_SAFE_INTEGER]])assert.equal(money.parseRupiahAmount(input),expected,input);
  for(const input of ['-10','0','1e3','30abc','1.234jt','9007199254740992','Infinity','NaN'])assert.equal(money.parseRupiahAmount(input),null,input);
});
test('bot parses debt, collections, installments, cards and explicit journals with exact amounts',()=>{
  for(const [kind,dr,cr]of [['utang','1000','2000'],['piutang','1100','1000'],['bayar_utang','2000','1000'],['terima_piutang','1000','1100'],['kartu_kredit','5000','2100'],['kartu_debit','5000','1010'],['bayar_kartu','2100','1010'],['transfer','1010','1000'],['modal','1000','3000'],['prive','3000','1000']]){
    const value=parser.parseTelegramJournal(`/catat ${kind} 30ribu Test Catatan`);assert.equal(value.amount,30000);assert.equal(value.debit,dr);assert.equal(value.credit,cr);
  }
  const spaced=parser.parseTelegramJournal('/catat pengeluaran 30 ribu Makanan makan');assert.equal(spaced.amount,30000);assert.equal(spaced.category,'Makanan');assert.equal(spaced.memo,'makan');
  const custom=parser.parseTelegramJournal('/jurnal 1110 1010 1,5jt Piutang Budi');assert.equal(custom.debit,'1110');assert.equal(custom.amount,1500000);
  assert.equal(parser.parseTelegramJournal('/catat pengeluaran 30abc Test'),'invalid_amount');assert.equal(parser.parseTelegramJournal('/catat SKCK 30ribu'),'invalid_format');assert.equal(parser.parseTelegramJournal('/jurnal 1000 1000 30rb Test'),'invalid_format');
});
test('credit purchase and partial repayment count expense once and leave card debt',()=>{
  const entries=[entry('5000','2100',300000,{type:'expense'}),entry('2100','1010',100000,{type:'repay_debt'})];
  const result=ledger.periodSummary(accounts,entries,'2026-10-01','2026-10-31');assert.equal(result.income,0n);assert.equal(result.expense,30000000n);assert.equal(result.cashOut,10000000n);
  assert.equal(ledger.accountBalances(accounts,entries).find(a=>a.code==='2100').balance,20000000n);assert.equal(ledger.balanceSheet(accounts,entries,'2026-10-31').difference,0n);
});
test('borrowing, lending, repayment, capital and own transfers stay outside profit and loss',()=>{
  const entries=[entry('1000','2000',1000000),entry('1100','1000',300000),entry('1000','1100',100000),entry('2000','1000',200000),entry('1010','1000',50000),entry('1000','3000',100000)];
  const result=ledger.periodSummary(accounts,entries,'2026-10-01','2026-10-31');assert.equal(result.income,0n);assert.equal(result.expense,0n);assert.equal(result.cashIn,120000000n);assert.equal(result.cashOut,50000000n);
  const sheet=ledger.balanceSheet(accounts,entries,'2026-10-31');assert.equal(sheet.difference,0n);assert.equal(sheet.liabilities,80000000n);assert.equal(sheet.assets,90000000n);
});
test('multi-line installments separate interest from principal and maintain trial balance',()=>{
  const installment=entry('2000','1010',100000);installment.journal_lines=[{account_id:'demo-2000',debit:100000,credit:0},{account_id:'demo-5000',debit:20000,credit:0},{account_id:'demo-1010',debit:0,credit:120000}];
  assert.equal(ledger.validateJournal(installment.journal_lines),true);const result=ledger.periodSummary(accounts,[installment],'2026-10-01','2026-10-31');assert.equal(result.expense,2000000n);assert.equal(result.cashOut,12000000n);
  const sheet=ledger.balanceSheet(accounts,[installment],'2026-10-31');assert.equal(sheet.trialDebit,sheet.trialCredit);assert.equal(sheet.difference,0n);
});
test('opening balances and their reversals are excluded from period cash flow',()=>{
  const entries=[entry('1000','3000',1000000,{type:'opening',id:'opening'}),entry('3000','1000',1000000,{type:'reversal',reversal_of:'opening'})];
  const result=ledger.periodSummary(accounts,entries,'2026-10-01','2026-10-31');assert.equal(result.cashIn,0n);assert.equal(result.cashOut,0n);assert.equal(result.income,0n);assert.equal(result.expense,0n);
});
test('as-of reporting respects future reversals and aggregates beyond Number.MAX_SAFE_INTEGER exactly',()=>{
  const n=Number.MAX_SAFE_INTEGER;const entries=[entry('1010','4000',n,{id:'a'}),entry('1010','4000',n,{id:'b'}),entry('4000','1010',n,{type:'reversal',date:'2026-11-01',reversal_of:'a'})];
  const result=ledger.balanceSheet(accounts,entries,'2026-10-31');assert.equal(result.assets,BigInt(n)*200n);assert.equal(result.earnings,BigInt(n)*200n);assert.equal(result.difference,0n);
  assert.equal(ledger.accountLedger(accounts.find(a=>a.code==='1010'),entries,'2026-10-31').at(-1).running,BigInt(n)*200n);
  assert.equal(ledger.balanceSheet(accounts,entries,'2026-11-01').assets,BigInt(n)*100n);
});
test('summary balances reject imprecise numeric JSON and accept exact database strings',()=>{assert.equal(money.exactRupiah('18014398509481982'),1801439850948198200n);assert.throws(()=>money.exactRupiah(9007199254740992));});

test('closing journals move profit into equity while the period income statement stays intact',()=>{
  const closing=entry('4000','3000',1000,{type:'closing',id:'closing'});
  closing.journal_lines=[{account_id:'demo-4000',debit:1000,credit:0},{account_id:'demo-5000',debit:0,credit:300},{account_id:'demo-3000',debit:0,credit:700}];
  const entries=[entry('1000','4000',1000),entry('5000','1000',300),closing];
  const sheet=ledger.balanceSheet(accounts,entries,'2026-10-31');assert.equal(sheet.earnings,0n);assert.equal(sheet.equity,70000n);assert.equal(sheet.difference,0n);
  assert.equal(ledger.periodSummary(accounts,entries,'2026-10-01','2026-10-31').income,100000n);
  assert.equal(ledger.incomeStatementEntries(entries,'2026-10-01','2026-10-31').length,2);
  entries.push({...closing,id:'reverse-closing',entry_type:'reversal',reversal_of:'closing',journal_lines:closing.journal_lines.map(l=>({...l,debit:l.credit,credit:l.debit}))});
  const reopened=ledger.periodSummary(accounts,entries,'2026-10-01','2026-10-31');assert.equal(reopened.income,100000n);assert.equal(reopened.expense,30000n);
});
