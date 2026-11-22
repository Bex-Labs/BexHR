/*
 * BexHR Phase 7A8: Unified, plain-language Deductions Setup.
 * Presentation only. Existing payroll forms, IDs, listeners and save/edit paths are preserved.
 * Core HR already merges Other Deductions under the statutory card.
 */
(function () {
  'use strict';

  const ROOT_ID = 'bexhrUnifiedDeductionsWorkspace';
  const STATUTORY_ID = 'bexhrDeductionStatutoryPane';
  const OTHER_ID = 'payrollOtherDeductionCardCollapse';
  const TABS = Object.freeze({
    statutory: { title: 'Statutory deductions', sub: 'PAYE, pension and NHF' },
    other: { title: 'Other deductions', sub: 'Union dues, advances and approved repayments' },
  });

  function element(tag, classes, text) {
    const node = document.createElement(tag);
    if (classes) node.className = classes;
    if (text) node.textContent = text;
    return node;
  }

  function setLabel(id, value) {
    const field = document.getElementById(id);
    if (!field) return;
    const label = document.querySelector('label[for="' + id + '"]');
    if (!label) return;
    // Only the visible label is changed; required fields and values stay intact.
    const required = Boolean(field.required || label.querySelector('.text-danger'));
    label.textContent = value;
    if (required) {
      const mark = element('span', 'text-danger', ' *');
      label.appendChild(mark);
    }
  }

  function setOptionLabel(selectId, value, label) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = Array.from(select.options || []).find((item) => item.value === value);
    if (option) option.textContent = label;
  }

  function hideLegacyTechnicalFields() {
    // Phase 4C/4D already derives these values. Hide the old setup controls
    // without disabling or deleting them, so the existing save logic still reads them.
    for (const id of [
      'payrollStatutoryCalculationMethod',
      'payrollStatutoryDeductionValue',
      'payrollStatutoryStatus',
      'payrollOtherDeductionStatus',
    ]) {
      const field = document.getElementById(id);
      const wrapper = field?.closest('.col-md-6, .col-md-4, .col-xl-4, .col-12');
      if (wrapper) {
        wrapper.hidden = true;
        wrapper.classList.add('d-none');
      }
    }
  }

  function helpTextForType(value) {
    switch (String(value || '').trim()) {
      case 'PAYE':
        return 'PAYE (income tax): BexHR uses the configured tax rules. There is no flat tax percentage for HR to enter here.';
      case 'EMPLOYEE_PENSION':
        return 'Employee pension: the employee\'s pension contribution. BexHR supplies the default rate automatically; this is a payroll deduction.';
      case 'EMPLOYER_PENSION':
        return 'Employer pension: a contribution paid by the company. It is a company cost, not an amount that should reduce the employee\'s take-home pay.';
      case 'NHF':
        return 'NHF (housing fund): BexHR supplies the default contribution rate automatically using the existing payroll setup.';
      default:
        return 'Choose the deduction type. BexHR selects the calculation method and any default rate; you do not need to work out a percentage.';
    }
  }

  function addStatutoryGuidance(pane) {
    const type = document.getElementById('payrollStatutoryDeductionType');
    const typeWrapper = type?.closest('.col-md-6, .col-md-4, .col-xl-4, .col-12');
    if (typeWrapper && !document.getElementById('bexhrStatutoryCalculationHelp')) {
      const note = element('p', 'bexhr-deductions-field-help');
      note.id = 'bexhrStatutoryCalculationHelp';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.textContent = helpTextForType(type?.value);
      typeWrapper.appendChild(note);
      type.addEventListener('change', () => {
        note.textContent = helpTextForType(type.value);
      });
    }

    setLabel('payrollStatutoryMasterRecordId', 'Employee Salary Setup');
    const masterSelect = document.getElementById('payrollStatutoryMasterRecordId');
    const emptyMaster = Array.from(masterSelect?.options || []).find((item) => item.value === '');
    if (emptyMaster) emptyMaster.textContent = 'Select employee salary setup';
    setLabel('payrollStatutoryConfigSource', 'Apply this deduction using');
    setOptionLabel('payrollStatutoryConfigSource', 'EMPLOYEE', 'This employee\'s salary setup (usual choice)');
    setOptionLabel('payrollStatutoryConfigSource', 'GRADE_RULE', 'The employee\'s payroll grade rule (advanced)');

    const source = document.getElementById('payrollStatutoryConfigSource');
    const grade = document.getElementById('payrollStatutoryGradeLevelContextCol');
    const sourceWrapper = source?.closest('.col-md-6, .col-md-4, .col-xl-4, .col-12');
    if (sourceWrapper && !document.getElementById('bexhrDeductionSourceHelp')) {
      const hint = element('p', 'bexhr-deductions-field-help',
        'For most employees, keep the usual choice. Use a payroll grade rule only if the employee already has a grade set up.');
      hint.id = 'bexhrDeductionSourceHelp';
      sourceWrapper.appendChild(hint);
    }

    function updateGrade() {
      if (!source || !grade) return;
      const gradeRule = source.value === 'GRADE_RULE';
      grade.classList.toggle('d-none', !gradeRule);
      grade.hidden = !gradeRule;
    }
    source?.addEventListener('change', updateGrade);
    updateGrade();

    // The Phase 4C/D core is responsible for setting and hiding the method/value/status.
    // These are not deleted because real payroll saves and historical edits still use them.
    const details = element('details', 'bexhr-deductions-explainer');
    details.id = 'bexhrDeductionCalculationExplainer';
    const summary = element('summary', '', 'How does BexHR calculate these deductions?');
    details.appendChild(summary);
    const explanation = element('div', 'bexhr-deductions-explainer-body');
    explanation.appendChild(element('p', '',
      'Rule based means BexHR calculates the amount using the configured rules, such as PAYE. Percentage means a rate is applied to the relevant salary amount. Fixed amount means a specific amount instead of a rate.'));
    explanation.appendChild(element('p', '',
      'These are calculation approaches, not extra choices you need to make in the normal statutory setup. PAYE does not use one flat rate. Employer pension is paid by the company, not deducted from employee take-home pay.'));
    details.appendChild(explanation);
    const form = pane.querySelector('#payrollStatutoryCreateForm');
    if (form && !document.getElementById(details.id)) form.insertAdjacentElement('afterend', details);
  }

  function addOtherGuidance(pane) {
    setLabel('payrollOtherDeductionMasterRecordId', 'Employee Salary Setup');
    setLabel('payrollOtherDeductionAmount', 'Amount to deduct each pay cycle');
    setLabel('payrollOtherDeductionDurationMonths', 'Number of months to deduct');

    const type = document.getElementById('payrollOtherDeductionType');
    const typeWrapper = type?.closest('.col-md-6, .col-md-4, .col-xl-4, .col-12');
    if (typeWrapper && !document.getElementById('bexhrOtherDeductionHelp')) {
      const note = element('p', 'bexhr-deductions-field-help',
        'Choose an approved deduction such as union dues, cooperative savings or an employee salary advance. Enter the agreed amount and how long it should run.');
      note.id = 'bexhrOtherDeductionHelp';
      typeWrapper.appendChild(note);
    }

    setLabel('payrollOtherDeductionReferenceNumber', 'Approval/reference number (optional)');

  }

  function markOldHeadings(statutoryPane, otherPane) {
    for (const node of Array.from(statutoryPane.children)) {
      if (node.tagName !== 'DIV') continue;
      const heading = node.querySelector('.fw-bold');
      if (heading && heading.textContent.trim() === 'Statutory Deductions') {
        node.classList.add('bexhr-deductions-old-heading');
        break;
      }
    }
    const nodes = Array.from(otherPane.children);
    if (nodes[0]?.tagName === 'HR') nodes[0].classList.add('bexhr-deductions-old-divider');
    for (const node of nodes) {
      if (node.tagName !== 'DIV') continue;
      const heading = node.querySelector('.fw-bold');
      if (heading && heading.textContent.trim() === 'Other Deductions') {
        node.classList.add('bexhr-deductions-old-heading');
        break;
      }
    }
  }

  function createCategoryTab(key, meta, panelId) {
    const button = element('button', 'bexhr-deductions-tab');
    button.type = 'button';
    button.id = 'bexhrDeductionsTab-' + key;
    button.dataset.bexhrDeductionCategory = key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('tabindex', '-1');
    const title = element('span', 'bexhr-deductions-tab-label', meta.title);
    const sub = element('span', 'bexhr-deductions-tab-hint', meta.sub);
    button.append(title, sub);
    return button;
  }

  function init() {
    if (document.getElementById(ROOT_ID)) return true;
    const statutory = document.getElementById('payrollStatutoryCardCollapse');
    const other = document.getElementById(OTHER_ID);
    // Core must first merge Other Deductions into the statutory card.
    if (!statutory || !other || !statutory.contains(other)) return false;

    const pane = element('div', 'bexhr-deductions-pane');
    pane.id = STATUTORY_ID;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', 'bexhrDeductionsTab-statutory');
    const originalChildren = Array.from(statutory.children).filter((child) => child !== other);
    for (const child of originalChildren) pane.appendChild(child);
    other.classList.add('bexhr-deductions-pane');
    other.setAttribute('role', 'tabpanel');
    other.setAttribute('aria-labelledby', 'bexhrDeductionsTab-other');

    const shell = element('div', 'bexhr-deductions-workspace');
    shell.id = ROOT_ID;
    const lead = element('p', 'bexhr-deductions-lead',
      'Choose a category. BexHR handles statutory formulas and default rates for you.');
    const nav = element('div', 'bexhr-deductions-tablist');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Deduction category');
    const tabs = {
      statutory: createCategoryTab('statutory', TABS.statutory, STATUTORY_ID),
      other: createCategoryTab('other', TABS.other, OTHER_ID),
    };
    nav.append(tabs.statutory, tabs.other);
    shell.append(lead, nav, pane, other);
    statutory.appendChild(shell);

    markOldHeadings(pane, other);
    const title = statutory.closest('.dashboard-section-card')?.querySelector('.section-heading');
    if (title) title.textContent = 'Deductions Setup';
    const subtitle = statutory.closest('.dashboard-section-card')?.querySelector('.section-subtext');
    if (subtitle) subtitle.textContent =
      'Set up tax, pension and other approved payroll deductions in one place.';
    hideLegacyTechnicalFields();
    addStatutoryGuidance(pane);
    addOtherGuidance(other);

    function selectCategory(category, moveFocus) {
      if (!Object.prototype.hasOwnProperty.call(tabs, category)) return;
      for (const key of Object.keys(tabs)) {
        const active = key === category;
        const tab = tabs[key];
        const target = key === 'statutory' ? pane : other;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.setAttribute('tabindex', active ? '0' : '-1');
        target.hidden = !active;
        target.classList.toggle('d-none', !active);
      }
      shell.dataset.activeDeductionCategory = category;
      if (moveFocus) tabs[category].focus();
      // The existing Other Deductions collapse button can be detached after the
      // core merge; do not change its handlers or stored values.
    }

    for (const [key, tab] of Object.entries(tabs)) {
      tab.addEventListener('click', () => selectCategory(key, false));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'statutory' :
          event.key === 'End' ? 'other' :
          key === 'statutory' ? 'other' : 'statutory';
        selectCategory(next, true);
      });
    }

    selectCategory('statutory', false);
    return true;
  }

  function boot() {
    if (init()) return;
    const root = document.getElementById('hrSetupSection') || document.body;
    if (!root || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(() => {
      if (init()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
