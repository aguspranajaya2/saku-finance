const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const A='50000000-0000-4000-8000-000000000001',B='50000000-0000-4000-8000-000000000002';
const RESET='51000000-0000-4000-8000-000000000001',OLD='52000000-0000-4000-8000-000000000001';
let db,pending,legacy,originalAccounts,otherSnapshot;
async function scalar(sql,args=[]){return(await db.query(sql,args)).rows[0]?.result;}
async function as(role,user,sql,args=[]){
  await db.exec('begin;set local role '+role);
  try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);const r=await db.query(sql,args);await db.exec('commit');return r.rows[0]?.result;}
  catch(error){await db.exec('rollback');throw error;}
}
async function post(user,request,amount='11.75'){
  const accounts=(await db.query("select id,code from ledger_accounts where user_id=$1 and code in ('1010','4000') order by code",[user])).rows;
  return as('authenticated',user,"select post_journal('2026-10-31','Reset fixture',$1::jsonb,'income','Gaji',$2) as result",[JSON.stringify([{account_id:accounts[0].id,debit:amount,credit:0},{account_id:accounts[1].id,debit:0,credit:amount}]),request]);
}
async function snapshot(user){
  const result={};
  for(const table of ['transactions','journal_entries','journal_lines','ledger_accounts','pending_receipts','telegram_connections','telegram_pairing_codes','profiles']){
    result[table]=(await db.query('select to_jsonb(t) as data from public.'+table+' t where '+(table==='profiles'?'id':'user_id')+'=$1 order by to_jsonb(t)::text',[user])).rows;
  }
  return JSON.stringify(result);
}
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const file of ['202610250001_initial_schema.sql','202610260001_usernames.sql','202610260002_security_hardening.sql','202610270001_double_entry_ledger.sql','202610270002_decimal_amounts.sql','202610310001_reset_bookkeeping.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.invalid','{\"username\":\"owner_a\"}'),($2,'b@example.invalid','{\"username\":\"owner_b\"}')",[A,B]);
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,501),($2,502)',[A,B]);
  await db.query("insert into telegram_pairing_codes(user_id,code_hash,expires_at) values($1,'reset-a',now()+interval '10 minutes'),($2,'reset-b',now()+interval '10 minutes')",[A,B]);
  legacy=await scalar("insert into transactions(user_id,kind,amount,category,description,transaction_date,source,telegram_update_id) values($1,'expense',23.75,'Food','Legacy reversed','2026-10-31','telegram',50101) returning id as result",[A]);
  const legacyEntry=await scalar('select entry_id as result from legacy_ledger_links where transaction_id=$1',[legacy]);
  await as('authenticated',A,"select reverse_journal($1,'2026-10-31') as result",[legacyEntry]);
  await as('authenticated',A,"select create_ledger_account('1022','My custom bank','asset','bank',500.25,'2026-01-01') as result");
  await post(A,OLD); await post(B,'52000000-0000-4000-8000-000000000002','700.75');
  await as('service_role',null,'select claim_receipt_job(50102,$1,501) as result',[A]);
  pending=await scalar("insert into pending_receipts(user_id,chat_id,telegram_update_id,merchant,amount,transaction_date,confidence,expires_at) values($1,501,50102,'Pending proof',25.25,'2026-10-31',90,now()+interval '10 minutes') returning id as result",[A]);
  originalAccounts=await scalar('select jsonb_agg(to_jsonb(a) order by code) as result from ledger_accounts a where user_id=$1',[A]);
  otherSnapshot=await snapshot(B);
});
after(async()=>{await db?.close();});

