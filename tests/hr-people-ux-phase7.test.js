'use strict';

// BexHR Phase 7A - accessible People UI focused regression.
// No Supabase connection, no browser dependency, no employee writes.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const repo = process.env.BEXHR_PHASE7_UX_TEST_ROOT || path.resolve(__dirname, '..');
function sourceAt(relativePath) {
  return fs.readFileSync(path.join(repo, relativePath), 'utf8').replace(/\r\n?/g, '\n');
}
const html = sourceAt('hr-dashboard.html');
const js = sourceAt('js/hr-dashboard.js');
const moduleSource = sourceAt('js/hr-people-ux-phase7.js');
const css = sourceAt('css/hr-people-accessibility-phase7.css');

assert.strictEqual((html.match(/id="sidebarPeopleLifecycleBtn"/g) || []).length, 1);
assert(html.includes('data-hr-navigation-task="people.lifecycle"'));
assert.strictEqual((html.match(/id="hrEmployeeLifecycleCard"/g) || []).length, 1);
assert(html.indexOf('id="hrEmployeeLifecycleCard"') < html.indexOf('id="hrReviewSection"'));
assert(html.includes('id="hrEmployeeLifecycleSearch"'));
assert(html.includes('id="hrEmployeeLifecycleStatusFilter"'));
assert(html.includes('id="hrEmployeeLifecycleList"'));
assert(html.includes('aria-live="polite"'));
assert(html.includes('id="toggleEmployeeListCardBtn"'));
assert(html.includes('aria-controls="employeeListCardCollapse"'));
assert(html.includes('Search, review, and maintain employee records.'));
assert(html.includes('css/hr-people-accessibility-phase7.css'));
assert(html.includes('js/hr-people-ux-phase7.js'));
assert(html.indexOf('src="js/hr-dashboard.js"') < html.indexOf('src="js/hr-people-ux-phase7.js"'));

assert(js.includes('"people.lifecycle": { workspace: "employees"'));
assert(js.includes('"people.import", "people.lifecycle"'));
assert(js.includes('case "people.lifecycle":'));
assert(js.includes('const lifecycleCard = document.getElementById("hrEmployeeLifecycleCard")'));
assert(js.includes('"people.lifecycle": lifecycleCard'));
assert(js.includes('row.dataset.hrEmployeeId = rawEmployeeId'));
assert(js.includes('window.BexHrPeopleUxPhase7?.enhanceDirectory?.(tbody)'));
assert(js.includes('window.BexHrPeopleUxPhase7?.closeMenu?.()'));
assert(js.includes('window.BexHrPeopleUxPhase7?.renderLifecycle?.()'));

