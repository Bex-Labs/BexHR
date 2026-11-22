/* BexHR Groups B+C — targeted hierarchy/lifecycle presentation and validation.
 * Reuses existing H11 offboarding RPC, reporting engine and employee state.
 * Does not promote occupants, modify Primary managers, or write to Supabase.
 */
(() => {
  'use strict';
  const reasons = [
    ['', 'Select departure reason'],
    ['Termination', 'Termination'],
    ['Resignation', 'Resignation'],
    ['Death', 'Death'],
    ['Other', 'Other — specify below'],
  ];
  const $ = (id) => document.getElementById(id);

  function installOffboardingReason() {
    const original = $('hrEmployeeOffboardingReason');
    if (!original || original.tagName === 'SELECT') return;
    const select = document.createElement('select');
    select.id = original.id;
    select.className = 'form-select';
    select.required = true;
    select.setAttribute('aria-required', 'true');
    select.setAttribute('aria-label', 'Departure reason');
    for (const [value, label] of reasons) {
      const item = document.createElement('option');
      item.value = value;
      item.textContent = label;
      select.appendChild(item);
    }
    original.replaceWith(select);
    const note = $('hrEmployeeOffboardingNote');
    const noteRow = note?.closest('.col-12');
    const noteLabel = noteRow?.querySelector('label');
    if (noteRow) noteRow.id = 'bexhrOffboardOtherNoteRow';
    if (noteLabel) noteLabel.innerHTML = 'Explanation <span class="text-danger" aria-hidden="true">*</span>';
    if (note) {
      note.placeholder = 'Briefly explain the departure reason';
      note.required = false;
    }
    const show = () => {
      const other = select.value === 'Other';
      if (noteRow) noteRow.hidden = !other;
      if (note) {
        note.required = other;
        if (!other) note.value = '';
      }
      const status = $('hrEmployeeOffboardingStatus');
      if (status?.dataset?.bcValidation === 'true') {
        status.textContent = '';
        status.className = 'alert d-none mt-3 mb-0';
        delete status.dataset.bcValidation;
      }
    };
    select.addEventListener('change', show);
    show();
  }

  function verifyReasonBeforeOffboard(event) {
    const button = event.target?.closest?.('#hrEmployeeOffboardingConfirmBtn');
    if (!button) return;
    const reason = $('hrEmployeeOffboardingReason')?.value || '';
    const note = $('hrEmployeeOffboardingNote')?.value?.trim() || '';
    const status = $('hrEmployeeOffboardingStatus');
    let error = '';
    if (!reasons.slice(1).some(([value]) => value === reason)) {
      error = 'Select a departure reason.';
      $('hrEmployeeOffboardingReason')?.focus();
    } else if (reason === 'Other' && note.length < 3) {
      error = 'Enter an explanation when you select Other.';
      $('hrEmployeeOffboardingNote')?.focus();
    }
    if (!error) return;
    // The existing onclick handler remains authoritative for valid submissions.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (status) {
      status.textContent = error;
      status.className = 'alert alert-warning mt-3 mb-0';
      status.dataset.bcValidation = 'true';
    }
  }

  function clarifyPositionLabels() {
    const status = document.querySelector('label[for="organizationJobTitleStatus"]');
    if (status && !status.dataset.bcLabel) {
      status.dataset.bcLabel = '1';
      status.innerHTML = 'Position status <span class="text-danger">*</span>';
    }
    const reporting = document.querySelector('label[for="organizationJobTitleReportsTo"]');
    if (reporting && !reporting.dataset.bcLabel) {
      reporting.dataset.bcLabel = '1';
      reporting.innerHTML = 'Parent position <span class="text-danger">*</span>';
    }
    const helper = $('organizationJobTitleReportsToHelp');
    if (helper) helper.textContent = 'Choose the position above this one. Top-level means no parent position; it does not assign an employee\'s Primary Manager.';
    const select = $('organizationJobTitleReportsTo');
    const top = select?.querySelector('option[value="__top_level__"]');
    if (top && top.textContent !== 'Top-level position (no parent)') top.textContent = 'Top-level position (no parent)';
    const table = $('organizationJobTitlesTableBody');
    if (table) {
      for (const row of table.querySelectorAll('tr')) {
        const cell = row.querySelector('td[data-label="Reports to"]');
        if (cell && cell.textContent.trim() === 'Top level') cell.textContent = 'Top-level position (no parent)';
      }
    }
  }

  function monitorHierarchy() {
    const table = $('organizationJobTitlesTableBody');
    const select = $('organizationJobTitleReportsTo');
    if (table) new MutationObserver(clarifyPositionLabels).observe(table, {childList:true, subtree:true, characterData:true});
    if (select) new MutationObserver(clarifyPositionLabels).observe(select, {childList:true, subtree:true, characterData:true});
    clarifyPositionLabels();
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('#organizationJobTitlesSection, #organizationJobTitleForm')) clarifyPositionLabels();
    });
  }

  function initialize() {
    installOffboardingReason();
    document.addEventListener('click', verifyReasonBeforeOffboard, true);
    monitorHierarchy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
  else initialize();
})();
