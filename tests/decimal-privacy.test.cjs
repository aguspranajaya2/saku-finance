const {test}=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-typescript.cjs'),mount=require('./helpers/mount-hook-provider.cjs');
const money=load('lib/money.ts'),ledger=load('lib/ledger.ts'),parser=load('lib/telegram-journal.ts');

test('decimal rupiah accepts both locales and returns canonical exact values without rounding',()=>{
  for(const input of ['3681341.75','3681341,75','3.681.341,75','3,681,341.75','Rp3.681.341,75'])assert.equal(money.parseRupiahAmount(input),'3681341.75',input);
  for(const [input,value]of [['0.01','0.01'],['0,75','0.75'],['1,2','1.20'],['30.000,00',30000],['1.000,00',1000],['1.0001',null],['1.2345jt',null],['1e2',null],['1,234.567',null],['9007199254740990.99','9007199254740990.99'],['9007199254740991.01',null]])assert.equal(money.parseRupiahAmount(input),value,input);
  assert.throws(()=>money.exactRupiah(0.75)); // JSON decimals must use text, not binary floats.
});
test('formatting preserves hundredths, negative sub-rupiah values and very large totals',()=>{
  assert.equal(money.formatRupiah(368134175n,'id').replace(/\s/g,''),'Rp3.681.341,75');
  assert.equal(money.formatRupiah(368134175n,'en').replace(/\s/g,''),'IDR3,681,341.75');
  assert.equal(money.formatRupiah(-75n,'id').replace(/\s/g,''),'-Rp0,75');
  assert.match(money.formatRupiah(1801439850948198199n,'en'),/18,014,398,509,481,981\.99/);
  assert.equal(money.formatRupiah(368134175n,'id',true),'IDR ••••••');
  assert.equal(money.formatRupiah(-75n,'en',true),'IDR ••••••');
});
test('journal split and reports calculate hundredths exactly, including reversal and debt',()=>{
  const lines=[{account_id:'demo-1010',debit:'0.10',credit:0},{account_id:'demo-1010',debit:'0.20',credit:0},{account_id:'demo-4000',debit:0,credit:'0.30'}];
  assert.equal(ledger.validateJournal(lines),true);
  const entry={id:'decimal',entry_date:'2026-10-27',created_at:'2026-10-27T00:00:00Z',entry_type:'income',reversal_of:null,journal_lines:lines};
  const result=ledger.balanceSheet(ledger.demoAccounts,[entry],'2026-10-27');assert.equal(result.assets,30n);assert.equal(result.earnings,30n);assert.equal(result.difference,0n);
  assert.equal(ledger.validateJournal([...lines.slice(0,2),{...lines[2],credit:'0.31'}]),false);
  assert.equal(ledger.validateJournal(lines.map(l=>({...l,debit:l.debit==='0.10'?'0.001':l.debit}))),false);
  const reversed={...entry,id:'reversed',entry_type:'reversal',reversal_of:'decimal',journal_lines:lines.map(l=>({...l,debit:l.credit,credit:l.debit}))};
  assert.equal(ledger.balanceSheet(ledger.demoAccounts,[entry,reversed],'2026-10-27').assets,0n);
  assert.equal(parser.parseTelegramJournal('/catat pemasukan 3681341.75 gaji gaji bulanan').amount,'3681341.75');
});
test('privacy loads hidden by default, persists toggles, and survives blocked browser storage',()=>{
  const storage=new Map(),localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
  function create(localStorage){return mount('lib/preferences.tsx','PreferencesProvider',{}, {window:{localStorage},document:{documentElement:{dataset:{}}}})}
  const app=create(localStorage);
  assert.equal(app.value().amountsHidden,true);app.value().toggleAmounts();assert.equal(app.value().amountsHidden,false);assert.equal(storage.get('saku-amounts-hidden'),'false');app.dispose();
  const restored=create(localStorage);assert.equal(restored.value().amountsHidden,false);restored.value().toggleAmounts();assert.equal(restored.value().amountsHidden,true);restored.dispose();
  const blocked=create({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});assert.equal(blocked.value().amountsHidden,true);blocked.value().toggleAmounts();assert.equal(blocked.value().amountsHidden,false);blocked.dispose();
});
test('receipt parsing preserves decimal totals and does not truncate malformed precision',()=>{
  const receipt=load('lib/receipts/parse.ts');
  for(const value of ['3.681.341,75','3,681,341.75','3681341.75'])assert.equal(receipt.parseReceipt('Example Shop\nTOTAL Rp '+value,95).amount,'3681341.75');
  assert.equal(receipt.parseReceipt('Example Shop\nTOTAL Rp 12345.6789',95).amount,null);
});
