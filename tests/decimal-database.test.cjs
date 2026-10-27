const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const A='30000000-0000-4000-8000-000000000001',B='30000000-0000-4000-8000-000000000002';
let db,oldEntry;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const file of ['202610250001_initial_schema.sql','202610260001_usernames.sql','202610260002_security_hardening.sql','202610270001_double_entry_ledger.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query("insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')",[A,B]);
  oldEntry=await scalar("insert into transactions(user_id,kind,amount,category,description,transaction_date) values($1,'income',3681341,'Gaji','Existing salary','2026-10-27') returning id as result",[A]);
  await db.exec(readFileSync('supabase/migrations/202610270002_decimal_amounts.sql','utf8'));
});
after(async()=>{await db?.close()});
async function scalar(sql,args=[]){return(await db.query(sql,args)).rows[0].result}
async function as(role,user,sql,args=[]){
  await db.exec('begin;set local role '+role);
  try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);const r=await db.query(sql,args);await db.exec('commit');return r.rows[0]?.result}
  catch(e){await db.exec('rollback');throw e}
}
async function account(code,user=A){return scalar('select id as result from ledger_accounts where user_id=$1 and code=$2',[user,code])}
async function post(amount,options={}){
  const lines=options.lines??[{account_id:await account('1010'),debit:amount,credit:0},{account_id:await account('4000'),debit:0,credit:amount}];
  return as('authenticated',A,"select post_journal('2026-10-27','Decimal test',$1::jsonb,'income','Gaji',$2) as result",[JSON.stringify(lines),options.request??null]);
}
test('upgrade preserves old rupiah values and exact read columns',async()=>{
  assert.equal(await scalar('select amount::text as result from transactions where id=$1',[oldEntry]),'3681341');
  assert.equal(await scalar('select debit_exact as result from journal_lines where debit>0'),'3681341');
});
test('salary decimals survive posting, exact transport, reversal and idempotent retry',async()=>{
  const id=await post('3681341.75',{request:'40000000-0000-4000-8000-000000000001'});
  assert.equal(await post('3681341.75',{request:'40000000-0000-4000-8000-000000000001'}),id);
  assert.equal(await scalar('select debit_exact as result from journal_lines where entry_id=$1 and debit>0',[id]),'3681341.75');
  const reversed=await as('authenticated',A,"select reverse_journal($1,'2026-10-27') as result",[id]);
  assert.equal(await scalar('select credit_exact as result from journal_lines where entry_id=$1 and credit>0',[reversed]),'3681341.75');
  await assert.rejects(()=>post('3681341.74',{request:'40000000-0000-4000-8000-000000000001'}));
});
test('decimal split 0.10 + 0.20 = 0.30 balances; sub-cent values and 1-cent differences fail',async()=>{
  const dr=await account('1010'),cr=await account('4000');
  await post(0,{lines:[{account_id:dr,debit:'0.10',credit:0},{account_id:dr,debit:'0.20',credit:0},{account_id:cr,debit:0,credit:'0.30'}]});
  for(const amount of ['0.001','1.999','NaN','Infinity','1e3','9007199254740991.01'])await assert.rejects(()=>post(amount));
  await assert.rejects(()=>post(0,{lines:[{account_id:dr,debit:'0.10',credit:0},{account_id:cr,debit:0,credit:'0.11'}]}));
  await post('9007199254740990.99');
});
test('opening balances and custom accounts accept two decimals, reject extra precision atomically',async()=>{
  const id=await as('authenticated',A,"select create_ledger_account('1021','Decimal Bank','asset','bank',1234.56,'2026-01-01') as result");
  assert.equal(await scalar('select sum(debit-credit)::text as result from journal_lines where account_id=$1',[id]),'1234.56');
  const args=[await account('1100'),'0.75'];
  const opening=await as('authenticated',A,"select record_opening_balance($1,$2::numeric,'2026-01-01') as result",args);
  assert.equal(await as('authenticated',A,"select record_opening_balance($1,$2::numeric,'2026-01-01') as result",args),opening);
  await assert.rejects(()=>as('authenticated',A,"select create_ledger_account('1022','Invalid','asset','bank',1.001,'2026-01-01') as result"));
  assert.equal(await scalar("select count(*)::int as result from ledger_accounts where code='1022'"),0);
});
test('Telegram accepts decimal principal, preserves exact totals and keeps current-owner authorization',async()=>{
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,303)',[A]);
  const sql="select post_telegram_journal(303,30001,'2026-10-27','Decimal debt','borrow','Utang','1010','2000',100.75) as result";
  assert.equal((await as('service_role',null,sql)).status,'posted');
  assert.equal((await as('service_role',null,sql)).status,'duplicate');
  const report=await as('service_role',null,"select telegram_ledger_summary(303,'2026-10-01','2026-11-01') as result");
  assert.equal(report.accounts.find(a=>a.code==='2000').balance,'100.75');
  assert.equal(typeof report.income,'string');
  assert.equal(report.income,'9007199258422332.29');
  await assert.rejects(()=>as('authenticated',A,sql),e=>e.code==='42501');
  await assert.rejects(()=>as('anon',null,sql),e=>e.code==='42501');
  await as('authenticated',A,'select disconnect_telegram() as result');
  assert.equal((await as('service_role',null,sql)).status,'unlinked');
});
test('legacy receipt and text paths preserve decimals without weakening RLS or write privileges',async()=>{
  const id=await as('authenticated',A,"insert into transactions(user_id,kind,amount,category,description,transaction_date) values($1,'expense',12.75,'Food','Decimal legacy','2026-10-27') returning id as result",[A]);
  assert.equal(await scalar('select l.debit_exact as result from journal_lines l join journal_entries e on e.id=l.entry_id where e.legacy_transaction_id=$1 and l.debit>0',[id]),'12.75');
  await as('authenticated',A,'update transactions set amount=12.25 where id=$1 returning id as result',[id]);
  await assert.rejects(()=>as('authenticated',A,'update transactions set amount=12.251 where id=$1 returning id as result',[id]));
  assert.equal(await as('authenticated',B,'select count(*)::int as result from journal_lines where user_id=$1',[A]),0);
  await assert.rejects(()=>as('authenticated',A,'update journal_lines set debit=100'),e=>e.code==='42501');
  for(const name of ['record_opening_balance','create_ledger_account','post_telegram_journal'])assert.equal(await scalar('select count(*)::int as result from pg_proc where proname=$1',[name]),1);
});