// The new module must not independently read or write the database.
assert(!/\.rpc\s*\(/.test(moduleSource));
assert(!/supabase\s*\.\s*from\s*\(/i.test(moduleSource));
assert(moduleSource.includes('window.hrOffboardEmployee?.(employeeId)'));
assert(moduleSource.includes('window.hrReactivateEmployee?.(employeeId)'));
assert(moduleSource.includes("status === 'active' || status === 'exited'"));
assert(moduleSource.includes('window.hrViewEmployeeFilledForm?.(employeeId)'));
assert(moduleSource.includes("role', 'menu'"));
assert(moduleSource.includes('closeDirectoryMenu(true)'));
assert(moduleSource.includes('event.key === \'Escape\''));
assert(moduleSource.includes("/hr(?:Offboard|Reactivate)Employee/"));

assert(css.includes('body.dashboard-page[data-hr-navigation-task^="people."] .hr-modern-app-header'));
assert(css.includes('position: static !important'));
// Phase 7A2: retain semantic table rows at ordinary laptop widths. A giant
// one-card-per-employee layout is a regression even when a JS test passes.
assert(html.includes('<tbody id="hrEmployeeLifecycleList"></tbody>'));
assert(html.includes('class="hr-lifecycle-table hr-employee-directory-table"'));
assert(html.includes('class="hr-lifecycle-table-wrapper"'));
assert(html.includes('scope="col">Contact</th>'));
assert(html.includes('scope="col">Start Date</th>'));
assert(html.includes('id="hrEmployeeLifecycleTableWrapper"'));
assert(!html.includes('<ul id="hrEmployeeLifecycleList"'));
assert(css.includes('display: table !important'));
assert(css.includes('display: table-row !important'));
assert(css.includes('display: table-cell !important'));
// Phase 7A3: scroll is enabled by rendered record count, not by six row heights.
assert(css.includes('max-height: min(70vh, 740px)'));
assert(css.includes('hr-people-scroll-enabled'));
assert(css.includes('border-spacing: 0 0.45rem'));
assert(css.includes('#hrPeopleActionsPortal .hr-people-menu-item.hr-employee-action-btn > span'));
assert(css.includes('display: inline !important'));
assert(moduleSource.includes('INNER_SCROLL_THRESHOLD = 10'));
assert(moduleSource.includes("syncInnerScroll(list.closest?.('.hr-lifecycle-table-wrapper'), matching.length)"));
assert(css.includes('#toggleEmployeeListCardBtn'));
assert(css.includes('flex-direction: row !important'));
assert(!css.includes('max-width: 1535.98px'));
assert(css.includes('max-height: calc(100dvh - 24px)'));
assert(css.includes('position: fixed'));
assert(css.includes('min-height: 44px'));
assert(css.includes('forced-colors: active'));
assert(css.includes('prefers-reduced-motion: reduce'));
assert(moduleSource.includes("createElement('tr', 'hr-employee-directory-row hr-lifecycle-row')"));
assert(moduleSource.includes('getEmployeeDirectoryEmploymentStatusPresentation'));
assert(moduleSource.includes('getEmployeeDirectoryAccountStatusPresentation'));
assert(moduleSource.includes('getEmployeeAccountLinkage'));
assert(css.includes('body.dashboard-page #hrEmployeeLifecycleTableWrapper'));
assert(js.includes('normalizeText(employee.status || "active") !== "exited"'));
assert(!moduleSource.includes("createElement('li', 'hr-lifecycle-record')"));

// Evaluate the actual module (not a duplicate implementation) and exercise
// tenant-provided input lists, Active/Exited filtering, and tokenized search.
const callbacks = {};
const context = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener: (eventName, callback) => { callbacks[eventName] = callback; },
  },
};
vm.runInNewContext(moduleSource, context, { filename: 'hr-people-ux-phase7.js' });
const filterRecords = context.window.BexHrPeopleUxPhase7?.filterRecords;
assert.strictEqual(typeof filterRecords, 'function');
const fixtures = [
  { id: 'a', first_name: 'Ada', last_name: 'Umeh', employee_number: 'EMP-1', status: 'Active', job_title: 'Engineer', work_email: 'ada@example.test' },
  { id: 'b', first_name: 'Emeka', last_name: 'Sule', employee_number: 'EMP-2', status: 'Exited', job_title: 'Accountant', work_email: 'emeka@example.test' },
  { id: 'c', first_name: 'Kemi', last_name: 'Ariyo', employee_number: 'EMP-3', status: 'Pending', job_title: 'Analyst', work_email: 'kemi@example.test' },
];
assert.deepStrictEqual(Array.from(filterRecords(fixtures, 'active', ''), (x) => x.id), ['a']);
assert.deepStrictEqual(Array.from(filterRecords(fixtures, 'exited', ''), (x) => x.id), ['b']);
assert.deepStrictEqual(Array.from(filterRecords(fixtures, 'all', 'ada eng'), (x) => x.id), ['a']);
assert.deepStrictEqual(Array.from(filterRecords(fixtures, 'all', 'EMP-2'), (x) => x.id), ['b']);
assert.strictEqual(filterRecords(fixtures, 'exited', 'Ada').length, 0);
assert.strictEqual(filterRecords([], 'all', '').length, 0);