test('only the verified server flow may call reset; metadata and direct deletion stay private',async()=>{
  for(const role of ['anon','authenticated']){
    await assert.rejects(()=>as(role,A,"select reset_user_bookkeeping($1,$2,'RESET') as result",[A,RESET]),e=>e.code==='42501');
    for(const table of ['bookkeeping_resets','bookkeeping_retired_keys'])await assert.rejects(()=>as(role,A,'select * from '+table),e=>e.code==='42501');
  }
  await assert.rejects(()=>as('authenticated',A,'delete from journal_entries'),e=>e.code==='42501');
  await assert.rejects(()=>as('authenticated',A,"insert into transactions(user_id,kind,amount,category,description,transaction_date) values($1,'expense',1,'Test','Wrong owner','2026-10-31')",[B]),e=>e.code==='42501');
  await assert.rejects(()=>as('service_role',null,"select reset_user_bookkeeping($1,$2,'reset') as result",[A,RESET]),e=>e.code==='22023');
  assert.ok(await scalar('select count(*)::int as result from journal_entries where user_id=$1',[A])>0);
});
test('any failure rolls back every deletion, connection change and reset receipt',async()=>{
  const before=await snapshot(A);
  await db.exec("create function public.test_reset_failure() returns trigger language plpgsql as $$begin raise exception 'local injected failure';end;$$;create trigger test_reset_failure before delete on public.pending_receipts for each row execute function public.test_reset_failure();");
  try{
    await assert.rejects(()=>as('service_role',null,"select reset_user_bookkeeping($1,'51000000-0000-4000-8000-000000000099','RESET') as result",[A]),/local injected failure/);
    assert.equal(await snapshot(A),before);
    assert.equal(await scalar('select count(*)::int as result from bookkeeping_resets'),0);
    assert.equal(await scalar('select count(*)::int as result from bookkeeping_retired_keys'),0);
  }finally{await db.exec('drop trigger test_reset_failure on public.pending_receipts;drop function public.test_reset_failure();');}
});
test('reset atomically clears only the target books, including reversed legacy, opening balances and pending proof',async()=>{
  const result=await as('service_role',null,"select reset_user_bookkeeping($1,$2,'RESET') as result",[A,RESET]);
  assert.equal(result.status,'reset');assert.equal(result.journals_removed,4);assert.equal(result.transactions_removed,1);assert.equal(result.receipts_removed,1);
  for(const table of ['journal_entries','journal_lines','transactions','pending_receipts','telegram_connections','telegram_pairing_codes'])assert.equal(await scalar('select count(*)::int as result from '+table+' where user_id=$1',[A]),0,table);
  assert.equal(await scalar('select count(*)::int as result from legacy_ledger_links where transaction_id=$1',[legacy]),0);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a) order by code) as result from ledger_accounts a where user_id=$1',[A]),originalAccounts);
  assert.equal(await scalar('select username as result from profiles where id=$1',[A]),'owner_a');
  assert.equal(await scalar('select email as result from auth.users where id=$1',[A]),'a@example.invalid');
  assert.equal(await snapshot(B),otherSnapshot);
});
test('cancelled callbacks and in-flight OCR cannot restore data, including after re-pairing',async()=>{
  assert.equal(await as('service_role',null,'select confirm_pending_receipt($1,501) as result',[pending]),'invalid');
  assert.equal(await scalar('select status as result from receipt_processing_jobs where telegram_update_id=50102'),'done');
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,501)',[A]);
  await assert.rejects(()=>db.query("insert into pending_receipts(user_id,chat_id,telegram_update_id,merchant,amount,transaction_date,confidence,expires_at) values($1,501,50102,'Old worker',25.25,'2026-10-31',90,now()+interval '10 minutes')",[A]),e=>e.code==='40001');
  assert.equal((await as('service_role',null,'select claim_receipt_job(50102,$1,501) as result',[A])).status,'duplicate');
});
test('erased journal and Telegram request keys cannot resurrect old transactions',async()=>{
  await assert.rejects(()=>post(A,OLD),e=>e.code==='40001');
  await assert.rejects(()=>as('service_role',null,"select post_telegram_journal(501,50101,'2026-10-31','Old update','expense','Food','5000','1010',23.75) as result"),e=>e.code==='40001');
  assert.equal(await scalar('select count(*)::int as result from journal_entries where user_id=$1',[A]),0);
});
test('retrying the same reset preserves new journals; a fresh reset still works',async()=>{
  const entry=await post(A,'52000000-0000-4000-8000-000000000003','0.75');
  assert.ok(entry);
  await as('service_role',null,"select reset_user_bookkeeping($1,$2,'RESET') as result",[A,RESET]);
  assert.equal(await scalar('select count(*)::int as result from journal_entries where user_id=$1',[A]),1);
  assert.equal(await scalar('select debit_exact as result from journal_lines where entry_id=$1 and debit>0',[entry]),'0.75');
  await as('service_role',null,"select reset_user_bookkeeping($1,'51000000-0000-4000-8000-000000000002','RESET') as result",[A]);
  assert.equal(await scalar('select count(*)::int as result from journal_entries where user_id=$1',[A]),0);
  assert.equal(await snapshot(B),otherSnapshot);
});
test('fresh receipts after re-pairing post exact new balances, and a different owner cannot reuse a reset id',async()=>{
  await assert.rejects(()=>as('service_role',null,"select reset_user_bookkeeping($1,$2,'RESET') as result",[B,RESET]),e=>e.code==='22023');
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,501)',[A]);
  assert.equal((await as('service_role',null,'select claim_receipt_job(50103,$1,501) as result',[A])).status,'claimed');
  const fresh=await scalar("insert into pending_receipts(user_id,chat_id,telegram_update_id,merchant,amount,transaction_date,confidence,expires_at) values($1,501,50103,'New proof',50.75,'2026-10-31',90,now()+interval '10 minutes') returning id as result",[A]);
  assert.equal(await as('service_role',null,'select confirm_pending_receipt($1,501) as result',[fresh]),'confirmed');
  assert.equal(await scalar('select sum(debit)::text as result from journal_lines where user_id=$1',[A]),'50.75');
  assert.equal(await snapshot(B),otherSnapshot);
});
