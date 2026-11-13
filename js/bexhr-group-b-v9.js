/* BEXHR_GROUP_B_V9: Generic tenant-scoped replacement of current highest organisational position.
 * Adds one action to EXISTING Reporting Lines; never changes employees, PA, Leave or payroll.
 * Backend enforces tenant HR Admin role, atomic path reversal and exactly one hierarchy root.
 */
(() => {
 'use strict';
 const doc=document, root=window;
 const el=id=>doc.getElementById(id);
 const str=v=>String(v==null?'':v).trim();
 let snapshot=null, busy=false;
 const isActive=r=>str(r?.status||'active').toLowerCase()==='active';
 function view(){
   const child=el('bexhrH6CChild'), button=el('bexhrGroupBV9Promote'), text=el('bexhrGroupBV9Result');
   if(!child||!button||!text)return;
   const s=snapshot, selected=str(child.value);
   const position=(s?.positions||[]).find(p=>str(p.id)===selected && str(p.tenant_id)===str(s.tenantId));
   const roots=(s?.links||[]).filter(l=>str(l.tenant_id)===str(s?.tenantId) && !str(l.reports_to_job_title_id));
   const existing=(s?.positions||[]).find(p=>str(p.id)===str(roots[0]?.job_title_id));
   const eligible=Boolean(s && s.canMaintain && position && isActive(position) && roots.length===1 && existing && selected!==str(existing.id));
   button.hidden=!eligible;button.disabled=!eligible||busy;
   if(eligible && !busy){button.textContent='Make selected position highest';text.textContent='Moves '+str(position.job_title)+' above the current highest position ('+str(existing.job_title)+'). Changes only reporting positions.';}
   else if(!busy && text.dataset.state!=='saved')text.textContent='';
 }
 async function refresh(){
   if(typeof root.refreshOrganizationHrSetupValues!=='function')return false;
   await root.refreshOrganizationHrSetupValues();return true;
 }
 async function promote(){
   const child=el('bexhrH6CChild'), button=el('bexhrGroupBV9Promote'), output=el('bexhrGroupBV9Result');
   if(busy||!snapshot||!snapshot.canMaintain||!child||!button||!output)return;
   const s=snapshot, tenant=str(s.tenantId), positionId=str(child.value);
   const p=(s.positions||[]).find(row=>str(row.id)===positionId&&str(row.tenant_id)===tenant);
   const roots=(s.links||[]).filter(row=>str(row.tenant_id)===tenant&&!str(row.reports_to_job_title_id));
   const rootPos=(s.positions||[]).find(row=>str(row.id)===str(roots[0]?.job_title_id));
   if(!p||!isActive(p)||roots.length!==1||!rootPos||str(rootPos.id)===positionId)return;
   const approved=root.confirm('Make "'+p.job_title+'" the highest organisational position?\n\nThe current reporting chain will be safely reversed so there remains only one highest position.\n\nEmployee Primary Managers, PA, Leave and payroll are unchanged.');
   if(!approved)return;
   const client=root.supabaseClient;
   if(!client||typeof client.rpc!=='function'){output.textContent='Staging connection unavailable. Nothing was saved.';return;}
   busy=true;button.disabled=true;button.textContent='Saving position...';output.dataset.state='';
   try{
     // Read back current records before write to detect stale tabs and tenant switches.
     const [jobs,links]=await Promise.all([
       client.from('organization_job_titles').select('id,tenant_id,job_title,status').eq('tenant_id',tenant),
       client.from('organization_job_title_hierarchy').select('tenant_id,job_title_id,reports_to_job_title_id').eq('tenant_id',tenant)
     ]);
     if(jobs.error||links.error||!Array.isArray(jobs.data)||!Array.isArray(links.data))throw Error('Unable to verify the current reporting structure. No change was submitted.');
     const current=jobs.data.find(row=>str(row.id)===positionId&&isActive(row));
     const currentRoots=links.data.filter(row=>!str(row.reports_to_job_title_id));
     if(!current||currentRoots.length!==1||str(currentRoots[0].job_title_id)!==str(rootPos.id))throw Error('Reporting structure has changed. Refresh Organisation Setup and review again.');
     const result=await client.rpc('bexhr_bc_v9_promote_existing_highest',{p_position_id:positionId});
     if(result.error)throw result.error;
     if(result.data?.success!==true||str(result.data.highest_position_id)!==positionId)throw Error('The server did not confirm the change. Refresh and verify before retrying.');
     const check=await client.from('organization_job_title_hierarchy').select('job_title_id,reports_to_job_title_id').eq('tenant_id',tenant);
     const savedRoots=Array.isArray(check.data)?check.data.filter(row=>!str(row.reports_to_job_title_id)):[];
     if(check.error||savedRoots.length!==1||str(savedRoots[0].job_title_id)!==positionId)throw Error('Saved but refresh verification is uncertain. Do not retry without reviewing the records.');
     output.textContent='Saved: '+str(p.job_title)+' is now the highest position. Updating the page...';output.dataset.state='saved';
     await refresh();
     output.textContent='Saved: '+str(p.job_title)+' is now the highest position. Reporting Lines refreshed.';
   }catch(error){output.textContent=str(error?.message)||'Unable to save position change.';output.dataset.state='error';}
   finally{busy=false;button.textContent='Make selected position highest';view();}
 }
 function mount(){
   const host=el('bexhrH6CManualPositionEditor'),child=el('bexhrH6CChild');
   if(!host||!child||el('bexhrGroupBV9Promote'))return;
   const wrap=doc.createElement('div');wrap.id='bexhrGroupBV9Panel';wrap.className='mt-3';
   const button=doc.createElement('button');button.type='button';button.id='bexhrGroupBV9Promote';button.className='btn btn-outline-primary btn-sm';button.hidden=true;button.disabled=true;
   button.textContent='Make selected position highest';
   const message=doc.createElement('p');message.id='bexhrGroupBV9Result';message.className='small text-secondary mt-2 mb-0';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
   wrap.append(button,message);host.append(wrap);
   child.addEventListener('change',()=>{message.dataset.state='';view();});
   button.addEventListener('click',promote);
   root.addEventListener('bexhr:organization-setup-updated',event=>{
     const d=event?.detail||{},s=d.hierarchyPreview;
     snapshot=d.loaded===true&&d.canMaintain===true&&s?.tenantId
       ? {...s,canMaintain:true}:null;
     message.dataset.state='';view();
   });
   view();
 }
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
