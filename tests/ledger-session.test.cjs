const {test}=require('node:test');const assert=require('node:assert/strict');
const load=require('./helpers/load-typescript.cjs'),mount=require('./helpers/mount-hook-provider.cjs');
const tick=()=>new Promise(r=>setTimeout(r,10));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
function books(user){return{accounts:[{id:user+'-cash',code:'1000',name:'Cash',account_type:'asset',role:'cash'},{id:user+'-revenue',code:'4000',name:'Revenue',account_type:'revenue',role:'general'}],entries:[{id:user+'-entry',journal_lines:[]}]}}
function journal(user){return{date:'2026-10-27',memo:'Test',type:'income',category:'Test',requestId:'20000000-0000-4000-8000-000000000001',lines:[{account_id:user+'-cash',debit:100,credit:0},{account_id:user+'-revenue',debit:0,credit:100}]}}
function harness(){
  const window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';let user={id:'A'},callback,inside=false;const reads=[],writes=[];
  const client={auth:{getUser:async()=>{assert.equal(inside,false);return{data:{user},error:null}},onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){callback=null}}}}}},rpc(name,args){const r={name,args,...deferred()};writes.push(r);return r.promise}};
  const router={replace(){}};
  const app=mount('components/ledger-provider.tsx','LedgerProvider',{'next/navigation':{useRouter:()=>router},'@/lib/supabase/client':{createClient:()=>client},'@/lib/ledger':load('lib/ledger.ts'),
    '@/lib/verified-session':load('lib/verified-session.ts',{globals:{window,document}}),'@/lib/ledger-client':{readLedger(client,owner,current){const r={owner,current,...deferred()};reads.push(r);return r.promise}}
  },{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test'}}});
  return{...app,reads,writes,change(id){user=id?{id}:null;inside=true;try{callback(id?'SIGNED_IN':'SIGNED_OUT',user?{user}:null)}finally{inside=false}},focus(){window.dispatchEvent(new Event('focus'))}};
}
test('ledger account switches clear both charts and journals and reject late old-owner reads',async()=>{
  const app=harness();try{await tick();app.change('B');assert.equal(app.value().accounts.length,0);assert.equal(app.value().entries.length,0);await tick();app.reads[1].resolve(books('B'));await tick();app.reads[0].resolve(books('A'));await tick();assert.equal(app.value().accounts[0].id,'B-cash');assert.equal(app.value().entries[0].id,'B-entry')}finally{app.dispose()}
});
test('late journal posts from A cannot refresh B or reset its posting state',async()=>{
  const app=harness();try{await tick();app.reads[0].resolve(books('A'));await tick();const a=app.value().postJournal(journal('A'));await tick();app.change('B');await tick();app.reads[1].resolve(books('B'));await tick();const b=app.value().postJournal(journal('B'));await tick();app.writes[0].resolve({data:'a-post',error:null});assert.equal(await a,false);assert.equal(app.value().saving,true);assert.equal(app.reads.length,2);app.writes[1].resolve({data:'b-post',error:null});await tick();app.reads[2].resolve(books('B'));assert.equal(await b,true);assert.equal(app.value().saving,false);assert.equal(app.value().entries[0].id,'B-entry')}finally{app.dispose()}
});
test('focus, sign-out and missing schema clear private ledger state',async()=>{
  const app=harness();try{await tick();app.reads[0].resolve(books('A'));await tick();app.focus();assert.equal(app.value().accounts.length,0);await tick();app.reads[1].reject({code:'42P01'});await tick();assert.equal(app.value().error,'migration');assert.equal(app.value().entries.length,0);app.change(null);assert.equal(app.value().accounts.length,0)}finally{app.dispose()}
});
test('a committed journal is not reported as failed when the view refresh fails',async()=>{
  const app=harness();try{await tick();app.reads[0].resolve(books('A'));await tick();const saved=app.value().postJournal(journal('A'));await tick();app.writes[0].resolve({data:'committed',error:null});await tick();app.reads[1].reject(Error('network'));assert.equal(await saved,true);assert.equal(app.value().error,'connection');assert.equal(app.writes.length,1)}finally{app.dispose()}
});
test('ledger reading paginates past 1000 entries and stops old-session loads',async()=>{
  const ledger=load('lib/ledger.ts'),{readLedger}=load('lib/ledger-client.ts',{modules:{'@/lib/ledger':ledger}});const ranges=[];
  const client={from(table){return {
    select(){return this}, eq(column,owner){assert.equal(column,'user_id');assert.equal(owner,'A');return this}, order(){return this},
    range(start,end){ranges.push({table,start,end});return Promise.resolve({error:null,data:table==='ledger_accounts'?books('A').accounts:Array.from({length:start===0?1000:2},(_,i)=>({id:String(start+i),journal_lines:journal('A').lines}))})}
  };}};
  const result=await readLedger(client,'A',()=>true);assert.equal(result.entries.length,1002);assert.equal(ranges.filter(r=>r.table==='journal_entries').length,2);
  const stopped=await readLedger(client,'A',()=>false);assert.equal(stopped,null);
});

test('ledger loads refresh an account created mid-read and refuse incomplete account data',async()=>{
  const ledger=load('lib/ledger.ts'),{readLedger}=load('lib/ledger-client.ts',{modules:{'@/lib/ledger':ledger}});
  for(const recover of [true,false]){
    let accountReads=0;
    const client={from(table){return{select(){return this},eq(){return this},order(){return this},range(){
      if(table==='ledger_accounts'){accountReads++;return Promise.resolve({data:recover&&accountReads>1?books('A').accounts:books('A').accounts.slice(0,1),error:null})}
      return Promise.resolve({data:[{id:'new-entry',journal_lines:journal('A').lines}],error:null});
    }}}};
    if(recover)assert.equal((await readLedger(client,'A',()=>true)).accounts.length,2);
    else await assert.rejects(()=>readLedger(client,'A',()=>true),/Incomplete account data/);
    assert.equal(accountReads,2);
  }
});
test('an empty posting result never acknowledges a journal as saved',async()=>{
  const app=harness();try{await tick();app.reads[0].resolve(books('A'));await tick();const saved=app.value().postJournal(journal('A'));await tick();app.writes[0].resolve({data:null,error:null});assert.equal(await saved,false);assert.equal(app.value().error,'migration');assert.equal(app.reads.length,1)}finally{app.dispose()}
});
