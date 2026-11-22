/* BEXHR_H12_MANAGER_APP_WORKSPACES_20261114
 * Navigation-only workspace switcher for every authorised Manager dashboard,
 * including managers without a secondary HR grant. Reuses existing dashboard
 * handlers and the session-created HR entry; never creates permissions, PA
 * context, or reviewer rights. The switcher never opens a protected route
 * directly: the current authenticated dashboard's handlers remain in charge.
 */
(() => {
  'use strict';

  const BUTTON_ID = 'bexhrH12ManagerAppWorkspaces';
  const MENU_ID = 'bexhrH12ManagerAppWorkspacesMenu';
  let button = null;
  let menu = null;
  let updateFrame = 0;
  let nativeObserver = null;

  const actions = [
    ['managerTabDashboardBtn', 'Manager Overview', 'Dashboard and manager priorities', 'bi-grid-1x2'],
    ['managerTabTeamBtn', 'Team Management', 'Reporting team and leave decisions', 'bi-people'],
    ['managerTabSelfServiceBtn', 'My Self-Service', 'Your leave and payroll', 'bi-person-badge'],
    ['sidebarManagerPerformanceAppraisalBtn', 'Performance Appraisal', 'Open your authorised PA workspace', 'bi-clipboard2-check'],
  ];

  function allowedManagerPage() {
    return /\/manager-dashboard(?:\.html)?$/i.test(window.location.pathname || '');
  }

  function close({ focus = false } = {}) {
    if (nativeObserver) nativeObserver.disconnect();
    nativeObserver = null;
    if (updateFrame) window.cancelAnimationFrame(updateFrame);
    updateFrame = 0;
    if (menu) menu.remove();
    menu = null;
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus({ preventScroll: true });
    }
  }

  function place() {
    updateFrame = 0;
    if (!menu || !button || !button.isConnected) {
      close();
      return;
    }
    const rect = button.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      close();
      return;
    }
    const width = Math.min(380, Math.max(200, (document.documentElement.clientWidth || window.innerWidth) - 24));
    menu.style.width = width + 'px';
    const viewportH = window.innerHeight;
    const height = Math.min(menu.getBoundingClientRect().height, viewportH - 24);
    let top = rect.bottom + 9;
    if (top + height > viewportH - 12 && rect.top > height + 21) {
      top = rect.top - height - 9;
    }
    menu.style.top = Math.max(12, Math.min(top, viewportH - 12 - height)) + 'px';
    menu.style.left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)) + 'px';
  }

  function queuePlace() {
    if (menu && !updateFrame) updateFrame = window.requestAnimationFrame(place);
  }

  function addOption(container, { label, description, icon, targetId, href, current = false }) {
    const item = document.createElement(href ? 'a' : 'button');
    if (href) item.setAttribute('href', href);
    else item.type = 'button';
    item.className = 'bexhr-workspace-menu-option' + (current ? ' is-current' : '');
    item.setAttribute('role', 'menuitem');
    if (current) item.setAttribute('aria-current', 'page');
    const iconBox = document.createElement('span');
    iconBox.className = 'bexhr-workspace-menu-option-icon';
    const glyph = document.createElement('i');
    glyph.className = 'bi ' + icon;
    glyph.setAttribute('aria-hidden', 'true');
    iconBox.appendChild(glyph);
    const copy = document.createElement('span');
    copy.className = 'bexhr-workspace-menu-option-copy';
    const strong = document.createElement('strong');
    strong.textContent = label;
    const small = document.createElement('small');
    small.textContent = description;
    copy.append(strong, small);
    item.append(iconBox, copy);
    if (!href) {
      item.addEventListener('click', () => {
        // Trigger only the existing Manager handler, which creates verified PA
        // context and performs the normal workspace / route checks.
        const target = document.getElementById(targetId);
        if (!target || target.disabled) return;
        close();
        target.click();
      });
    } else {
      item.addEventListener('click', () => close());
    }
    container.appendChild(item);
    return item;
  }

  function existingAuthorisedHrLink() {
    const account = document.querySelector('.manager-modern-account-area .manager-modern-account-button');
    if (account?.dataset.workspaceSwitcherReady !== 'true') return null;
    const native = account.parentElement?.querySelector('[data-bexhr-workspace-menu]');
    if (!native) return null;
    // Only reuse the link emitted by SessionManager after its live HR grant
    // and AAL2 entitlement check. Never infer an HR destination from a title.
    const link = Array.from(native.querySelectorAll('a[href]'))
      .find((a) => a.getAttribute('href') === 'hr-dashboard.html?workspace=hr');
    return link || null;
  }

  function open() {
    if (!button) return;
    close();
    const popup = document.createElement('div');
    popup.id = MENU_ID;
    popup.className = 'bexhr-workspace-menu bexhr-h12-manager-app-menu';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', 'Authorised workspaces');
    const heading = document.createElement('div');
    heading.className = 'bexhr-workspace-menu-heading';
    const title = document.createElement('span');
    title.textContent = 'Workspaces';
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Open the areas already available to your signed-in account.';
    heading.append(title, subtitle);
    popup.appendChild(heading);
    const options = document.createElement('div');
    options.className = 'bexhr-workspace-menu-options';
    for (const [targetId, label, description, icon] of actions) {
      if (document.getElementById(targetId)) {
        addOption(options, { label, description, icon, targetId });
      }
    }
    const hrLink = existingAuthorisedHrLink();
    if (hrLink) {
      const hr = addOption(options, {
        label: String(hrLink.querySelector('strong')?.textContent || 'HR Workspace').trim(),
        description: String(hrLink.querySelector('small')?.textContent || 'Server-authorised HR access').trim(),
        icon: 'bi-people-fill',
        href: hrLink.getAttribute('href'),
      });
      hr.dataset.bexhrHrFromNative = 'true';
      const accountArea = hrLink.closest('.manager-modern-account-area');
      if (accountArea) {
        nativeObserver = new MutationObserver(() => {
          if (!existingAuthorisedHrLink()) close();
        });
        nativeObserver.observe(accountArea, { childList: true, subtree: false });
      }
    }
    popup.appendChild(options);
    document.body.appendChild(popup);
    menu = popup;
    button.setAttribute('aria-expanded', 'true');
    place();
  }

  function init() {
    if (!allowedManagerPage()) return;
    const accountArea = document.querySelector('.manager-modern-account-area');
    if (!accountArea || document.getElementById(BUTTON_ID)) return;
    const firstAccountButton = accountArea.querySelector('.manager-modern-account-button');
    if (!firstAccountButton) return;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = BUTTON_ID;
    trigger.className = 'bexhr-h12-manager-app-workspaces-button';
    trigger.setAttribute('aria-label', 'Open workspace switcher');
    trigger.setAttribute('aria-controls', MENU_ID);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'menu');
    const icon = document.createElement('i');
    icon.className = 'bi bi-grid';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'bexhr-h12-manager-app-workspaces-label';
    label.textContent = 'Workspaces';
    trigger.append(icon, label);
    accountArea.insertBefore(trigger, firstAccountButton);
    button = trigger;
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu) close();
      else open();
    });
    document.addEventListener('pointerdown', (event) => {
      if (menu && !menu.contains(event.target) && !trigger.contains(event.target)) close();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (!menu || event.key !== 'Escape') return;
      event.preventDefault();
      close({ focus: true });
    }, true);
    document.addEventListener('focusin', (event) => {
      if (menu && !menu.contains(event.target) && event.target !== trigger) close();
    }, true);
    document.addEventListener('scroll', queuePlace, true);
    window.addEventListener('resize', queuePlace, { passive: true });
    window.addEventListener('pagehide', () => close());
    document.addEventListener('show.bs.modal', () => close(), true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
