const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const name of ['202610250001_initial_schema.sql','202610260001_usernames.sql','202610260002_security_hardening.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  await db.query(`insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')`,[A,B]);
  await db.query(`insert into public.transactions(user_id,kind,amount,category,description,transaction_date) values($1,'income',8000000,'Gaji','Old salary','2026-10-01')`,[A]);
  await db.exec(readFileSync('supabase/migrations/202610270001_double_entry_ledger.sql','utf8'));
});
after(async()=>{await db?.close()});
async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0].result}
async function asRole(role,user,sql,args=[]){
  await db.exec(`begin;set local role ${role}`);
  try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);const r=await db.query(sql,args);await db.exec('commit');return r.rows}
  catch(e){await db.exec('rollback');throw e}
}
async function account(code,user=A){return scalar('select id as result from ledger_accounts where user_id=$1 and code=$2',[user,code])}
async function post(dr,cr,amount=10000,options={}){
  const lines=options.lines??[{account_id:await account(dr,options.user??A),debit:amount,credit:0},{account_id:await account(cr,options.user??A),debit:0,credit:amount}];
  return (await asRole('authenticated',options.user??A,'select post_journal($1,$2,$3::jsonb,$4,$5,$6) as result',[
    options.date??'2026-10-27',options.memo??'Synthetic ledger test',JSON.stringify(lines),options.type??'journal','Test',options.request??null]))[0].result;
}
async function balance(code,user=A){return Number(await scalar(`select coalesce(sum(l.debit-l.credit),0) as result from ledger_accounts a left join journal_lines l on l.account_id=a.id where a.user_id=$1 and a.code=$2`,[user,code]))}
test('migration backfills existing cash records once and seeds eight accounts per user',async()=>{
  assert.equal(Number(await scalar('select count(*) as result from ledger_accounts')),16);
  assert.equal(Number(await scalar('select count(*) as result from journal_entries')),1);
  assert.equal(await balance('1000'),8000000);
  assert.equal(await balance('4000'),-8000000);
});
test('new signup receives a private chart of accounts',async()=>{
  const c='10000000-0000-4000-8000-000000000003';await db.query("insert into auth.users(id,email) values($1,'c@example.invalid')",[c]);
  assert.equal(Number(await scalar('select count(*) as result from ledger_accounts where user_id=$1',[c])),8);
});
test('unbalanced, empty, zero, fractional, unsafe and single-account journals cannot commit',async()=>{
  const dr=await account('1000'),cr=await account('4000');
  for(const lines of [[],[{account_id:dr,debit:1,credit:0}],
    [{account_id:dr,debit:100,credit:0},{account_id:cr,debit:0,credit:99}],
    [{account_id:dr,debit:1.5,credit:0},{account_id:cr,debit:0,credit:1.5}],
    [{account_id:dr,debit:0,credit:0},{account_id:cr,debit:0,credit:0}],
    [{account_id:dr,debit:9007199254740992,credit:0},{account_id:cr,debit:0,credit:9007199254740992}],
    [{account_id:dr,debit:1,credit:0},{account_id:dr,debit:0,credit:1}]
  ])await assert.rejects(()=>post('1000','4000',1,{lines}));
});
test('multi-line journal posts atomically and idempotently with immutable stored lines',async()=>{
  const lines=[{account_id:await account('5000'),debit:120,credit:0},{account_id:await account('5000'),debit:30,credit:0},{account_id:await account('1010'),debit:0,credit:150}];
  const request='20000000-0000-4000-8000-000000000001';const entry=await post(null,null,0,{lines,request});
  assert.equal(await post(null,null,0,{lines,request}),entry);
  await assert.rejects(()=>post(null,null,0,{lines,request,memo:'Changed payload'}));
  assert.equal(Number(await scalar('select count(*) as result from journal_lines where entry_id=$1',[entry])),3);
  for(const [table,column]of [['ledger_accounts','name'],['journal_entries','memo'],['journal_lines','debit']]){
    await assert.rejects(()=>asRole('authenticated',A,`delete from ${table}`),e=>e.code==='42501');
    await assert.rejects(()=>asRole('authenticated',A,`update ${table} set ${column}=${table==='journal_lines'?'1':"'Forged'"}`),e=>e.code==='42501');
  }
});
test('RLS isolates headers, lines and accounts; journals cannot reference another owner account',async()=>{
  const foreign=await account('4000',B);
  await assert.rejects(async()=>post(null,null,0,{lines:[{account_id:await account('1000'),debit:1,credit:0},{account_id:foreign,debit:0,credit:1}]}),e=>e.code==='42501');
  for(const table of ['ledger_accounts','journal_entries','journal_lines']){
    const rows=await asRole('authenticated',B,`select * from ${table} where user_id=$1`,[A]);assert.equal(rows.length,0);
    await assert.rejects(()=>asRole('anon',null,`select * from ${table}`),e=>e.code==='42501');
  }
  await assert.rejects(()=>asRole('authenticated',A,"select _seed_ledger_accounts($1)",[B]),e=>e.code==='42501');
  await assert.rejects(()=>asRole('authenticated',A,"select post_telegram_journal(1,1,current_date,'x','journal','x','1000','4000',1)"),e=>e.code==='42501');
});
test('borrowing, lending and partial settlements affect the correct balance-sheet accounts',async()=>{
  const cash=await balance('1000'),payable=await balance('2000'),receivable=await balance('1100'),revenue=await balance('4000'),expense=await balance('5000');
  await post('1000','2000',1000000,{type:'borrow'});await post('2000','1000',250000,{type:'repay_debt'});
  await post('1100','1000',200000,{type:'lend'});await post('1000','1100',50000,{type:'collect_receivable'});
  assert.equal(await balance('2000'),payable-750000);assert.equal(await balance('1100'),receivable+150000);
  assert.equal(await balance('1000'),cash+600000);assert.equal(await balance('4000'),revenue);assert.equal(await balance('5000'),expense);
});
test('credit purchase followed by card repayment does not double-count expenses',async()=>{
  const expense=await balance('5000'),card=await balance('2100'),cash=await balance('1010');
  await post('5000','2100',300000,{type:'expense'});await post('2100','1010',100000,{type:'repay_debt'});
  assert.equal(await balance('5000'),expense+300000);assert.equal(await balance('2100'),card-200000);assert.equal(await balance('1010'),cash-100000);
});
test('own-account transfers and capital contributions leave income and expenses unchanged',async()=>{
  const total=await balance('1000')+await balance('1010'),income=await balance('4000'),expense=await balance('5000');
  await post('1010','1000',100000,{type:'transfer'});assert.equal(await balance('1000')+await balance('1010'),total);
  await post('1000','3000',500000);assert.equal(await balance('4000'),income);assert.equal(await balance('5000'),expense);
});
test('reversal preserves history, swaps lines once and cannot reverse another owner journal',async()=>{
  const before=await balance('5000');const entry=await post('5000','1010',12345,{type:'expense'});
  await assert.rejects(()=>asRole('authenticated',B,'select reverse_journal($1,$2)',[entry,'2026-10-27']),e=>e.code==='42501');
  await assert.rejects(()=>asRole('authenticated',A,'select reverse_journal($1,$2)',[entry,'2026-10-26']));
  const reversal=(await asRole('authenticated',A,'select reverse_journal($1,$2) as result',[entry,'2026-10-27']))[0].result;
  assert.equal((await asRole('authenticated',A,'select reverse_journal($1,$2) as result',[entry,'2026-10-27']))[0].result,reversal);
  assert.equal(await balance('5000'),before);assert.equal(await scalar('select reversal_of as result from journal_entries where id=$1',[reversal]),entry);
});
test('account opening balances post against equity and rollback on invalid input',async()=>{
  const equity=await balance('3000');
  await asRole('authenticated',A,'select create_ledger_account($1,$2,$3,$4,$5,$6)',['1020','Tabungan','asset','bank',2000000,'2026-10-27']);
  assert.equal(await balance('1020'),2000000);assert.equal(await balance('3000'),equity-2000000);
  await assert.rejects(()=>asRole('authenticated',A,'select create_ledger_account($1,$2,$3,$4,$5,$6)',['4010','Salary','revenue','general',1000,'2026-10-27']));
  assert.equal(Number(await scalar("select count(*) as result from ledger_accounts where code='4010'")),0);
});
test('legacy receipt and text inserts, edits and deletes retain balanced audit history',async()=>{
  const initial=await balance('5000');
  const id=await scalar(`insert into transactions(user_id,kind,amount,category,description,transaction_date,source,telegram_update_id)
    values($1,'expense',10000,'Food','Legacy receipt','2026-10-27','receipt',9900) returning id as result`,[A]);
  assert.equal(await balance('5000'),initial+10000);
  await asRole('authenticated',A,'update transactions set amount=12000 where id=$1',[id]);assert.equal(await balance('5000'),initial+12000);
  await asRole('authenticated',A,'delete from transactions where id=$1',[id]);assert.equal(await balance('5000'),initial);
  assert.equal(Number(await scalar('select count(*) as result from journal_entries where legacy_transaction_id=$1',[id])),2);
});
test('Telegram posting derives the current owner, rejects unknown accounts, and deduplicates updates',async()=>{
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,101)',[A]);
  const sql="select post_telegram_journal(101,$1,'2026-10-27','Bot loan','borrow','Utang',$2,$3,30000) as result";
  assert.equal((await asRole('service_role',null,sql,[10001,'1000','2000']))[0].result.status,'posted');
  assert.equal((await asRole('service_role',null,sql,[10001,'1000','2000']))[0].result.status,'duplicate');
  assert.equal((await asRole('service_role',null,sql,[10002,'9999','2000']))[0].result.status,'invalid_account');
  await asRole('authenticated',A,'select disconnect_telegram()');
  assert.equal((await asRole('service_role',null,sql,[10003,'1000','2000']))[0].result.status,'unlinked');
});
test('trial balance stays equal and removing a user cascades without corrupting other books',async()=>{
  const totals=await db.query('select sum(debit) as debit,sum(credit) as credit from journal_lines where user_id=$1',[A]);assert.equal(totals.rows[0].debit,totals.rows[0].credit);
  const other=Number(await scalar('select count(*) as result from ledger_accounts where user_id=$1',[A]));
  await db.query('delete from auth.users where id=$1',[B]);assert.equal(Number(await scalar('select count(*) as result from ledger_accounts where user_id=$1',[B])),0);
  assert.equal(Number(await scalar('select count(*) as result from ledger_accounts where user_id=$1',[A])),other);
});

test('opening an existing default account is owner-bound, dated before activity and idempotent',async()=>{
  const cash=await account('1000');
  const args=[cash,5000,'2026-01-01'];
  const id=(await asRole('authenticated',A,'select record_opening_balance($1,$2,$3) as result',args))[0].result;
  assert.equal((await asRole('authenticated',A,'select record_opening_balance($1,$2,$3) as result',args))[0].result,id);
  await assert.rejects(()=>asRole('authenticated',B,'select record_opening_balance($1,$2,$3)',args),e=>e.code==='42501');
  await assert.rejects(()=>asRole('authenticated',A,'select record_opening_balance($1,6000,$2)',[cash,'2026-01-01']));
  const bank=await account('1010');
  await assert.rejects(()=>asRole('authenticated',A,"select record_opening_balance($1,1000,'2026-11-01')",[bank]));
});
test('deferred database constraints catch a privileged accidental unbalanced insert at commit',async()=>{
  await db.exec('begin');
  try{
    const id=await scalar("insert into journal_entries(user_id,entry_date,memo,source) values($1,'2026-10-27','Invalid privileged journal','web') returning id as result",[A]);
    await db.query('insert into journal_lines(user_id,entry_id,account_id,line_no,debit,credit) values($1,$2,$3,1,100,0),($1,$2,$4,2,0,99)',[A,id,await account('1000'),await account('4000')]);
    await assert.rejects(()=>db.exec('commit'),e=>e.code==='23514');
  }finally{await db.exec('rollback')}
  assert.equal(Number(await scalar("select count(*) as result from journal_entries where memo='Invalid privileged journal'")),0);
});
test('legacy corrections remain correct at their historical effective date and deleted updates stay deduplicated',async()=>{
  const id=await scalar("insert into transactions(user_id,kind,amount,category,description,transaction_date,source,telegram_update_id) values($1,'expense',10000,'Test','Historical correction','2026-09-01','telegram',19900) returning id as result",[A]);
  await asRole('authenticated',A,'update transactions set amount=20000 where id=$1',[id]);
  const oldDate=await scalar("select sum(l.debit-l.credit) as result from journal_lines l join journal_entries e on e.id=l.entry_id join ledger_accounts a on a.id=l.account_id where a.user_id=$1 and a.code='5000' and e.entry_date<='2026-09-01'",[A]);
  assert.equal(Number(oldDate),20000);
  await asRole('authenticated',A,'delete from transactions where id=$1',[id]);
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,101)',[A]);
  const retry=await asRole('service_role',null,"select post_telegram_journal(101,19900,'2026-10-27','Duplicate old update','journal','Test','5000','1000',10000) as result");
  assert.equal(retry[0].result.status,'duplicate');
});
test('Telegram summary returns exact large totals and excludes opening cash movements',async()=>{
  const amount=Number.MAX_SAFE_INTEGER;await post('1010','4000',amount,{type:'income'});await post('1010','4000',amount,{type:'income'});
  const result=(await asRole('service_role',null,"select telegram_ledger_summary(101,'2026-10-01','2026-11-01') as result"))[0].result;
  assert.equal(typeof result.income,'string');assert.ok(BigInt(result.income)>BigInt(Number.MAX_SAFE_INTEGER));
  const exact=await scalar("select sum(l.credit-l.debit) as result from journal_lines l join journal_entries e on e.id=l.entry_id join ledger_accounts a on a.id=l.account_id where a.user_id=$1 and a.account_type='revenue' and e.entry_date>='2026-10-01' and e.entry_date<'2026-11-01'",[A]);
  assert.equal(BigInt(result.income),BigInt(exact));
  assert.ok(result.accounts.every(a=>typeof a.balance==='string'));
  assert.equal((await asRole('service_role',null,"select telegram_ledger_summary(999,'2026-10-01','2026-11-01') as result"))[0].result,null);
});
test('closing journals zero temporary accounts without erasing period profit in the bot summary',async()=>{
  const owner='10000000-0000-4000-8000-000000000004';await db.query("insert into auth.users(id,email) values($1,'d@example.invalid')",[owner]);
  await post('1000','4000',1000,{user:owner,type:'income'});await post('5000','1000',300,{user:owner,type:'expense'});
  await assert.rejects(()=>post('1000','3000',1,{user:owner,type:'closing'}));
  const lines=[{account_id:await account('4000',owner),debit:1000,credit:0},{account_id:await account('5000',owner),debit:0,credit:300},{account_id:await account('3000',owner),debit:0,credit:700}];
  const closed=await post(null,null,0,{user:owner,type:'closing',lines});assert.equal(await balance('4000',owner),0);assert.equal(await balance('5000',owner),0);
  await db.query('insert into telegram_connections(user_id,chat_id) values($1,404)',[owner]);
  for(const reverse of [false,true]){
    if(reverse)await asRole('authenticated',owner,"select reverse_journal($1,'2026-10-27')",[closed]);
    const report=(await asRole('service_role',null,"select telegram_ledger_summary(404,'2026-10-01','2026-11-01') as result"))[0].result;
    assert.equal(report.income,'1000');assert.equal(report.expense,'300');
  }
});
test('deleting an owner with legacy links, reversals, and journals cascades all private books',async()=>{
  const c='10000000-0000-4000-8000-000000000003';
  await db.query('delete from auth.users where id=$1',[A]);
  for(const table of ['ledger_accounts','journal_entries','journal_lines'])assert.equal(Number(await scalar(`select count(*) as result from ${table} where user_id=$1`,[A])),0);
  assert.equal(Number(await scalar('select count(*) as result from ledger_accounts where user_id=$1',[c])),8);
});
