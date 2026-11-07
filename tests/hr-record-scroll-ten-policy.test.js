'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourceFile = process.env.BEXHR_TEN_RECORD_JS || path.resolve(__dirname, '../js/bexhr-ten-record-scroll.js');
const source = fs.readFileSync(sourceFile, 'utf8');
assert(source.includes('const LIMIT = 10'));
assert(source.includes('EXCLUDED_IDS'));
assert(source.includes('EXCLUDED_CONTAINERS'));
assert(source.includes('nextRow.getBoundingClientRect()'));
assert(source.includes('safeScale'));

function buildRow(n) {
  return {
    tagName: 'TR',
    style: { display: '' },
    hidden: false,
    getAttribute: () => '',
    matches: () => false,
    getBoundingClientRect: () => ({top: n * 48 + 60, bottom: n * 48 + 108}),
  };
}
function makeWrapper(id, n, modal = false) {
  let count = n;
  const tbody = { children: [], querySelector: () => null };
  const table = { tBodies: [tbody] };
  const props = new Map();
  const wrapper = {
    id: id,
    isConnected: true,
    dataset: {},
    scrollTop: 0,
    offsetWidth: 500,
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
    closest: () => modal ? {} : null,
    querySelector: (sel) => sel === 'table' ? table : null,
    getBoundingClientRect: () => ({ top: 0, bottom: 370, width: 500, height: 370 }),
    style: { setProperty: (k, v, important) => { assert.equal(important, 'important'); props.set(k, v); } },
    props: props,
    setCount: function (num) { count = num; tbody.children = Array.from({ length: num }, (_, i) => buildRow(i)); },
    tbody: tbody,
  };
  wrapper.setCount(count);
  return wrapper;
}
const short = makeWrapper('payrollRecordsTableWrapper', 6);
const exactTen = makeWrapper('pendingRequestsTableWrapper', 10);
const longList = makeWrapper('organizationDepartmentsTableWrapper', 11);
const directory = makeWrapper('employeeRecordsTableWrapper', 11);
const lifecycle = makeWrapper('hrEmployeeLifecycleTableWrapper', 11);
const inDialog = makeWrapper('modalTableWrapper', 11, true);
const wrappers = [short, exactTen, longList, directory, lifecycle, inDialog];
const fakeWindow = {
  requestAnimationFrame: (fn) => fn(),
  setTimeout: () => 1,
  addEventListener: () => {},
};
const document = {
  readyState: 'complete',
  querySelectorAll: () => wrappers,
  addEventListener: () => {},
};
class Observer { observe() {} disconnect() {} }
vm.runInNewContext(source, {
  document: document,
  window: fakeWindow,
  MutationObserver: Observer,
  ResizeObserver: Observer,
  getComputedStyle: (el) => ({ display: el.style?.display || 'table-row' }),
  console: console,
});
assert.equal(fakeWindow.BexHrTenRecordScroll.limit, 10);
assert.equal(short.dataset.bexhrTenRecordScroll, 'off');
assert.equal(short.props.get('max-height'), 'none');
assert.equal(exactTen.dataset.bexhrTenRecordScroll, 'off');
assert.equal(longList.dataset.bexhrTenRecordScroll, 'on');
assert(Number.parseFloat(longList.props.get('max-height')) > 300);
assert.equal(directory.dataset.bexhrTenRecordScroll, undefined);
assert.equal(lifecycle.dataset.bexhrTenRecordScroll, undefined);
assert.equal(inDialog.dataset.bexhrTenRecordScroll, undefined);

longList.setCount(6);
fakeWindow.BexHrTenRecordScroll.refresh();
assert.equal(longList.dataset.bexhrTenRecordScroll, 'off');
longList.setCount(11);
longList.tbody.children[0].style.display = 'none';
fakeWindow.BexHrTenRecordScroll.refresh();
assert.equal(longList.dataset.bexhrTenRecordScroll, 'off');
longList.tbody.children[0].style.display = '';
fakeWindow.BexHrTenRecordScroll.refresh();
assert.equal(longList.dataset.bexhrTenRecordScroll, 'on');
console.log('PASS: shared BexHR record-table scroll policy: 6/10 no scroll, 11 scroll, filtered rows, both People-managed lists and modal exclusions.');
