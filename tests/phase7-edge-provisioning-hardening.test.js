#!/usr/bin/env node
'use strict';
/* Phase 7A11: exact-source runtime mock + SQL tenant isolation regression.
 * The embedded JavaScript is compiled from the exact Edge TypeScript SHA below.
 * No Supabase network calls, credentials, repository writes, or external packages.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vm = require('node:vm');
const ROOT = process.env.BEXHR_PHASE7A11_TEST_ROOT || path.resolve(__dirname,'..');
const EDGE_SHA = 'C03360847DA36B87D88E2D025DE52D259F3D6A06B0F0E2181E5829140FDE064D';
const EDGE_BUNDLE = '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';
function sha(x){return crypto.createHash('sha256').update(x).digest('hex').toUpperCase();}
const edge = fs.readFileSync(path.join(ROOT,'supabase/functions/invite-employee-login/index.ts'));
assert.equal(sha(edge),EDGE_SHA,'Phase 7A11 invite source changed; update runtime mock before deployment');
const sql = fs.readFileSync(path.join(ROOT,'supabase/migrations/20261101190500_phase7_lean_offboarding.sql'),'utf8').replace(/\r\n?/g,'\n');
const offboard=sql.split('create or replace function public.hr_offboard_employee(')[1]?.split('comment on function public.hr_offboard_employee')[0];
const reactivate=sql.split('create or replace function public.hr_reactivate_employee(')[1]?.split('comment on function public.hr_reactivate_employee')[0];
for (const part of [offboard,reactivate]) {
 assert(part && part.includes('reporting_subject.tenant_id = v_tenant_id'), 'Offboarding could modify a different company\'s legacy reporting row');
 assert(!/delete\s+from\s+public\.(employees|employee_reporting_lines|payroll_records|payroll_master_records)/i.test(part),'History deletion introduced');
}
assert(sql.includes('create or replace function bexhr_private.phase7_manager_in_child_tenant('));
assert(sql.includes('manager.tenant_id = child.tenant_id'));
assert((sql.match(/phase7_manager_in_child_tenant\(employee_id, manager_employee_id\)/g)||[]).length===2);
assert(sql.includes('phase45b_tenant_scope_payroll_records') && sql.includes('phase45b_tenant_scope_payroll_master_records'));
assert(!/drop policy[^;]*phase45b_/i.test(sql));
assert(!edge.toString('utf8').includes('callerProfileByEmail'), 'Caller email fallback reintroduced');
assert(edge.toString('utf8').includes('callerProfile.is_active !== true'),'Inactive caller can send invites');
assert(edge.toString('utf8').includes('profile.is_active !== true'),'Disabled invite user can be reenabled');
assert(!edge.toString('utf8').includes('req.headers.get("origin")'),'Untrusted redirect origin reintroduced');
const compiled = zlib.inflateSync(Buffer.from(EDGE_BUNDLE,'base64')).toString('utf8');

function initFixture(options={}){
 const data = {
   profiles: [{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'}],
   employees: [{id:'employee-a',tenant_id:'tenant-a',work_email:'employee@tenant-a.invalid',status:'Active',user_id:null,system_role:'employee'}],
 };
 if (options.profiles) data.profiles=structuredClone(options.profiles);
 if (options.employees) data.employees=structuredClone(options.employees);
 const metrics={invites:[],recoveries:[],authLookups:0,linkWrites:0};
 class Query {
   constructor(table){this.table=table;this.filters=[];this.payload=null;this.mode='read';}
   select(_columns){
     if(this.mode==='update') {
       const rows=this.matches();for(const x of rows) Object.assign(x,this.payload);
       metrics.linkWrites+=rows.length;
       return Promise.resolve({data:structuredClone(rows),error:null});
     }
     return this;
   }
   eq(k,v){this.filters.push(x=>x[k]===v);return this;}
   is(k,v){this.filters.push(x=>x[k]===v);return this;}
   matches(){return (data[this.table]||[]).filter(x=>this.filters.every(f=>f(x)));}
   maybeSingle(){const matches=this.matches();return Promise.resolve({data:matches.length===1?structuredClone(matches[0]):null,error:matches.length>1?{message:'multiple rows'}:null});}
   limit(n){return Promise.resolve({data:structuredClone(this.matches().slice(0,n)),error:null});}
   update(payload){this.mode='update';this.payload=payload;return this;}
   upsert(payload){
     const rows=data[this.table];const i=rows.findIndex(x=>x.id===payload.id);
     if(i>=0)Object.assign(rows[i],payload);else rows.push({...payload});
     return Promise.resolve({error:null});
   }
 }
 const service = {
   from(name){return new Query(name);},
   auth:{admin:{
     async inviteUserByEmail(email, opts){metrics.invites.push({email,opts});return options.inviteAlreadyExists?{data:null,error:{message:'User already registered'}}:{data:{user:{id:options.newAuthId||'target-auth'}},error:null};},
     async listUsers(){metrics.authLookups++;return {data:{users: options.authUsers||[{id:'target-auth',email:'employee@tenant-a.invalid'}]},error:null};},
   }, async resetPasswordForEmail(email, opts){metrics.recoveries.push({email,opts});return {error:null};}}
 };
 const userClient={auth:{async getUser(){return options.authError?{data:{user:null},error:{message:'invalid jwt'}}:{data:{user:{id:'caller-auth',email:'hr@tenant-a.invalid'}},error:null};}}};
 let handler=null;
 const vmEnv={
   serve(fn){handler=fn;},
   createClient(_url,key){return key==='server-service-key'?service:userClient;},
   Deno:{env:{get(key){return key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'server-service-key':key==='SUPABASE_ANON_KEY'?'client-publishable-key':key==='APP_URL'?('appUrl' in options?options.appUrl:'https://trusted.example'):undefined;}}},
   Request,Response,URL,
   console:{error(){},warn(){},log(){}},
 };
 vm.runInNewContext(compiled,vmEnv,{filename:'tested-phase7a11-edge.js',timeout:1000});
 assert.equal(typeof handler,'function','Edge serve handler not registered');
 async function invoke(body={workEmail:'employee@tenant-a.invalid', fullName:'Test Employee', tenantId:'tenant-a',systemRole:'employee'}){
  const req=new Request('https://test.supabase.co/functions/v1/invite-employee-login',{method:'POST',headers:{Authorization:'Bearer test-jwt', Origin:'https://malicious.example'},body:JSON.stringify(body)});
  const response=await handler(req);
  return {status:response.status,body:await response.json()};
 }
 return {data,metrics,invoke};
}
(async function run(){
 let x=initFixture();let r=await x.invoke();assert.equal(r.status,200);assert.equal(r.body.success,true);
 assert.equal(x.metrics.invites.length,1);assert.equal(x.metrics.invites[0].opts.redirectTo,'https://trusted.example/reset-password.html?mode=first-time');
 assert.equal(x.data.employees[0].user_id,'target-auth');assert.equal(x.data.profiles.find(p=>p.id==='target-auth').is_active,true);

 x=initFixture({profiles:[{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'},{id:'target-auth',email:'employee@tenant-a.invalid',role:'employee',is_active:true,tenant_id:'tenant-a'}],employees:[{id:'employee-a',tenant_id:'tenant-a',work_email:'employee@tenant-a.invalid',status:'Active',user_id:'target-auth'}],inviteAlreadyExists:true});
 r=await x.invoke();assert.equal(r.status,200);assert.equal(r.body.existingAccount,true);assert.equal(x.metrics.recoveries.length,1);

 x=initFixture({employees:[{id:'employee-a',tenant_id:'tenant-a',work_email:'employee@tenant-a.invalid',status:'Exited',user_id:null}]});
 r=await x.invoke();assert.equal(r.status,409);assert.equal(x.metrics.invites.length,0);

 x=initFixture({profiles:[{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'},{id:'target-auth',email:'employee@tenant-a.invalid',role:'hr',is_active:false,tenant_id:'tenant-a'}]});
 r=await x.invoke();assert.equal(r.status,409);assert.equal(x.metrics.invites.length,0);assert.equal(x.data.profiles[1].is_active,false);

 x=initFixture({profiles:[{id:'someone-else',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'}]});
 r=await x.invoke();assert.equal(r.status,403);assert.equal(x.metrics.invites.length,0);

 x=initFixture({profiles:[{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:null,tenant_id:'tenant-a'}]});
 r=await x.invoke();assert.equal(r.status,403);assert.equal(x.metrics.invites.length,0);

 x=initFixture();r=await x.invoke({workEmail:'employee@tenant-a.invalid',fullName:'Employee',tenantId:'tenant-b'});
 assert.equal(r.status,403);assert.equal(x.metrics.invites.length,0);

 x=initFixture({appUrl:''});r=await x.invoke();assert.equal(r.status,500);assert.equal(x.metrics.invites.length,0);

 x=initFixture({profiles:[{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'},{id:'target-auth',email:'employee@tenant-a.invalid',role:'employee',is_active:true,tenant_id:'tenant-b'}]});
 r=await x.invoke();assert.equal(r.status,409);assert.equal(x.metrics.invites.length,0);

 x=initFixture({employees:[{id:'employee-a',tenant_id:'tenant-a',work_email:'employee@tenant-a.invalid',status:'Active',user_id:null},{id:'employee-other',tenant_id:'tenant-b',work_email:'unrelated@tenant-b.invalid',status:'Active',user_id:'target-auth'}],inviteAlreadyExists:true});
 r=await x.invoke();assert.notEqual(r.status,200);assert.equal(x.metrics.linkWrites,0);assert.equal(x.metrics.recoveries.length,0);

 x=initFixture({employees:[{id:'employee-a',tenant_id:'tenant-a',work_email:'employee@tenant-a.invalid',status:'Active',user_id:'different-auth'}],inviteAlreadyExists:true});
 r=await x.invoke();assert.notEqual(r.status,200);assert.equal(x.metrics.linkWrites,0);

 x=initFixture({profiles:[{id:'caller-auth',email:'hr@tenant-a.invalid',role:'hr',is_active:true,tenant_id:'tenant-a'},{id:'another-auth',email:'employee@tenant-a.invalid',role:'employee',is_active:true,tenant_id:'tenant-a'}]});
 r=await x.invoke();assert.notEqual(r.status,200);assert.equal(x.metrics.linkWrites,0);

 console.log('PASS: Phase 7A11 Edge runtime mocks (invite, recovery, disabled, caller-ID, tenant, linkage, trusted redirect) + SQL reporting isolation. No network or DB.');
})().catch(error=>{console.error(error);process.exitCode=1;});
