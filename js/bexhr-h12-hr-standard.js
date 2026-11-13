/* BexHR H12 Gate 4 RC3 - intentionally minimal and read-only.
 * No full HR Dashboard script is loaded on this page. All permissions are
 * verified through server-side tenant/MFA scoped RPCs on every request. */
(() => {
  'use strict';
  const status = document.getElementById('status');
  const content = document.getElementById('content');
  const client = () => window.supabaseClient;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.className = error ? 'error' : 'good';
  };
  const text = value => value == null ? '' : String(value);
  const table = (id, rows, fields) => {
    const target = document.getElementById(id);
    if (!rows.length) {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = 'No records available.';
      target.replaceChildren(p); return;
    }
    const t = document.createElement('table');
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    fields.forEach(([key,label]) => { const th = document.createElement('th'); th.scope='col'; th.textContent=label; hrow.append(th); });
    thead.append(hrow); t.append(thead);
    const body = document.createElement('tbody');
    rows.forEach(row => {
      const tr=document.createElement('tr');
      fields.forEach(([key]) => { const td=document.createElement('td');td.textContent=text(row[key]);tr.append(td); });
      body.append(tr);
    });
    t.append(body);target.replaceChildren(t);
  };
  const read = async name => {
    const {data,error} = await client().rpc(name);
    if(error) throw new Error(name + ': ' + (error.message || 'Access denied'));
    if(!Array.isArray(data)) throw new Error(name + ': invalid server response');
    return data;
  };
  async function start(){
    try {
      // SessionManager handles inactive accounts / first-time password checks.
      const session = await window.SessionManager.getSession();
      if(!session?.user?.id) { window.location.replace('index.html?message=session-expired'); return; }
      const {data:profile,error:profileErr}=await client().from('profiles')
        .select('id,role,tenant_id,is_active,must_change_password').eq('id',session.user.id).single();
      if(profileErr || !profile?.tenant_id || profile.is_active !== true) throw new Error('Active tenant profile required');
      if(profile.must_change_password === true) {window.location.replace('reset-password.html');return;}
      // AAL2 verified by the authority RPC, never by a browser-stored flag.
      const {data:ent,error:entErr}=await client().rpc('bexhr_h12_workspace_entitlements');
      if(entErr || ent?.can_enter_hr !== true || ent?.hr_grant_present !== true ||
          String(profile.role).toLowerCase() !== 'manager') throw new Error('An explicit HR Standard grant and MFA are required');
      // Server calls each revalidate MFA, tenant, active status and entitlement.
      const [dir,report,leave]=await Promise.all([
        read('bexhr_h12_hr_standard_directory'),
        read('bexhr_h12_hr_standard_reporting_summary'),
        read('bexhr_h12_hr_standard_processed_leave')
      ]);
      table('directory',dir,[['employee_number','Employee #'],['full_name','Name'],['department','Department'],['job_title','Position'],['employment_status','Status']]);
      table('reporting',report,[['employee_id','Employee ID'],['manager_employee_id','Manager ID'],['manager_type','Reporting type'],['status','Status']]);
      table('leave',leave,[['request_id','Request ID'],['employee_id','Employee ID'],['status','Decision'],['decision_at','Date'],['decision_by_name','Decided by']]);
      content.hidden=false;
      setStatus('Verified HR Standard workspace · read only');
    }catch(e){
      content.hidden=true;
      setStatus('HR Standard access unavailable: ' + (e?.message||'Unknown error'),true);
    }
  }
  document.addEventListener('DOMContentLoaded',start,{once:true});
})();