// Render the real module against a minimal DOM. Verify six semantic cells
// per row, active-only Offboard, exited-only Reactivate, and view-only mode.
class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => { if (enabled) this.classes.add(name); else this.classes.delete(name); },
      contains: (name) => this.classes.has(name),
    };
    this.children = [];
    this.attrs = {};
    this.handlers = {};
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.type = '';
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(key, callback) { this.handlers[key] = callback; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}
const ids = Object.fromEntries(
  ['hrEmployeeLifecycleList', 'hrEmployeeLifecycleStatusFilter',
    'hrEmployeeLifecycleSearch', 'hrEmployeeLifecycleResultCount',
    'hrEmployeeLifecycleEmpty'].map((id) => [id, new FakeNode('div')]),
);
const lifecycleScrollWrapper = new FakeNode('div');
ids.hrEmployeeLifecycleList.closest = () => lifecycleScrollWrapper;
ids.hrEmployeeLifecycleStatusFilter.value = 'all';
const invocations = [];
const dynamicContext = {
  state: { employees: fixtures },
  canCurrentUserMaintainPeopleData: () => true,
  window: {
    hrViewEmployeeFilledForm: (id) => invocations.push(['profile', id]),
    hrOffboardEmployee: (id) => invocations.push(['offboard', id]),
    hrReactivateEmployee: (id) => invocations.push(['reactivate', id]),
  },
  document: {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: (id) => ids[id] || null,
    createElement: (name) => new FakeNode(name),
  },
};
vm.runInNewContext(moduleSource, dynamicContext);
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(ids.hrEmployeeLifecycleList.children.length, 3);
assert.strictEqual(lifecycleScrollWrapper.classList.contains('hr-people-scroll-enabled'), false);
const rows = ids.hrEmployeeLifecycleList.children;
rows.forEach((row) => {
  assert.strictEqual(row.tagName, 'tr');
  assert.strictEqual(row.children.length, 6);
  row.children.forEach((cell) => assert.strictEqual(cell.tagName, 'td'));
});
assert.strictEqual(rows[0].children[5].children[0].textContent, 'Offboard');
assert.strictEqual(rows[0].children[0].children[0].children[0].textContent, 'AU');
assert.strictEqual(rows[0].children[3].children[0].children.length, 2);
assert.strictEqual(rows[1].children[5].children[0].textContent, 'Reactivate');
assert.strictEqual(rows[2].children[5].children[0].textContent, 'View only');
rows[0].children[0].children[0].children[1].children[0].handlers.click();
rows[0].children[5].children[0].handlers.click();
rows[1].children[5].children[0].handlers.click();
assert.deepStrictEqual(invocations, [
  ['profile', 'a'], ['offboard', 'a'], ['reactivate', 'b'],
]);
ids.hrEmployeeLifecycleStatusFilter.value = 'exited';
ids.hrEmployeeLifecycleSearch.value = 'Sule';
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(ids.hrEmployeeLifecycleList.children.length, 1);
assert.strictEqual(ids.hrEmployeeLifecycleList.children[0].children[0].children[0].children[1].children[0].textContent, 'Emeka Sule');
ids.hrEmployeeLifecycleSearch.value = 'Ada';
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(ids.hrEmployeeLifecycleList.children.length, 0);
assert.strictEqual(ids.hrEmployeeLifecycleEmpty.hidden, false);
dynamicContext.canCurrentUserMaintainPeopleData = () => false;
ids.hrEmployeeLifecycleStatusFilter.value = 'all';
ids.hrEmployeeLifecycleSearch.value = '';
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(ids.hrEmployeeLifecycleList.children[0].children[5].children[0].textContent, 'View only');

// Test exactly 10 results, then 11, and verify filtered results remove the scrollbar.
const createStaff = (n) => ({ id: 'extra-' + n, first_name: 'Staff', last_name: String(n),
  employee_number: 'EMP-' + n, status: 'Active', job_title: 'Analyst' });
dynamicContext.state.employees = Array.from({ length: 10 }, (_, i) => createStaff(i + 1));
ids.hrEmployeeLifecycleStatusFilter.value = 'all';
ids.hrEmployeeLifecycleSearch.value = '';
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(lifecycleScrollWrapper.classList.contains('hr-people-scroll-enabled'), false);
dynamicContext.state.employees.push(createStaff(11));
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(lifecycleScrollWrapper.classList.contains('hr-people-scroll-enabled'), true);
ids.hrEmployeeLifecycleSearch.value = 'Staff 11';
dynamicContext.window.BexHrPeopleUxPhase7.renderLifecycle();
assert.strictEqual(lifecycleScrollWrapper.classList.contains('hr-people-scroll-enabled'), false);
const dirWrapper = new FakeNode('div');
const directoryStub = { querySelectorAll: () => Array.from({ length: 11 }, () => ({ querySelector: () => null, dataset: { hrEmployeeId: '' } })) };
dynamicContext.document.getElementById = (id) => id === 'employeeRecordsTableWrapper' ? dirWrapper : ids[id] || null;
ids.hrEmployeeLifecycleSearch.value = '';
dynamicContext.window.BexHrPeopleUxPhase7.enhanceDirectory(directoryStub);
assert.strictEqual(dirWrapper.classList.contains('hr-people-scroll-enabled'), true);
directoryStub.querySelectorAll = () => Array.from({ length: 6 }, () => ({ querySelector: () => null, dataset: { hrEmployeeId: '' } }));
dynamicContext.window.BexHrPeopleUxPhase7.enhanceDirectory(directoryStub);
assert.strictEqual(dirWrapper.classList.contains('hr-people-scroll-enabled'), false);

console.log('PASS: Phase 7A5 Lifecycle mirrors Directory six-column identity, role, two pills, scroll threshold and protected actions; exited employees excluded from operational Directory only.');
