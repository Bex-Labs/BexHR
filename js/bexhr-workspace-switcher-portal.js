/* BEXHR_SWITCHER_PORTAL_LAYER_20261114
 * Presentation-only solution to application-card stacking contexts.
 * Display a floating COPY of the existing authorised workspace menu at body
 * level. The original server-derived menu remains the sole source of links.
 * Never request grants, change roles, alter session routing or cache rights.
 */
(() => {
  'use strict';
  const ID = 'bexhrWorkspaceSwitcherFloatingPortal';
  const READY_TRIGGER = '[data-bexhr-workspace-trigger="true"]';
  let trigger = null;
  let portal = null;
  let sourceMenu = null;
  let parentObserver = null;
  let frame = 0;
  let originalControls = null;

  function stopObserving() {
    if (parentObserver) parentObserver.disconnect();
    parentObserver = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function close({ returnFocus = false } = {}) {
    stopObserving();
    if (portal) portal.remove();
    portal = null;
    sourceMenu = null;
    const oldTrigger = trigger;
    trigger = null;
    if (oldTrigger?.isConnected) {
      oldTrigger.setAttribute('aria-expanded', 'false');
      if (originalControls === null) oldTrigger.removeAttribute('aria-controls');
      else oldTrigger.setAttribute('aria-controls', originalControls);
      if (returnFocus) oldTrigger.focus({ preventScroll: true });
    }
    originalControls = null;
  }

  function nativeMenuFor(button) {
    return button?.parentElement?.querySelector('[data-bexhr-workspace-menu]') || null;
  }

  function position() {
    frame = 0;
    if (!portal || !trigger || !trigger.isConnected || !sourceMenu?.isConnected) {
      close();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (rect.bottom <= 0 || rect.top >= viewportHeight) {
      close();
      return;
    }

    const gap = 10;
    const edge = 12;
    const width = Math.min(390, Math.max(180, viewportWidth - edge * 2));
    portal.style.width = width + 'px';
    portal.style.maxHeight = Math.max(100, viewportHeight - edge * 2) + 'px';
    const height = Math.min(portal.getBoundingClientRect().height, viewportHeight - edge * 2);
    const left = Math.min(viewportWidth - edge - width,
      Math.max(edge, rect.right - width));

    let top = rect.bottom + gap;
    const roomBelow = viewportHeight - edge - top;
    const roomAbove = rect.top - gap - edge;
    if (height > roomBelow && roomAbove > roomBelow) {
      top = rect.top - gap - height;
    }
    top = Math.max(edge, Math.min(top, viewportHeight - edge - height));

    portal.style.left = Math.round(left) + 'px';
    portal.style.top = Math.round(top) + 'px';
  }

  function requestPosition() {
    if (!portal || frame) return;
    frame = requestAnimationFrame(position);
  }

  function open(button, { keyboard = false } = {}) {
    const original = nativeMenuFor(button);
    if (!original || !original.querySelector('a[href]')) return false;
    close();

    // Keep session.js's original menu untouched and hidden. We only copy its
    // already-authorised navigation options, never construct role-based links.
    original.hidden = true;
    const copy = original.cloneNode(true);
    copy.removeAttribute('data-bexhr-workspace-menu');
    copy.id = ID;
    copy.hidden = false;
    copy.classList.add('bexhr-workspace-floating-portal');
    copy.setAttribute('role', 'menu');
    copy.setAttribute('aria-label', 'Switch workspace');
    copy.tabIndex = -1;

    document.body.appendChild(copy);
    portal = copy;
    trigger = button;
    sourceMenu = original;
    originalControls = button.getAttribute('aria-controls');
    button.setAttribute('aria-controls', ID);
    button.setAttribute('aria-expanded', 'true');

    // If session.js refreshes/revokes the native entitlement menu, close the
    // transient copy immediately. This also avoids stale navigation links.
    parentObserver = new MutationObserver(() => {
      if (!trigger?.isConnected || nativeMenuFor(trigger) !== sourceMenu) close();
    });
    parentObserver.observe(button.parentElement, { childList: true });

    copy.addEventListener('click', (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest('a[href]')) return;
      // Let the native anchor navigate normally; remove the popup afterward.
      window.setTimeout(() => close(), 0);
    });
    position();
    if (keyboard) copy.querySelector('a[href]')?.focus({ preventScroll: true });
    return true;
  }

  // Capture only valid server-enabled switcher triggers. Suppress the normal
  // *presentation* toggle in session.js, since it is clipped by page cards.
  // All actual links and protected routing remain the session.js originals.
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const button = element?.closest(READY_TRIGGER);
    if (button) {
      if (!nativeMenuFor(button)) return; // let native behaviour handle drift
      event.preventDefault();
      event.stopImmediatePropagation();
      if (portal && trigger === button) close();
      else open(button, { keyboard: event.detail === 0 });
      return;
    }
    if (!portal) return;
    if (element && portal.contains(element)) {
      // Keep global native document-close listener from hiding this menu.
      event.stopPropagation();
      return;
    }
    close(); // Outside action still runs normally.
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!portal || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close({ returnFocus: true });
  }, true);

  document.addEventListener('focusin', (event) => {
    if (!portal) return;
    const element = event.target;
    if (element === trigger || portal.contains(element)) return;
    close();
  }, true);

  document.addEventListener('scroll', (event) => {
    if (portal && !portal.contains(event.target)) requestPosition();
  }, true);
  window.addEventListener('resize', requestPosition, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
  });
  document.addEventListener('show.bs.modal', () => close(), true);
  window.addEventListener('pagehide', () => close());
})();
