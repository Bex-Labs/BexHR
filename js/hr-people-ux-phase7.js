/*
 * BexHR Phase 7A - Accessible People navigation and lifecycle workspace.
 * UI only. This module does not write employee data, request privileges,
 * change payroll calculations, or make Supabase calls.
 *
 * Loaded as a classic script after hr-dashboard.js, so it reuses the
 * existing tenant-filtered state and protected window.hr* handlers.
 */
(() => {
  'use strict';

  const PORTAL_ID = 'hrPeopleActionsPortal';
  const LIFE_LIST_ID = 'hrEmployeeLifecycleList';
  const INNER_SCROLL_THRESHOLD = 10;
  let openAction = null;
  let portal = null;
  let listenersBound = false;

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function getRecords() {
    return Array.isArray(state?.employees) ? state.employees : [];
  }

  function isPeopleMaintainer() {
    return typeof canCurrentUserMaintainPeopleData === 'function' &&
      canCurrentUserMaintainPeopleData();
  }

  function employeeName(employee) {
    return [employee?.first_name, employee?.middle_name, employee?.last_name]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ') || String(employee?.work_email || 'Employee').trim() || 'Employee';
  }

  function normalizedStatus(employee) {
    return String(employee?.status || 'active').trim().toLowerCase();
  }

  // Avoid inner scrollbars for small teams (including six-person companies).
  // Large employee lists stay bounded; results/search filters determine the count.
  function syncInnerScroll(wrapper, renderedCount) {
    if (!wrapper?.classList?.toggle) return;
    wrapper.classList.toggle('hr-people-scroll-enabled', renderedCount > INNER_SCROLL_THRESHOLD);
  }

  function closeDirectoryMenu(restoreFocus = false) {
    if (!openAction) return;

    const { anchor, originalContainer, movedItems } = openAction;
    movedItems.forEach((item) => {
      item.removeAttribute('role');
      item.classList.remove('hr-people-menu-item');
      const label = item.querySelector('span[data-original-label]');
      if (label) {
        label.textContent = label.dataset.originalLabel;
        delete label.dataset.originalLabel;
      }
      if (originalContainer.isConnected) originalContainer.appendChild(item);
    });
    if (anchor.isConnected) anchor.setAttribute('aria-expanded', 'false');

    if (portal) {
      portal.hidden = true;
      portal.replaceChildren();
      portal.style.visibility = '';
    }
    openAction = null;

    if (restoreFocus && anchor.isConnected) {
      anchor.focus({ preventScroll: true });
    }
  }

  function ensurePortal() {
    if (portal?.isConnected) return portal;
    portal = document.getElementById(PORTAL_ID);
    if (!portal) {
      portal = createElement('div', 'hr-people-actions-portal');
      portal.id = PORTAL_ID;
      portal.setAttribute('role', 'menu');
      portal.setAttribute('aria-label', 'Employee actions');
      portal.hidden = true;
      document.body.appendChild(portal);
    }
    // The existing inline handlers run on the clicked button; the bubbled
    // event then closes the menu so it never floats above an access modal.
    if (portal.dataset.hrPeopleMenuBound !== 'true') {
      portal.dataset.hrPeopleMenuBound = 'true';
      portal.addEventListener('click', (event) => {
        if (event.target?.closest?.('button.hr-employee-action-btn')) {
          closeDirectoryMenu(false);
        }
      });
    }
    return portal;
  }

  function readableActionLabel(button) {
    const label = button.querySelector('span')?.textContent?.trim() ||
      button.getAttribute('aria-label') || 'Employee action';
    if (label === 'Login') return 'Send / resend login invite';
    if (label === 'Access') return 'Manage employee access';
    if (label === 'Managers') return 'Manage reporting managers';
    if (label === 'Edit') return 'Edit employee profile';
    return label;
  }

  function getEnabledMenuItems() {
    return Array.from(portal?.querySelectorAll('[role="menuitem"]') || [])
      .filter((button) => !button.disabled);
  }

  function positionPortal(anchor) {
    const menu = ensurePortal();
    const viewportPadding = 12;
    const anchorRect = anchor.getBoundingClientRect();
    const width = Math.max(1, Math.min(312, window.innerWidth - viewportPadding * 2));

    menu.style.width = `${width}px`;
    menu.style.visibility = 'hidden';
    menu.hidden = false;

    const height = menu.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const preferredTop = spaceBelow >= height + 12
      ? anchorRect.bottom + 8
      : Math.max(viewportPadding, anchorRect.top - height - 8);
    const preferredLeft = Math.max(
      viewportPadding,
      Math.min(anchorRect.right - width, window.innerWidth - width - viewportPadding),
    );

    menu.style.left = `${preferredLeft}px`;
    menu.style.top = `${preferredTop}px`;
    menu.style.visibility = 'visible';
  }

  function openDirectoryMenu(anchor, row, originalContainer) {
    if (openAction?.anchor === anchor) {
      closeDirectoryMenu(true);
      return;
    }

    closeDirectoryMenu(false);
    const menu = ensurePortal();
    menu.replaceChildren();

    const employeeId = String(row.dataset.hrEmployeeId || '').trim();
    const employeeDisplayName = row.dataset.hrEmployeeName || 'employee';
    if (!employeeId) return;

    const viewProfile = createElement('button', 'hr-people-menu-item');
    viewProfile.type = 'button';
    viewProfile.setAttribute('role', 'menuitem');
    viewProfile.setAttribute('aria-label', `View profile for ${employeeDisplayName}`);
    viewProfile.append(
      createElement('i', 'bi bi-person-vcard'),
      createElement('span', '', 'View employee profile'),
    );
    viewProfile.addEventListener('click', () => {
      closeDirectoryMenu(false);
      window.hrViewEmployeeFilledForm?.(employeeId);
    });
    menu.appendChild(viewProfile);

    // Move the existing, permission-aware action buttons into a fixed portal.
    // Moving rather than cloning preserves their inline handlers, disabled
    // states, login-progress selectors, and all existing access checks.
    const movedItems = Array.from(originalContainer.querySelectorAll('button.hr-employee-action-btn'))
      .filter((button) => !/hr(?:Offboard|Reactivate)Employee/.test(button.getAttribute('onclick') || ''));

    movedItems.forEach((button) => {
      button.setAttribute('role', 'menuitem');
      button.classList.add('hr-people-menu-item');
      const label = button.querySelector('span');
      if (label) {
        label.dataset.originalLabel = label.textContent || '';
        label.textContent = readableActionLabel(button);
      }
      menu.appendChild(button);
    });

    openAction = { anchor, originalContainer, movedItems };
    anchor.setAttribute('aria-expanded', 'true');
    positionPortal(anchor);

    const enabledItems = getEnabledMenuItems();
    (enabledItems[0] || anchor).focus({ preventScroll: true });
  }

  function enhanceDirectory(tbody) {
    closeDirectoryMenu(false);
    if (!tbody) return;

    const renderedRows = Array.from(tbody.querySelectorAll('tr.hr-employee-directory-row'));
    syncInnerScroll(document.getElementById('employeeRecordsTableWrapper'), renderedRows.length);
    for (const row of renderedRows) {
      const actionCell = row.querySelector('.hr-employee-actions-cell');
      const originalContainer = actionCell?.querySelector('.hr-employee-row-actions');
      const employeeId = String(row.dataset.hrEmployeeId || '').trim();
      if (!actionCell || !originalContainer || !employeeId) continue;
      if (row.classList.contains('hr-action-menu-ready')) continue;

      // Phase 7 lifecycle controls belong to their protected People submenu,
      // not in routine directory actions. The backend handlers remain intact.
      for (const button of originalContainer.querySelectorAll('button.hr-employee-action-btn')) {
        if (/hr(?:Offboard|Reactivate)Employee/.test(button.getAttribute('onclick') || '')) {
          button.remove();
        }
      }

      const toggle = createElement('button', 'hr-people-actions-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-haspopup', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', PORTAL_ID);
      toggle.setAttribute('aria-label', `Actions for ${row.dataset.hrEmployeeName || 'employee'}`);
      toggle.append(
        createElement('span', '', 'Actions'),
        createElement('i', 'bi bi-three-dots-vertical'),
      );
      toggle.addEventListener('click', () => openDirectoryMenu(toggle, row, originalContainer));
      toggle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        openDirectoryMenu(toggle, row, originalContainer);
      });

      // Mark ready only after a usable replacement control exists. Without
      // this class the original buttons remain visible (fail-open for UI).
      actionCell.appendChild(toggle);
      row.classList.add('hr-action-menu-ready');
    }

    renderLifecycle();
  }

  function filterLifecycleRecords(all, statusFilter = 'all', search = '') {
    const searchTokens = String(search || '')
      .toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return (Array.isArray(all) ? all : []).filter((employee) => {
      const status = normalizedStatus(employee);
      if (statusFilter === 'active' && status !== 'active') return false;
      if (statusFilter === 'exited' && status !== 'exited') return false;
      const searchable = [
        employeeName(employee),
        employee?.employee_number,
        employee?.work_email,
        employee?.department,
        employee?.job_title,
      ].map((value) => String(value || '').toLocaleLowerCase()).join(' ');
      return searchTokens.every((token) => searchable.includes(token));
    });
  }

  // Lifecycle mirrors the Directory's exact employee identity, contact,
  // role, two status pills and start-date presentation. Only its final
  // action differs: protected Offboard/Reactivate instead of Actions.
  function renderLifecycle() {
    const list = document.getElementById(LIFE_LIST_ID);
    if (!list) return;
    const all = getRecords();
    const statusFilter = document.getElementById('hrEmployeeLifecycleStatusFilter')?.value || 'all';
    const search = document.getElementById('hrEmployeeLifecycleSearch')?.value || '';
    const matching = filterLifecycleRecords(all, statusFilter, search);
    syncInnerScroll(list.closest?.('.hr-lifecycle-table-wrapper'), matching.length);

    const countLabel = document.getElementById('hrEmployeeLifecycleResultCount');
    if (countLabel) countLabel.textContent = `Showing ${matching.length} of ${all.length} employee records`;
    const empty = document.getElementById('hrEmployeeLifecycleEmpty');
    if (empty) empty.hidden = matching.length !== 0;
    list.replaceChildren();

    const canMaintain = isPeopleMaintainer();
    for (const employee of matching) {
      const employeeId = String(employee?.id || '').trim();
      if (!employeeId) continue;
      const name = employeeName(employee);
      const status = normalizedStatus(employee);
      const initials = typeof getInitials === 'function'
        ? getInitials(name, 'E')
        : name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'E';
      const account = typeof getEmployeeAccountLinkage === 'function'
        ? getEmployeeAccountLinkage(employee)
        : { code: 'unlinked', label: 'Unlinked' };
      const employmentStyle = typeof getEmployeeDirectoryEmploymentStatusPresentation === 'function'
        ? getEmployeeDirectoryEmploymentStatusPresentation(employee.status)
        : { iconClass: 'bi-circle-fill', toneClass: 'hr-employee-status-pill--neutral' };
      const accountStyle = typeof getEmployeeDirectoryAccountStatusPresentation === 'function'
        ? getEmployeeDirectoryAccountStatusPresentation(account)
        : { iconClass: 'bi-person-x-fill', toneClass: 'hr-employee-status-pill--neutral' };
      const employmentLabel = typeof formatStatusLabel === 'function'
        ? formatStatusLabel(employee.status || 'Active')
        : status.charAt(0).toUpperCase() + status.slice(1);
      const accountLabel = String(account.label || 'Unlinked');
      const roleLabel = typeof formatEmployeeAccessRoleLabel === 'function'
        ? formatEmployeeAccessRoleLabel(employee)
        : String(employee.system_role || employee.hr_access_level || 'Employee');
      const startDate = typeof formatDate === 'function'
        ? formatDate(employee.employment_date)
        : String(employee.employment_date || '--');

      const record = createElement('tr', 'hr-employee-directory-row hr-lifecycle-row');
      const employeeCell = createElement('td', 'hr-employee-primary-cell');
      employeeCell.setAttribute('data-label', 'Employee');
      const identity = createElement('div', 'hr-employee-identity');
      const avatar = createElement('span', 'hr-employee-avatar', initials);
      avatar.setAttribute('aria-hidden', 'true');
      const identityCopy = createElement('div', 'hr-employee-identity-copy');
      const profileButton = createElement('button', 'hr-employee-name-button', name);
      profileButton.type = 'button';
      profileButton.setAttribute('aria-label', `Open employee profile details for ${name}`);
      profileButton.addEventListener('click', () => window.hrViewEmployeeFilledForm?.(employeeId));
      identityCopy.append(profileButton, createElement('span', 'hr-employee-number', employee.employee_number || 'Employee ID pending'));
      identity.append(avatar, identityCopy);
      employeeCell.append(identity);

      const contactCell = createElement('td');
      contactCell.setAttribute('data-label', 'Contact');
      contactCell.append(
        createElement('div', 'hr-employee-cell-primary text-break', employee.work_email || '--'),
        createElement('div', 'hr-employee-cell-secondary', employee.phone_number || 'No phone number'),
      );

      const roleCell = createElement('td');
      roleCell.setAttribute('data-label', 'Role');
      roleCell.append(
        createElement('div', 'hr-employee-cell-primary', employee.department || 'No department'),
        createElement('div', 'hr-employee-cell-secondary', employee.job_title || 'No job title'),
        createElement('span', 'hr-employee-role-badge', roleLabel),
      );

      const statusCell = createElement('td', 'hr-employee-status-cell');
      statusCell.setAttribute('data-label', 'Status');
      const statusStack = createElement('div', 'hr-employee-status-stack');
      const employmentPill = createElement('span', `hr-employee-status-pill ${employmentStyle.toneClass || ''}`);
      const employmentIcon = createElement('i', `bi ${employmentStyle.iconClass || 'bi-circle-fill'}`);
      employmentIcon.setAttribute('aria-hidden', 'true');
      employmentPill.append(employmentIcon, createElement('span', '', employmentLabel));
      const accountPill = createElement('span', `hr-employee-status-pill ${accountStyle.toneClass || ''}`);
      const accountIcon = createElement('i', `bi ${accountStyle.iconClass || 'bi-person-x-fill'}`);
      accountIcon.setAttribute('aria-hidden', 'true');
      accountPill.append(accountIcon, createElement('span', '', accountLabel));
      statusStack.append(employmentPill, accountPill);
      statusCell.append(statusStack);

      const dateCell = createElement('td');
      dateCell.setAttribute('data-label', 'Start Date');
      dateCell.append(createElement('span', 'hr-employee-start-date', startDate));

      const actionCell = createElement('td', 'hr-employee-actions-cell hr-lifecycle-action-cell');
      actionCell.setAttribute('data-label', 'Action');
      if (canMaintain && (status === 'active' || status === 'exited')) {
        const isActive = status === 'active';
        const action = createElement(
          'button',
          `hr-lifecycle-operation ${isActive ? 'hr-lifecycle-operation--offboard' : 'hr-lifecycle-operation--reactivate'}`,
          isActive ? 'Offboard' : 'Reactivate',
        );
        action.type = 'button';
        action.setAttribute('aria-label', `${isActive ? 'Offboard employee' : 'Reactivate employee'}: ${name}`);
        action.addEventListener('click', () => {
          if (isActive) window.hrOffboardEmployee?.(employeeId);
          else window.hrReactivateEmployee?.(employeeId);
        });
        actionCell.append(action);
      } else {
        actionCell.append(createElement('span', 'hr-lifecycle-readonly', 'View only'));
      }
      record.append(employeeCell, contactCell, roleCell, statusCell, dateCell, actionCell);
      list.append(record);
    }
  }

  function bind() {
    if (listenersBound) return;
    listenersBound = true;
    ensurePortal();

    document.getElementById('hrEmployeeLifecycleSearch')
      ?.addEventListener('input', renderLifecycle);
    document.getElementById('hrEmployeeLifecycleStatusFilter')
      ?.addEventListener('change', renderLifecycle);

    document.addEventListener('pointerdown', (event) => {
      if (!openAction) return;
      if (portal?.contains(event.target) || openAction.anchor.contains(event.target)) return;
      closeDirectoryMenu(false);
    });

    document.addEventListener('keydown', (event) => {
      if (!openAction) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDirectoryMenu(true);
        return;
      }
      if (event.key === 'Tab') {
        // Restore focus to the visible trigger before removing the portal's
        // focused item. This avoids leaving focus in a hidden action container.
        closeDirectoryMenu(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const enabledItems = getEnabledMenuItems();
      if (!enabledItems.length) return;
      event.preventDefault();
      const index = enabledItems.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      enabledItems[(index + delta + enabledItems.length) % enabledItems.length]
        .focus({ preventScroll: true });
    });

    window.addEventListener('resize', () => closeDirectoryMenu(false));
    window.addEventListener('scroll', (event) => {
      if (!openAction || portal?.contains(event.target)) return;
      // Zoomed or short viewports can scroll the trigger into view just as
      // the menu opens. Keep the portal anchored instead of closing it.
      window.requestAnimationFrame(() => {
        if (!openAction) return;
        const rect = openAction.anchor.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          closeDirectoryMenu(false);
        } else {
          positionPortal(openAction.anchor);
        }
      });
    }, true);

    renderLifecycle();
  }

  window.BexHrPeopleUxPhase7 = Object.freeze({
    bind,
    enhanceDirectory,
    renderLifecycle,
    closeMenu: closeDirectoryMenu,
    filterRecords: filterLifecycleRecords,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
