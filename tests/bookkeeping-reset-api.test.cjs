const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NextResponse}=require('next/server');
const load=require('./helpers/load-typescript.cjs');
const A='50000000-0000-4000-8000-000000000001',B='50000000-0000-4000-8000-000000000002';
const ID='51000000-0000-4000-8000-0000000000ab';
function setup(options={}){
  let auths=0,verifications=0,signouts=0;const calls=[],quotas=[];
  const api=load('app/api/books/reset/route.ts',{
    modules:{
      'next/server':{NextResponse},
      '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>{auths++;return {data:{user:options.signedOut?null:{id:options.switchUser&&auths>1?B:A,email:'owner@example.invalid'}},error:null};}}})},
      '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:options.nullResult?null:{status:'reset',request_id:args.p_request_id,journals_removed:10},error:options.rpcError??null};}})},
      '@/lib/security-limits':{requestIp:()=> 'test-proxy-ip',consumeSecurityLimits:async(admin,limits)=>{quotas.push(limits);return{allowed:options.allowed!==false,retryAfter:45};}},
      '@supabase/supabase-js':{createClient:(url,key,config)=>{
        assert.equal(url,'https://supabase.example.invalid');assert.equal(config.auth.persistSession,false);assert.equal(config.auth.autoRefreshToken,false);
        return {auth:{signInWithPassword:async({email,password})=>{verifications++;assert.equal(email,'owner@example.invalid');assert.equal(password,'private-test-password');return {data:{user:{id:options.wrongUser?B:A}},error:options.wrongPassword?{status:400,message:'private auth error'}:null};},signOut:async({scope})=>{assert.equal(scope,'local');signouts++;}}};
      }},
    },
    globals:{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://supabase.example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public-key'}}},
  });
  return{api,calls,quotas,auths:()=>auths,verifications:()=>verifications,signouts:()=>signouts};
}
function request(overrides={},headers={}){
  return new Request('https://saku.example/api/books/reset',{method:'POST',headers:{origin:'https://saku.example','content-type':'application/json',...headers},body:JSON.stringify({expectedUserId:A,confirmation:'RESET',password:'private-test-password',requestId:ID,...overrides})});
}
test('reset rejects cross-site and signed-out requests before password checks or deletion',async()=>{
  for(const [options,headers,status]of [[{},{origin:'https://evil.example'},403],[{}, {'sec-fetch-site':'cross-site'},403],[{signedOut:true},{},401]]){
    const app=setup(options);assert.equal((await app.api.POST(request({},headers))).status,status);assert.equal(app.verifications(),0);assert.equal(app.calls.length,0);
  }
});
test('typed confirmation, expected owner, password and request id are all required',async()=>{
  for(const override of [{confirmation:'reset'},{password:''},{requestId:'junk'},{expectedUserId:B}]){
    const app=setup();const response=await app.api.POST(request(override));assert.ok([400,403].includes(response.status));assert.equal(app.calls.length,0);assert.equal(app.verifications(),0);
  }
});
test('wrong password, mismatched password identity, changed session and exhausted quotas never delete books',async()=>{
  for(const options of [{wrongPassword:true},{wrongUser:true},{switchUser:true},{allowed:false}]){
    const app=setup(options);const response=await app.api.POST(request());assert.ok([401,429].includes(response.status));assert.equal(app.calls.length,0);
    if(options.allowed===false){assert.equal(response.headers.get('retry-after'),'45');assert.equal(app.verifications(),0);}
    else assert.equal(app.signouts(),1);
    assert.doesNotMatch(await response.text(),/private auth error|private-test-password/);
  }
});
test('successful reset derives its owner from verified auth, preserves login and returns no credentials',async()=>{
  const app=setup();const response=await app.api.POST(request({userId:B,email:'victim@example.invalid',requestId:ID.toUpperCase()}));
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(app.auths(),2);assert.equal(app.signouts(),1);assert.equal(app.calls[0].name,'reset_user_bookkeeping');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].args)),{p_user_id:A,p_request_id:ID,p_confirmation:'RESET'});
  assert.ok(app.quotas[0].some(limit=>limit.scope==='login-account'&&limit.value==='owner@example.invalid'));
  const text=await response.text();assert.doesNotMatch(text,/password|access_token|refresh_token|victim/);
});
test('missing migration or malformed reset result fails closed and does not claim success',async()=>{
  for(const options of [{rpcError:{code:'PGRST202',message:'private database info'}},{nullResult:true}]){
    const app=setup(options);const response=await app.api.POST(request());assert.equal(response.status,503);assert.equal(app.signouts(),1);
    const text=await response.text();assert.doesNotMatch(text,/"ok":true|private database info/);
  }
});
test('oversized and malformed JSON bodies are rejected without reauthentication',async()=>{
  for(const body of ['{','[]',JSON.stringify({padding:'x'.repeat(9000)})]){
    const app=setup();const response=await app.api.POST(new Request('https://saku.example/api/books/reset',{method:'POST',headers:{origin:'https://saku.example','content-type':'application/json'},body}));
    assert.equal(response.status,400);assert.equal(app.verifications(),0);assert.equal(app.calls.length,0);
  }
});
