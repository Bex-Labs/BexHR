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

  let highestCheck = { key:'', state:'idle', reason:'' };
  let highestCheckSeq = 0;
  let highestSnapshot = null;

  function highestCheckKey(s, selected, existing) {
    const links = (s?.links || [])
      .filter(l => str(l.tenant_id) === str(s?.tenantId))
      .map(l => str(l.job_title_id) + ':' + str(l.reports_to_job_title_id))
      .sort().join(';');

    return [
      str(s?.tenantId),
      selected,
      str(existing?.id),
      links
    ].join('|');
  }

  function runHighestCheck(selected, key) {
    const seq = ++highestCheckSeq;

    highestCheck = { key, state:'checking', reason:'' };

    const client = root.supabaseClient;

    if (!client || typeof client.rpc !== 'function') {
      highestCheck = {
        key,
        state:'blocked',
        reason:'Reporting safety could not be checked. Refresh and retry.'
      };
      return;
    }

    Promise.resolve()
      .then(() => client.rpc(
        'bexhr_p7b_preflight_highest_position',
        { p_position_id:selected }
      ))
      .then(({ data, error }) => {
        if (seq !== highestCheckSeq || highestCheck.key !== key) return;
        if (error) throw error;

        highestCheck = data?.allowed === true
          ? { key, state:'allowed', reason:'' }
          : {
              key,
              state:'blocked',
              reason:str(data?.reason) || 'This hierarchy change is not safe.',
              conflicts: Array.isArray(data?.conflicting_employees) ? data.conflicting_employees : []
            };
      })
      .catch(error => {
        if (seq !== highestCheckSeq || highestCheck.key !== key) return;

        highestCheck = {
          key,
          state:'blocked',
          reason:'Reporting safety could not be verified. Refresh and retry.'
        };

        console.warn('Make Highest safety check failed:', error);
      })
      .finally(() => {
        if (seq === highestCheckSeq) view();
      });
  }
  // BEXHR_R40_REPORTING_LIVE_LINKS
  function renderAffectedEmployeeLinks(message, conflicts) {
    const ids = [...new Set((conflicts || [])
      .map(row => str(row?.employee_id))
      .filter(id =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ))];

    if (!ids.length) return;

    const actions = doc.createElement('div');
    actions.className = 'mt-2';

    ids.forEach((id, index) => {
      const link = doc.createElement('button');

      link.type = 'button';
      link.className = 'btn btn-outline-primary btn-sm';

      link.textContent = ids.length === 1
        ? 'Review affected assignment'
        : 'Review assignment ' + (index + 1);

      link.addEventListener('click', async () => {
        if (
          typeof root.switchHrWorkspace !== 'function' ||
          typeof root.applyHrNavigationTask !== 'function' ||
          typeof root.openEmployeeReportingManagerWorkspace !== 'function'
        ) {
          link.textContent = 'Open People > Employee Directory';
          return;
        }

        link.disabled = true;

        try {
          if (typeof root.rememberHrWorkspace === 'function') {
            root.rememberHrWorkspace('employees');
          }

          root.switchHrWorkspace('employees');

          root.applyHrNavigationTask('people.directory', {
            scroll: false
          });

          await root.openEmployeeReportingManagerWorkspace(id);

          // BEXHR_R40_BACK_TO_REPORTING_LINES
          const modal = el('hrSupportingManagerModal');
          const navHost = modal
            ?.querySelector('#hrSupportingManagerBackToAccessBtn')
            ?.parentElement;

          if (!modal || !navHost ||
              modal.classList.contains('d-none')) {
            throw Error('Employee reporting window could not open.');
          }

          modal.querySelector('#bexhrR40BackToReportingLines')
            ?.remove();

          const back = doc.createElement('button');

          back.type = 'button';
          back.id = 'bexhrR40BackToReportingLines';
          back.className = 'hr-access-back-link';
          back.textContent = '? Back to Reporting Lines';

          back.addEventListener('click', async () => {
            back.disabled = true;

            try {
              if (
                typeof root.switchHrWorkspace !== 'function' ||
                typeof root.applyHrNavigationTask !== 'function' ||
                typeof root.hrOpenOrganizationSetupPanel !== 'function'
              ) {
                throw Error('Reporting Lines navigation is unavailable.');
              }

              modal
                .querySelector('[data-close-supporting-manager-modal]')
                ?.click();

              if (typeof root.rememberHrWorkspace === 'function') {
                root.rememberHrWorkspace('setup');
              }

              root.switchHrWorkspace('setup');

              root.applyHrNavigationTask(
                'setup.organization',
                { scroll:false }
              );

              const opened = root.hrOpenOrganizationSetupPanel(
                'reportingLines'
              );

              if (opened === false) {
                throw Error('Reporting Lines could not be opened.');
              }

              // Refresh the saved hierarchy and rerun eligibility.
              if (
                typeof root.refreshOrganizationHrSetupValues === 'function'
              ) {
                await root.refreshOrganizationHrSetupValues();
              }

              root.requestAnimationFrame(() => {
                el('bexhrH6CManualPositionEditor')
                  ?.scrollIntoView({
                    behavior:'smooth',
                    block:'center'
                  });
              });

            } catch (error) {
              back.disabled = false;
              console.error('Reporting Lines return failed:', error);
            }
          });

          navHost.prepend(back);

          // Remove the shortcut when the modal closes.
          const observer = new MutationObserver(() => {
            if (modal.classList.contains('d-none')) {
              back.remove();
              observer.disconnect();
            }
          });

          observer.observe(modal, {
            attributes:true,
            attributeFilter:['class']
          });


        } catch (error) {
          link.disabled = false;
          console.error('Could not open affected employee:', error);
          link.textContent = 'Open employee (retry)';
        }
      });

      actions.appendChild(link);
    });

    message.appendChild(actions);
  }




 // BEXHR_R40_CLICK_TO_REVIEW_HIGHEST_V1
 let highestDetailsRequested=false;
 let highestLastSelected='';

 function view(){
   const child=el('bexhrH6CChild');
   const button=el('bexhrGroupBV9Promote');
   const text=el('bexhrGroupBV9Result');

   if(!child||!button||!text)return;

   const s=snapshot;
   const selected=str(child.value);

   if(selected!==highestLastSelected){
     highestLastSelected=selected;
     highestDetailsRequested=false;
     text.replaceChildren();
     text.dataset.state='';
     text.style.color='';
     text.style.fontWeight='';
   }

   const position=(s?.positions||[]).find(
     p=>str(p.id)===selected &&
     str(p.tenant_id)===str(s.tenantId)
   );

   const roots=(s?.links||[]).filter(
     l=>str(l.tenant_id)===str(s?.tenantId) &&
     !str(l.reports_to_job_title_id)
   );

   const existing=(s?.positions||[]).find(
     p=>str(p.id)===str(roots[0]?.job_title_id)
   );

   const eligible=Boolean(
     s && s.canMaintain && position &&
     isActive(position) &&
     roots.length===1 &&
     existing &&
     selected!==str(existing.id)
   );

   button.hidden=!eligible;
   button.textContent=busy
     ? 'Saving position...'
     : 'Make selected position highest';

   if(!eligible){
     button.disabled=true;
     highestDetailsRequested=false;

     if(text.dataset.state!=='saved'){
       text.replaceChildren();
       text.dataset.state='';
       text.style.color='';
       text.style.fontWeight='';
     }
     return;
   }

   if(highestSnapshot!==s){
     highestSnapshot=s;
     ++highestCheckSeq;
     highestCheck={key:'',state:'idle',reason:''};
   }

   const key=highestCheckKey(s,selected,existing);

   if(key!==highestCheck.key){
     runHighestCheck(selected,key);
   }

   if(busy){
     button.disabled=true;
     return;
   }

   // Check silently. Show details only when HR requests them.
   if(!highestDetailsRequested){
     button.disabled=false;

     if(text.dataset.state!=='saved'){
       text.replaceChildren();
       text.dataset.state='';
       text.style.color='';
       text.style.fontWeight='';
     }
     return;
   }

   if(
     highestCheck.state==='checking' ||
     highestCheck.state==='idle'
   ){
     button.disabled=true;
     text.replaceChildren();
     text.textContent='Checking existing reporting relationships...';
     text.dataset.state='checking';
     text.style.color='';
     text.style.fontWeight='';
     return;
   }

   if(highestCheck.state==='blocked'){
     button.disabled=true;
     text.replaceChildren();

     text.textContent=
       'Cannot make '+str(position.job_title)+
       ' highest: '+str(highestCheck.reason);

     text.dataset.state='error';
     text.style.color='#b42318';
     text.style.fontWeight='600';

     renderAffectedEmployeeLinks(
       text,
       highestCheck.conflicts
     );
     return;
   }

   if(highestCheck.state==='allowed'){
     // Automatically dismiss resolved conflicts.
     highestDetailsRequested=false;
     button.disabled=false;
     text.replaceChildren();
     text.dataset.state='';
     text.style.color='';
     text.style.fontWeight='';
   }
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
   if(
     highestCheck.key!==highestCheckKey(s,positionId,rootPos) ||
     highestCheck.state!=='allowed'
   ){
     highestDetailsRequested=true;
     view();
     return;
   }


    if (
      highestCheck.key !== highestCheckKey(s, positionId, rootPos) ||
      highestCheck.state !== 'allowed' ||
      output.dataset.state === 'error'
    ) {
      output.textContent =
        highestCheck.reason ||
        'Please verify reporting safety before continuing.';

      output.dataset.state = 'error';
      output.style.color = '#b42318';
      button.disabled = true;
      return;
    }


   const approved=root.confirm('Make "'+p.job_title+'" the highest organisational position?\n\nThe current reporting chain will be safely reversed so there remains only one highest position.\n\nEmployee managers, PA, Leave and payroll will not be changed. If existing Primary Manager relationships would become invalid, BexHR will block this promotion.');
   if(!approved)return;
   const client=root.supabaseClient;
   if(!client||typeof client.rpc!=='function'){output.textContent='Staging connection unavailable. Nothing was saved.';return;}
   busy=true;button.disabled=true;button.textContent='Saving position...';output.dataset.state='';output.style.color='';output.style.fontWeight='';
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
   }catch(error){
     const details=str(error?.message);
     const protectsPrimary=/primary manager|primary reporting|authority|reconciliation|hierarchy.*invalid/i.test(details);
     output.textContent=protectsPrimary
       ? 'Not changed: existing employee Primary Managers would become invalid. Review employee reporting assignments before changing the highest position.'
       : (details || 'Unable to save position change. No change was confirmed.');
     output.dataset.state='error';output.style.color='#b42318';output.style.fontWeight='600';highestDetailsRequested=true;highestCheck.state='blocked';highestCheck.reason=output.textContent;highestCheck.conflicts=[];
   }
   finally{busy=false;button.textContent='Make selected position highest';view();}
 }
  let reportingRefreshTimer = null;

  function scheduleReportingRefresh() {
    clearTimeout(reportingRefreshTimer);

    reportingRefreshTimer = setTimeout(() => {
      if (
        typeof root.refreshOrganizationHrSetupValues !== 'function'
      ) return;

      Promise.resolve(
        root.refreshOrganizationHrSetupValues()
      ).catch(error => {
        console.warn(
          'Reporting eligibility could not refresh:',
          error
        );
      });
    }, 200);
  }

  root.addEventListener(
    'bexhr:reporting-hierarchy-changed',
    scheduleReportingRefresh
  );

  root.addEventListener('storage', event => {
    if (event.key === 'bexhrReportingHierarchySync') {
      scheduleReportingRefresh();
    }
  });

 function mount(){
   const host=el('bexhrH6CManualPositionEditor'),child=el('bexhrH6CChild');
   if(!host||!child||el('bexhrGroupBV9Promote'))return;
   const wrap=doc.createElement('div');wrap.id='bexhrGroupBV9Panel';wrap.className='mt-3';
   const button=doc.createElement('button');button.type='button';button.id='bexhrGroupBV9Promote';button.className='btn btn-outline-primary btn-sm';button.hidden=true;button.disabled=true;
   button.textContent='Make selected position highest';
   const message=doc.createElement('p');message.id='bexhrGroupBV9Result';message.className='small text-secondary mt-2 mb-0';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
   wrap.append(button,message);host.append(wrap);
   child.addEventListener('change',()=>{message.dataset.state='';message.style.color='';message.style.fontWeight='';view();});
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
