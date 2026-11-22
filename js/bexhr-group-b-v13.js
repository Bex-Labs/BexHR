/* BexHR Group B V13: read-only position presentation and PA chooser guard.
   Scope comes from authenticated, tenant-scoped staging RPC, not broad title reads. */
(function (root) {
  'use strict';
  const id = (v) => String(v == null ? '' : v).trim();
  let scope = {tenant:'',byEmployee:new Map(),loaded:false};
  let pending=null;
  function clear(){scope={tenant:'',byEmployee:new Map(),loaded:false};pending=null;}
  async function loadScope(client, tenant){
    tenant=id(tenant);
    if (!tenant || !client || typeof client.rpc !== 'function'){clear();return false;}
    if (scope.tenant===tenant && scope.loaded) return true;
    if (pending && scope.tenant===tenant) return pending;
    scope={tenant,byEmployee:new Map(),loaded:false};
    const request=(async()=>{
      try {
        const {data,error}=await client.rpc('bexhr_group_b_v13_my_visible_scopes');
        if(error || !Array.isArray(data) || scope.tenant!==tenant)return false;
        const byEmployee=new Map();
        for(const row of data){const key=id(row.employee_id);if(key)byEmployee.set(key,row.position_scope==='organization'?'Whole organisation':null);}
        scope={tenant,byEmployee,loaded:true};
        return true;
      }catch(_){return false;}
    })();
    pending=request;try{return await request;}finally{if(pending===request)pending=null;}
  }
  function display(employee,fallback='--'){
    const source=employee?.raw && typeof employee.raw==='object'?employee.raw:employee;
    const saved=id(employee?.department || source?.department);
    const normal=saved || fallback;
    if(!scope.loaded || !source || id(source.tenant_id)!==scope.tenant)return normal;
    const key=id(source.id);
    return scope.byEmployee.get(key) || normal;
  }
  async function isHighest(client,employee){
    const employeeId=id(employee?.id);
    if(!employeeId || !client || typeof client.rpc!=='function')return false;
    try{const {data,error}=await client.rpc('bexhr_p7b_my_organization_position',{p_employee_id:employeeId});
      return !error&&(data?.status==='CONFIGURED_ROOT'||data?.status==='HIGHEST_OCCUPIED');
    }catch(_){return false;}
  }
  root.BexHRGroupBV13=Object.freeze({loadScope,display,isHighest,clear});
})(window);
