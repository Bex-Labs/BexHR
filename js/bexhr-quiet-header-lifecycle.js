/* BexHR presentation correction: compact verified position, clean switcher,
 * retire two reported HR card collapse actions. No privilege/data mutation.
 * This runs after existing dashboard scripts without editing their internals.
 */
(() => {
  'use strict';
  const HR = !!document.querySelector('.hr-modern-app-header');
  const header = document.querySelector('.hr-modern-app-header, .manager-modern-app-header');
  if (!header) return;
  let scheduled = false;

  function hideDevelopmentBadge() {
    if (!HR) return;
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    const matches = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!/dual[ -]*role[ -]*pilot/i.test(node.textContent || '')) continue;
      const span = node.parentElement;
      if (!span || span.closest('.bexhr-workspace-menu') || span.closest('#hrRole')) continue;
      if (span.textContent.trim().length > 100 || span.querySelector('button, a, input')) continue;
      // Hide the outer visual badge, not just its inner text span.
      let badge = span;
      while (badge.parentElement && badge.parentElement !== header) {
        const parent = badge.parentElement;
        if (parent.closest('.hr-modern-account-button') ||
            parent.textContent.trim().length > 100 || parent.querySelector('button, a, input')) break;
        if (!/(badge|pill|chip|pilot|status)/i.test(String(parent.className || ''))) break;
        badge = parent;
      }
      matches.push(badge);
    }
    matches.forEach((span) => {
      if (span.dataset.bexhrInternalPilotHidden === 'true') return;
      span.dataset.bexhrInternalPilotHidden = 'true';
      span.classList.add('bexhr-internal-pilot-hidden');
      span.setAttribute('aria-hidden', 'true');
    });
  }

  function compactVerifiedPosition() {
    const chip = document.getElementById('bexhrH11LeadershipStatusChip');
    if (!chip || !header.contains(chip)) return;
    const copy = header.querySelector('.manager-modern-account-copy, .hr-modern-account-copy');
    const detail = chip.querySelector('.bexhr-h11-leadership-detail');
    const overline = chip.querySelector('.bexhr-h11-leadership-overline');
    if (!copy || !detail || !overline) return;

    // Retain ONLY server-verified content from the existing H11 position chip.
    // Do not infer an organisation-wide title from the user name, job title,
    // or HR permission. The existing chip remains its sole data source.
    if (!chip.dataset.bexhrFullPositionLabel) {
      const fullDetail = detail.textContent.trim();
      const fullScope = overline.textContent.trim();
      const separatorAt = fullDetail.indexOf('\u00b7');
      const jobTitle = (separatorAt >= 0 ? fullDetail.slice(0, separatorAt) : fullDetail).trim();
      if (!jobTitle || fullScope.toLowerCase() !== 'whole organisation') return;
      chip.dataset.bexhrFullPositionLabel = `${fullScope} | ${fullDetail}`;
      chip.setAttribute('title', chip.dataset.bexhrFullPositionLabel + ' (position context only)');
      detail.textContent = `${jobTitle} \u00b7 organisation-wide`;
      chip.classList.add('bexhr-quiet-position');
    }
    if (chip.parentElement !== copy) copy.appendChild(chip);
  }

  function syncHeader() {
    hideDevelopmentBadge();
    compactVerifiedPosition();
  }
  function scheduleHeader() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      syncHeader();
    });
  }
  new MutationObserver(scheduleHeader).observe(header, {
    subtree: true, childList: true, characterData: true
  });
  syncHeader();

  if (!HR) return;

  // Reported HR cards: keep the existing content and business handlers,
  // retire ONLY their decorative open/close controls, always leave content open.
  const cards = [
    ['toggleEmployeeLifecycleCardBtn', 'employeeLifecycleCardCollapse'],
    ['toggleEmployeeListCardBtn', 'employeeListCardCollapse']
  ];
  function keepOpen(button, panel) {
    button.classList.add('bexhr-retired-card-toggle');
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
    if (button.getAttribute('aria-expanded') !== 'true') {
      button.setAttribute('aria-expanded', 'true');
    }
    if (panel.classList.contains('d-none')) panel.classList.remove('d-none');
    if (panel.hidden) panel.hidden = false;
    if (panel.style.display === 'none') panel.style.removeProperty('display');
  }
  cards.forEach(([buttonId, panelId]) => {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    if (!button || !panel) return;
    keepOpen(button, panel);
    new MutationObserver(() => keepOpen(button, panel)).observe(panel, {
      attributes: true, attributeFilter: ['class', 'hidden', 'style']
    });
  });

  // Suppress inherited card-surface toggling but not working form controls,
  // employee rows, offboard actions, inputs, links or sidebar navigation.
  const safeTarget = (event) => event.target instanceof Element ? event.target : null;
  document.addEventListener('click', (event) => {
    const target = safeTarget(event);
    if (!target) return;
    if (target.closest('#toggleEmployeeLifecycleCardBtn, #toggleEmployeeListCardBtn')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!target.closest('#hrEmployeeLifecycleCard .hr-employee-lifecycle-header, #employeeListCardHeader')) return;
    if (target.closest('button, a, input, select, textarea, label, [role="button"], [role="link"]')) return;
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('dblclick', (event) => {
    const target = safeTarget(event);
    if (!target || !target.closest('#hrEmployeeLifecycleCard, .hr-employee-directory-card')) return;
    if (target.closest('button, a, input, select, textarea, label, table, summary, [contenteditable="true"]')) return;
    event.stopImmediatePropagation();
  }, true);
})();
