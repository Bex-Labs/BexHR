/* BEXHR_GROUP_A_V6_2 - tenant-scoped custom biodata headings, fields and CSV import. */
(function () {
  'use strict';
  let db = null;
  let tenantId = '';
  let isAlpatech = false;
  let isAdmin = false;
  let ready = false;
  let fields = [];
  let customHeadings = [];
  let selectedEmployeeId = '';
  const el = (id) => document.getElementById(id);
  const normalize = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
  const standardHeadings = [
    { key: 'core', label: 'Core Details' },
    { key: 'reporting', label: 'Reporting' },
    { key: 'address', label: 'Address' },
    { key: 'next-of-kin', label: 'Next of Kin' },
  ];
  const alpatechHeadings = [
    { key: 'core', label: 'Core Details' },
    { key: 'reporting', label: 'Reporting' },
    { key: 'dependants', label: 'Dependants' },
    { key: 'address', label: 'Address' },
    { key: 'next-of-kin', label: 'Next of Kin' },
    { key: 'education', label: 'Education' },
    { key: 'documents', label: 'Documents' },
  ];
  const baseHeadings = () => isAlpatech ? alpatechHeadings : standardHeadings;
  const allHeadings = () => [...baseHeadings(), ...customHeadings];
  const activeFields = () => fields.filter((f) => f.active !== false);
  const isCustomHeading = (key) => customHeadings.some((h) => h.key === key);
  const headingName = (key) => allHeadings().find((h) => h.key === key)?.label || 'Additional Details';
  function assertReady() {
    if (!ready) throw new Error('Biodata settings are not available. Refresh after the Group A database update.');
  }
  async function rpc(name, args = {}) {
    if (!db) throw new Error('Biodata database is not connected.');
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message || 'Biodata request failed.');
    return data;
  }
  function message(text, danger = false) {
    const node = el('bexhrGaStatus');
    if (!node) return;
    node.textContent = text;
    node.className = danger ? 'small text-danger mt-2' : 'small text-secondary mt-2';
  }
  function fieldInput(field, value = '') {
    const wrap = document.createElement('div');
    wrap.className = 'col-12 col-md-6';
    const label = document.createElement('label');
    label.className = 'form-label fw-semibold';
    label.htmlFor = `bexhrGaValue-${field.id}`;
    label.textContent = field.label;
    if (field.required) {
      label.appendChild(document.createTextNode(' '));
      const star = document.createElement('span');
      star.className = 'text-danger bexhr-ga-required-star';
      star.textContent = '*';
      star.setAttribute('aria-hidden', 'true');
      label.appendChild(star);
    }
    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Select';
      input.appendChild(blank);
      for (const choice of (Array.isArray(field.options) ? field.options : [])) {
        const option = document.createElement('option');
        option.value = String(choice);
        option.textContent = String(choice);
        input.appendChild(option);
      }
    } else {
      input = document.createElement('input');
      input.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      if (field.type === 'number') input.step = 'any';
      input.maxLength = 500;
    }
    input.id = label.htmlFor;
    input.dataset.gaFieldId = field.id;
    input.className = 'form-control';
    input.value = String(value ?? '');
    if (field.required) { input.required = true; input.setAttribute('aria-required', 'true'); }
    const notify = () => {
      // One source of truth: existing employee save state plus required custom fields.
      // Do not mutate standard field validation or PA/Leave/hierarchy logic.
      if (typeof window.bexhrGaUpdateEmployeeSaveButton === 'function') window.bexhrGaUpdateEmployeeSaveButton();
    };
    input.addEventListener('input', notify);
    input.addEventListener('change', notify);
    wrap.append(label, input);
    return wrap;
  }
  function collectValues() {
    const values = {};
    for (const field of activeFields()) values[field.id] = String(el(`bexhrGaValue-${field.id}`)?.value || '').trim();
    return values;
  }
  function validateOne(field, value, options = {}) {
    // Required custom fields do not block flexible CSV import. They flag Needs Completion.
    if (field.required && !value && !options.allowMissingRequired) return `${field.label} is required.`;
    if (!value) return '';
    if (value.length > 500) return `${field.label} must be 500 characters or less.`;
    if (field.type === 'number' && !/^-?\d{1,12}(\.\d{1,4})?$/.test(value)) return `${field.label} must be a valid number.`;
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${field.label} requires YYYY-MM-DD.`;
    if (field.type === 'select' && !(field.options || []).includes(value)) return `${field.label} has an unapproved option.`;
    return '';
  }
  function revealField(fieldId) {
    const field = fields.find((f) => f.id === fieldId);
    const heading = field?.heading || 'core';
    const tab = document.querySelector(`#employeeFormSteps [data-employee-form-tab="${heading}"]`);
    tab?.click();
    el(`bexhrGaValue-${fieldId}`)?.focus({ preventScroll: true });
  }
  function requiredComplete() {
    if (!ready) return false;
    return activeFields().every((field) => {
      const value = String(el(`bexhrGaValue-${field.id}`)?.value || '').trim();
      return !validateOne(field, value);
    });
  }
  function refreshPrimarySaveState() {
    if (typeof window.bexhrGaUpdateEmployeeSaveButton === 'function') window.bexhrGaUpdateEmployeeSaveButton();
  }
  function validateManual() {
    assertReady();
    const values = collectValues();
    for (const field of activeFields()) {
      const error = validateOne(field, values[field.id]);
      if (error) {
        revealField(field.id);
        message(error, true);
        throw new Error(error);
      }
    }
    return true;
  }
  function newFieldSection(key) {
    const form = el('employeeCreateForm');
    const sourceRow = Array.from(form?.children || []).find((child) => child.classList?.contains('row') && child.classList?.contains('g-4'));
    const submitWrap = Array.from(sourceRow?.children || []).find((child) => child.classList?.contains('hr-create-employee-submit-wrap'));
    if (!sourceRow || !submitWrap) return null;
    const section = document.createElement('section');
    section.className = 'col-12 bexhr-ga-values-section';
    section.dataset.employeeFormSection = key;
    section.dataset.gaSection = key;
    section.hidden = true;
    section.style.setProperty('display', 'none', 'important');
    const heading = document.createElement('h3');
    heading.className = 'h6 fw-bold mt-3 mb-2';
    heading.textContent = 'Additional employee fields';
    const container = document.createElement('div');
    container.className = 'row g-3';
    container.dataset.gaInputs = 'true';
    section.append(heading, container);
    sourceRow.insertBefore(section, submitWrap);
    return section;
  }
  function syncSections(active = 'core') {
    for (const section of document.querySelectorAll('#employeeCreateForm [data-ga-section]')) {
      const hasFields = section.querySelectorAll('[data-ga-field-id]').length > 0;
      const show = hasFields && section.dataset.gaSection === active;
      section.hidden = !show;
      if (show) section.style.removeProperty('display');
      else section.style.setProperty('display', 'none', 'important');
    }
  }
  function renderValues(existing = null) {
    const form = el('employeeCreateForm');
    if (!form) return;
    // Schema refresh preserves unsaved values; switching employees NEVER carries them over.
    const values = existing === null ? collectValues() : existing;
    const inUse = new Set(activeFields().map((f) => f.heading || 'core'));
    for (const section of Array.from(form.querySelectorAll('[data-ga-section]'))) {
      if (!inUse.has(section.dataset.gaSection)) { section.remove(); continue; }
    }
    for (const heading of allHeadings()) {
      if (!inUse.has(heading.key)) continue;
      let section = Array.from(form.querySelectorAll('[data-ga-section]')).find((node) => node.dataset.gaSection === heading.key);
      if (!section) section = newFieldSection(heading.key);
      const inputs = section?.querySelector('[data-ga-inputs]');
      if (!inputs) continue;
      inputs.replaceChildren();
      for (const field of activeFields().filter((f) => (f.heading || 'core') === heading.key)) {
        const input = fieldInput(field, values[field.id] || '');
        input.dataset.gaFieldId = field.id;
        inputs.appendChild(input);
      }
    }
    syncSections(String(form.dataset.activeEmployeeTab || 'core'));
    refreshPrimarySaveState();
  }
  async function editEmployee(employeeId) {
    selectedEmployeeId = String(employeeId || '');
    if (!ready) return;
    if (!selectedEmployeeId) { renderValues({}); refreshPrimarySaveState(); return; }
    // Clear the previous employee's visible custom values during record hydration.
    renderValues({});
    const currentId = selectedEmployeeId;
    try {
      const values = await rpc('bexhr_ga_list_values', { p_employee_id: currentId });
      if (currentId !== selectedEmployeeId) return;
      renderValues(values || {});
    } catch (error) { message('Could not load custom values: ' + error.message, true); }
  }
  function reset() {
    selectedEmployeeId = '';
    if (ready) {
      for (const input of document.querySelectorAll('#employeeCreateForm [data-ga-field-id]')) {
        if ('value' in input) input.value = '';
      }
      renderValues();
      refreshPrimarySaveState();
    }
  }
  async function saveManual(employeeId) {
    assertReady();
    if (!activeFields().length) return { saved: 0 };
    validateManual();
    return rpc('bexhr_ga_save_values', { p_employee_id: employeeId, p_values: collectValues() });
  }
  function headerFor(field) { return `Custom [${headingName(field.heading || 'core')}]: ${field.label}`; }
  function legacyHeaderFor(field) { return `Custom: ${field.label}`; }
  // The downloadable template stays intentionally small for every tenant.
  // New headings/fields do not bloat it. The CSV engine still accepts optional
  // configured custom columns supplied in an extended CSV, and older approved
  // standard/Alpatech templates remain backwards-compatible.
  function headers(regular, alpatech) {
    assertReady();
    return [...regular];
  }
  function acceptedHeaders(compact, standardLegacy, alpatechLegacy) {
    assertReady();
    const base = [...compact, ...standardLegacy, ...(isAlpatech ? alpatechLegacy : [])];
    return [...new Set([...base, ...activeFields().map(headerFor), ...activeFields().map(legacyHeaderFor)])];
  }
  function validateImportRow(prepared, row, headerMap) {
    if (!ready) return { ...prepared, skipped: true, category: 'blocked', reason: 'Biodata configuration unavailable; retry.' };
    if (prepared.skipped) return prepared;
    const values = {};
    const warnings = Array.isArray(prepared.warnings) ? [...prepared.warnings] : [];
    for (const field of activeFields()) {
      const newIndex = headerMap.get(normalize(headerFor(field)));
      const oldIndex = headerMap.get(normalize(legacyHeaderFor(field)));
      if (newIndex !== undefined && oldIndex !== undefined) {
        return { ...prepared, skipped: true, category: 'blocked', reason: `Duplicate custom field column: ${field.label}` };
      }
      const index = newIndex === undefined ? oldIndex : newIndex;
      const value = index === undefined ? '' : String(row[index] || '').trim();
      const error = validateOne(field, value, { allowMissingRequired: true });
      if (error) return { ...prepared, skipped: true, category: 'blocked', reason: error };
      if (field.required && !value) warnings.push(`${field.label} missing; complete employee profile later`);
      values[field.id] = value;
    }
    return { ...prepared, custom_values: values, warnings,
      import_status: warnings.length ? 'needs_completion' : 'ready' };
  }
  async function saveImported(createdRows, tenantKey) {
    assertReady();
    if (!createdRows?.length || !activeFields().length) return { saved: 0, failures: [] };
    if (String(tenantKey) !== tenantId) throw new Error('Tenant changed during import.');
    const emails = createdRows.map((r) => String(r.work_email || '').trim().toLowerCase());
    const { data, error } = await db.from('employees').select('id,work_email').eq('tenant_id', tenantId).in('work_email', emails);
    if (error) throw new Error('Could not resolve employees created by import: ' + error.message);
    const byEmail = new Map((data || []).map((r) => [String(r.work_email || '').trim().toLowerCase(), r.id]));
    const failures = [];
    let saved = 0;
    for (const row of createdRows) {
      const email = String(row.work_email || '').trim().toLowerCase();
      const employeeId = byEmail.get(email);
      if (!employeeId) { failures.push(email + ': employee not found after creation'); continue; }
      try {
        await rpc('bexhr_ga_save_import_values_v5', { p_employee_id: employeeId, p_values: row.custom_values || {} });
        saved++;
      } catch (error) { failures.push(email + ': ' + error.message); }
    }
    return { saved, failures };
  }
  function renderNavigation() {
    const stepper = el('employeeFormSteps');
    if (!stepper) return;
    for (const old of stepper.querySelectorAll('.bexhr-ga-dynamic-step, .bexhr-ga-dynamic-connector')) old.remove();
    const fixed = isAlpatech ? [1,2,3,4,5,6,7] : [1,2,4,5];
    fixed.forEach((number, index) => {
      const tab = stepper.querySelector(`[data-step="${number}"]`);
      if (tab) {
        const num = tab.querySelector('.bexhr-step-num');
        if (num) num.textContent = String(index + 1);
      }
    });
    let cursor = stepper.querySelector(isAlpatech ? '[data-step="7"]' : '[data-step="5"]');
    let count = fixed.length;
    for (const heading of customHeadings) {
      if (!cursor) break;
      const connector = document.createElement('div');
      connector.className = 'bexhr-form-step-connector bexhr-ga-dynamic-connector';
      connector.setAttribute('aria-hidden', 'true');
      const tab = document.createElement('div');
      tab.className = 'bexhr-form-step hr-employee-form-tab bexhr-ga-dynamic-step';
      tab.dataset.employeeFormTab = heading.key;
      tab.dataset.gaHeadingKey = heading.key;
      tab.title = heading.label;
      tab.setAttribute('role', 'button');
      tab.setAttribute('aria-pressed', 'false');
      tab.setAttribute('tabindex', '-1');
      const dot = document.createElement('div');
      dot.className = 'bexhr-step-dot';
      const icon = document.createElement('i');
      icon.className = 'bi bi-check-lg';
      const number = document.createElement('span');
      number.className = 'bexhr-step-num';
      number.textContent = String(++count);
      dot.append(icon, number);
      const label = document.createElement('span');
      label.className = 'bexhr-step-label';
      label.textContent = heading.label;
      tab.append(dot, label);
      cursor.insertAdjacentElement('afterend', connector);
      connector.insertAdjacentElement('afterend', tab);
      cursor = tab;
    }
    stepper.classList.toggle('bexhr-ga-has-custom-steps', customHeadings.length > 0);
    const activeKey = String(el('employeeCreateForm')?.dataset.activeEmployeeTab || 'core');
    if (activeKey.startsWith('custom:') && !isCustomHeading(activeKey)) {
      stepper.querySelector('[data-employee-form-tab="core"]')?.click();
    }
  }
  function renderHeadingOptions() {
    const select = el('bexhrGaHeading');
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    for (const heading of allHeadings()) {
      const opt = document.createElement('option');
      opt.value = heading.key;
      opt.textContent = heading.label;
      select.appendChild(opt);
    }
    const other = document.createElement('option');
    other.value = 'other';
    other.textContent = 'Other - Create new heading';
    select.appendChild(other);
    if (Array.from(select.options).some((opt) => opt.value === previous)) select.value = previous;
    else select.value = 'core';
    toggleNewHeading();
  }
  function toggleNewHeading() {
    const wrap = el('bexhrGaNewHeadingWrap');
    if (wrap) wrap.hidden = el('bexhrGaHeading')?.value !== 'other';
  }
  let editingFieldId = '';
  const busyButton = async (button, label, task) => {
    if (!button || button.disabled) return;
    const before = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${label}`;
    try { await task(); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = (button.id === 'bexhrGaAdd' && !editingFieldId) ? 'Add Field' : before; }
  };
  function clearEditor() {
    editingFieldId = '';
    el('bexhrGaFormTitle').textContent = 'Add a field';
    el('bexhrGaAdd').textContent = 'Add Field';
    el('bexhrGaCancelEdit').hidden = true;
    el('bexhrGaLabel').value = '';
    el('bexhrGaNewHeading').value = '';
    el('bexhrGaType').value = 'text';
    el('bexhrGaOptions').value = '';
    el('bexhrGaRequired').checked = false;
    el('bexhrGaHeading').value = 'core';
    toggleNewHeading();
    el('bexhrGaOptionsWrap').hidden = true;
  }
  function beginEdit(field) {
    editingFieldId = field.id;
    const panel = el('bexhrGaPanel');
    panel.open = true;
    el('bexhrGaFormTitle').textContent = 'Edit ' + field.label;
    el('bexhrGaAdd').textContent = 'Save Changes';
    el('bexhrGaCancelEdit').hidden = false;
    el('bexhrGaLabel').value = field.label;
    el('bexhrGaHeading').value = field.heading || 'core';
    el('bexhrGaType').value = field.type;
    el('bexhrGaRequired').checked = Boolean(field.required);
    el('bexhrGaOptions').value = (field.options || []).join(', ');
    el('bexhrGaOptionsWrap').hidden = field.type !== 'select';
    toggleNewHeading();
    el('bexhrGaLabel').focus({ preventScroll: true });
    message('Editing existing field. Saved employee values will be preserved.');
  }
  // Group A V6.2: reuse the Employee Directory Actions visual classes and portal
  // interaction pattern. This is purely presentation; existing RPCs and access
  // controls are unchanged.
  const FIELD_ACTION_PORTAL_ID = 'bexhrGaFieldActionsPortal';
  let openFieldAction = null;
  let fieldActionListenersBound = false;
  function closeFieldActionMenu(restoreFocus = false) {
    if (!openFieldAction) return;
    const toggle = openFieldAction.toggle;
    const portal = el(FIELD_ACTION_PORTAL_ID);
    if (portal) { portal.hidden = true; portal.replaceChildren(); portal.style.visibility = ''; }
    if (toggle?.isConnected) toggle.setAttribute('aria-expanded', 'false');
    openFieldAction = null;
    if (restoreFocus && toggle?.isConnected) toggle.focus({ preventScroll: true });
  }
  function ensureFieldActionPortal() {
    let portal = el(FIELD_ACTION_PORTAL_ID);
    if (!portal) {
      portal = document.createElement('div');
      portal.id = FIELD_ACTION_PORTAL_ID;
      portal.className = 'hr-people-actions-portal';
      portal.setAttribute('role', 'menu');
      portal.setAttribute('aria-label', 'Employee biodata field actions');
      portal.hidden = true;
      document.body.appendChild(portal);
    }
    if (!fieldActionListenersBound) {
      fieldActionListenersBound = true;
      document.addEventListener('pointerdown', (event) => {
        if (!openFieldAction) return;
        if (portal.contains(event.target) || openFieldAction.toggle?.contains(event.target)) return;
        closeFieldActionMenu(false);
      }, true);
      document.addEventListener('keydown', (event) => {
        if (!openFieldAction) return;
        if (event.key === 'Escape') { event.preventDefault(); closeFieldActionMenu(true); }
        if (event.key === 'Tab') closeFieldActionMenu(false);
      }, true);
      document.addEventListener('scroll', (event) => {
        if (!openFieldAction) return;
        if (event.target?.closest?.('#' + FIELD_ACTION_PORTAL_ID)) return;
        closeFieldActionMenu(false);
      }, true);
      window.addEventListener('resize', () => closeFieldActionMenu(false));
    }
    return portal;
  }
  function positionFieldActionPortal(toggle) {
    const portal = ensureFieldActionPortal();
    const rect = toggle.getBoundingClientRect();
    const padding = 12;
    const width = Math.max(1, Math.min(312, window.innerWidth - padding * 2));
    portal.style.width = width + 'px';
    portal.style.visibility = 'hidden';
    portal.hidden = false;
    const height = portal.getBoundingClientRect().height;
    const below = window.innerHeight - rect.bottom;
    const top = below >= height + 12 ? rect.bottom + 8 : Math.max(padding, rect.top - height - 8);
    const left = Math.max(padding, Math.min(rect.right - width, window.innerWidth - width - padding));
    portal.style.top = top + 'px';
    portal.style.left = left + 'px';
    portal.style.visibility = 'visible';
  }
  function showFieldActionMenu(toggle, field) {
    if (openFieldAction?.toggle === toggle) { closeFieldActionMenu(true); return; }
    closeFieldActionMenu(false);
    const portal = ensureFieldActionPortal();
    portal.replaceChildren();
    const createAction = (text, iconClass, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hr-people-menu-item';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-label', label);
      const icon = document.createElement('i');
      icon.className = 'bi ' + iconClass;
      icon.setAttribute('aria-hidden', 'true');
      const caption = document.createElement('span');
      caption.textContent = text;
      button.append(icon, caption);
      return button;
    };
    const edit = createAction('Edit field', 'bi-pencil-square', 'Edit ' + field.label);
    edit.addEventListener('click', () => { closeFieldActionMenu(false); beginEdit(field); });
    const remove = createAction('Delete field', 'bi-trash3', 'Permanently delete ' + field.label);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Permanently delete "${field.label}" and all saved employee values? This cannot be undone.`)) return;
      await busyButton(remove, 'Deleting...', async () => {
        try {
          await rpc('bexhr_ga_delete_field_v5', { p_field_id: field.id });
          if (editingFieldId === field.id) clearEditor();
          await refreshDefinitions();
          message('Field permanently deleted from this company.');
        } catch (error) { message(error.message, true); }
      });
      closeFieldActionMenu(false);
    });
    portal.append(edit, remove);
    openFieldAction = { toggle };
    toggle.setAttribute('aria-expanded', 'true');
    positionFieldActionPortal(toggle);
    edit.focus({ preventScroll: true });
  }
  function renderManagement() {
    const manager = el('bexhrGaManager');
    const panel = el('bexhrGaPanel');
    if (manager) manager.hidden = !isAdmin;
    if (panel) panel.hidden = !isAdmin;
    renderHeadingOptions();
    const list = el('bexhrGaFieldList');
    if (!list) return;
    closeFieldActionMenu(false);
    list.replaceChildren();
    for (const field of activeFields()) {
      const row = document.createElement('div');
      row.className = 'bexhr-ga-field-row';
      const name = document.createElement('span');
      name.textContent = `${headingName(field.heading || 'core')} / ${field.label}${field.required ? ' - Required' : ''}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'hr-people-actions-toggle';
      toggle.setAttribute('aria-haspopup', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', FIELD_ACTION_PORTAL_ID);
      toggle.setAttribute('aria-label', `Actions for ${field.label}`);
      const label = document.createElement('span');
      label.textContent = 'Actions';
      const icon = document.createElement('i');
      icon.className = 'bi bi-three-dots-vertical';
      icon.setAttribute('aria-hidden', 'true');
      toggle.append(label, icon);
      toggle.addEventListener('click', () => showFieldActionMenu(toggle, field));
      toggle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        showFieldActionMenu(toggle, field);
      });
      row.append(name, toggle); list.appendChild(row);
    }
  }
  async function refreshDefinitions() {
    const config = await rpc('bexhr_ga_configuration_v5');
    isAlpatech = config?.alpatech === true;
    fields = Array.isArray(config?.fields) ? config.fields : [];
    customHeadings = Array.isArray(config?.headings) ? config.headings : [];
    ready = true;
    document.body.classList.toggle('bexhr-ga-alpatech', isAlpatech);
    document.body.classList.add('bexhr-ga-ready');
    renderNavigation();
    renderValues();
    renderManagement();
  }
  function renderShell() {
    const form = el('employeeCreateForm');
    const stepper = el('employeeFormSteps');
    if (!form || !stepper || el('bexhrGaPanel')) return;
    const panel = document.createElement('details');
    panel.id = 'bexhrGaPanel';
    panel.hidden = true;
    panel.className = 'bexhr-ga-panel mt-3 mb-3';
    panel.innerHTML = `
      <summary class="bexhr-ga-summary">Manage employee fields <small class="text-secondary">(HR Admin)</small></summary>
      <div id="bexhrGaManager" hidden>
        <p class="small text-secondary mt-2 mb-3">Choose a section and add a field, or edit an existing field using Actions. The Employee Import template stays short and flexible.</p>
        <div id="bexhrGaFormTitle" class="fw-semibold mb-2">Add a field</div>
        <div class="row g-2 align-items-end">
          <div class="col-12 col-lg-3"><label class="form-label" for="bexhrGaHeading">Heading</label><select class="form-select" id="bexhrGaHeading"></select></div>
          <div class="col-12 col-lg-3" id="bexhrGaNewHeadingWrap" hidden><label class="form-label" for="bexhrGaNewHeading">New heading name</label><input class="form-control" id="bexhrGaNewHeading" maxlength="60" placeholder="e.g. Certifications"></div>
          <div class="col-12 col-lg-3"><label class="form-label" for="bexhrGaLabel">Field name</label><input class="form-control" id="bexhrGaLabel" maxlength="60" placeholder="e.g. Certificate number"></div>
          <div class="col-6 col-lg-2"><label class="form-label" for="bexhrGaType">Type</label><select class="form-select" id="bexhrGaType"><option value="text">Text</option><option value="date">Date</option><option value="number">Number</option><option value="select">Dropdown</option></select></div>
          <div class="col-12 col-lg-3" id="bexhrGaOptionsWrap" hidden><label class="form-label" for="bexhrGaOptions">Dropdown choices</label><input class="form-control" id="bexhrGaOptions" placeholder="Option A, Option B"></div>
          <div class="col-6 col-lg-1"><label class="form-label" for="bexhrGaRequired">Required</label><div><input type="checkbox" id="bexhrGaRequired" class="form-check-input"></div></div>
          <div class="col-12 col-md-4 col-lg-2"><button type="button" class="btn btn-primary w-100" id="bexhrGaAdd">Add Field</button></div>
          <div class="col-12 col-md-4 col-lg-2"><button type="button" class="btn btn-outline-secondary w-100" id="bexhrGaCancelEdit" hidden>Cancel Edit</button></div>
        </div>
        <div id="bexhrGaFieldList" class="mt-3"></div>
        <div class="small text-secondary mt-2">Delete Field permanently removes the field and its employee values. An empty custom heading disappears automatically.</div>
        <div id="bexhrGaStatus" role="status" aria-live="polite" class="small text-secondary mt-2">Loading...</div>
      </div>`;
    stepper.insertAdjacentElement('afterend', panel);
    const type = el('bexhrGaType');
    const updateOptions = () => { el('bexhrGaOptionsWrap').hidden = type.value !== 'select'; };
    type.addEventListener('change', updateOptions);
    el('bexhrGaHeading')?.addEventListener('change', toggleNewHeading);
    el('bexhrGaCancelEdit')?.addEventListener('click', () => { clearEditor(); message('Edit cancelled.'); });
    updateOptions();
    el('bexhrGaAdd')?.addEventListener('click', async () => {
      const button = el('bexhrGaAdd');
      if (button.disabled) return;
      const headingKey = el('bexhrGaHeading')?.value || 'core';
      const newHeading = headingKey === 'other' ? el('bexhrGaNewHeading')?.value.trim() : '';
      const label = el('bexhrGaLabel')?.value.trim() || '';
      const fieldType = el('bexhrGaType')?.value || 'text';
      const options = fieldType === 'select' ? el('bexhrGaOptions').value.split(',').map((s) => s.trim()).filter(Boolean) : [];
      await busyButton(button, editingFieldId ? 'Saving...' : 'Adding...', async () => {
        try {
          assertReady();
          if (!editingFieldId && activeFields().length >= 100) throw new Error('Custom field limit reached.');
          const result = editingFieldId
            ? await rpc('bexhr_ga_update_field_v6', {
                p_field_id: editingFieldId, p_heading_key: headingKey, p_new_heading: newHeading,
                p_label: label, p_type: fieldType, p_required: !!el('bexhrGaRequired')?.checked, p_options: options,
              })
            : await rpc('bexhr_ga_add_field_v5', {
                p_heading_key: headingKey, p_new_heading: newHeading,
                p_label: label, p_type: fieldType, p_required: !!el('bexhrGaRequired')?.checked, p_options: options,
              });
          const edited = Boolean(editingFieldId);
          clearEditor();
          await refreshDefinitions();
          const newTab = el('employeeFormSteps')?.querySelector(`[data-employee-form-tab="${result.heading}"]`);
          newTab?.click();
          message(edited ? 'Field updated. Employee data has been preserved.' : 'Field added under ' + headingName(result.heading) + '.');
        } catch (error) { message(error.message, true); }
      });
    });
  }
  async function init(args = {}) {
    const profile = args.profile;
    if (!profile?.tenant_id || profile.role !== 'hr' || profile.is_active === false) return;
    if (ready && tenantId === String(profile.tenant_id)) return;
    tenantId = String(profile.tenant_id);
    isAdmin = String(profile.hr_access_level || '').trim().toLowerCase() === 'tenant_admin';
    db = args.client;
    renderShell();
    try {
      await refreshDefinitions();
      message(isAlpatech ? 'Alpatech extended biodata available.' : 'Standard employee form available.');
    } catch (error) {
      ready = false;
      document.body.classList.remove('bexhr-ga-alpatech', 'bexhr-ga-ready');
      message('Biodata configuration unavailable: ' + error.message, true);
    }
  }
  window.BexHrGroupA = Object.freeze({
    init, headers, acceptedHeaders, validateImportRow, saveImported, validateManual,
    saveManual, editEmployee, reset, isCustomHeading, requiredComplete,
    onTabChanged: syncSections,
    get ready() { return ready; },
    get alpatech() { return isAlpatech; },
  });
})();