test('confirmed decimal receipts reach the journal exactly and cannot be confirmed by another chat',async()=>{
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,303)',[A]);
  const pending=await scalar("insert into pending_receipts(user_id,chat_id,telegram_update_id,merchant,amount,transaction_date,confidence,expires_at) values($1,303,30002,'Decimal Shop',45.75,'2026-10-27',90,now()+interval '10 minutes') returning id as result",[A]);
  assert.equal(await scalar('select amount_exact as result from pending_receipts where id=$1',[pending]),'45.75');
  assert.equal(await as('service_role',null,'select confirm_pending_receipt($1,304) as result',[pending]),'invalid');
  assert.equal(await as('service_role',null,'select confirm_pending_receipt($1,303) as result',[pending]),'confirmed');
  assert.equal(await scalar('select amount::text as result from transactions where telegram_update_id=30002'),'45.75');
  assert.equal(await scalar('select l.debit_exact as result from journal_lines l join journal_entries e on e.id=l.entry_id where e.telegram_update_id=30002 and l.debit>0'),'45.75');
  const foreign=await account('4000',B);
  await assert.rejects(()=>post(0,{lines:[{account_id:foreign,debit:'0.75',credit:0},{account_id:foreign,debit:0,credit:'0.75'}]}),e=>e.code==='42501');
});
