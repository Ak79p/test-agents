import { ENUMS, validateCatalogue, validateTest } from '/lib/catalogue.mjs';

const FILTER_KEYS = ['layer', 'priority', 'automationStatus', 'latestResult'];
const LIST_FIELDS = [
  ['preconditions', 'Preconditions'],
  ['testData', 'Test data'],
  ['steps', 'Steps'],
  ['expectedResults', 'Expected results'],
  ['references', 'References'],
];

const state = {
  catalogue: null,
  filters: { q: '', layer: '', priority: '', automationStatus: '', latestResult: '' },
  sort: { key: 'id', dir: 1 },
  openId: null,
  dirty: false,
};

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

const slug = (v) => String(v).toLowerCase().replace(/\s+/g, '-');
const badge = (field, value) => el('span', { class: `badge ${field}-${slug(value)}`, 'data-value': value, text: value });
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- server I/O

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the catalogue server. Start it with "npm start" in test-manager/.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details;
    throw err;
  }
  return data;
}

function showBanner(message, kind = 'info', details) {
  const banner = $('#banner');
  banner.replaceChildren(el('strong', { text: message }));
  if (Array.isArray(details) && details.length) banner.append(el('ul', {}, details.map((d) => el('li', { text: d }))));
  banner.className = `banner banner-${kind}`;
  banner.dataset.kind = kind;
  banner.hidden = false;
  clearTimeout(showBanner.timer);
  if (kind === 'success') showBanner.timer = setTimeout(() => (banner.hidden = true), 3500);
}

async function load() {
  try {
    state.catalogue = await api('GET', '/api/catalogue');
    $('#app-name').textContent = state.catalogue.application || '';
    render();
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

// ---------------------------------------------------------------- filters / URL

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.filters.q = p.get('q') || '';
  for (const k of FILTER_KEYS) state.filters[k] = p.get(k) || '';
  $('#search').value = state.filters.q;
  for (const k of FILTER_KEYS) $(`#filter-${k}`).value = state.filters[k];
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) if (v) p.set(k, v);
  const qs = p.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

function matches(t) {
  const f = state.filters;
  for (const k of FILTER_KEYS) if (f[k] && t[k] !== f[k]) return false;
  if (!f.q) return true;
  const haystack = [t.id, t.title, t.objective, t.risk, t.notes, t.scriptPath, ...t.steps, ...t.expectedResults, ...t.references]
    .join('\n')
    .toLowerCase();
  return f.q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function compare(a, b) {
  const { key, dir } = state.sort;
  const order = ENUMS[key];
  const av = order ? order.indexOf(a[key]) : a[key] ?? '';
  const bv = order ? order.indexOf(b[key]) : b[key] ?? '';
  if (av < bv) return -dir;
  if (av > bv) return dir;
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------- rendering

function renderSummary(tests) {
  const count = (pred) => tests.filter(pred).length;
  const items = [
    ['Total', tests.length, 'total'],
    ['API', count((t) => t.layer === 'API'), 'api'],
    ['UI', count((t) => t.layer === 'UI'), 'ui'],
    ['Performance', count((t) => t.layer === 'Performance'), 'performance'],
    ['Automated', count((t) => t.automationStatus === 'automated'), 'automated'],
    ['Passed', count((t) => t.latestResult === 'passed'), 'passed'],
    ['Failed', count((t) => t.latestResult === 'failed'), 'failed'],
    ['Not run', count((t) => t.latestResult === 'not run'), 'not-run'],
  ];
  $('#summary').replaceChildren(
    ...items.map(([label, value, key]) =>
      el('div', { class: 'stat', 'data-testid': `summary-${key}` }, el('span', { class: 'stat-value', text: String(value) }), el('span', { class: 'stat-label', text: label })),
    ),
  );
}

function render() {
  const tests = state.catalogue.tests;
  renderSummary(tests);
  const visible = tests.filter(matches).sort(compare);
  $('#result-count').textContent = `Showing ${visible.length} of ${tests.length} test cases`;

  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.setAttribute('aria-sort', th.dataset.sort === state.sort.key ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  }

  const rows = visible.map((t) =>
    el(
      'tr',
      { 'data-testid': `row-${t.id}`, tabindex: '0', onclick: () => openDetail(t.id), onkeydown: (e) => e.key === 'Enter' && openDetail(t.id) },
      el('td', { class: 'mono nowrap', 'data-label': 'ID', text: t.id }),
      el('td', { class: 'title-cell', 'data-label': 'Title', text: t.title }),
      el('td', { 'data-label': 'Layer' }, badge('layer', t.layer)),
      el('td', { 'data-label': 'Priority' }, badge('priority', t.priority)),
      el('td', { 'data-label': 'Target', text: t.automationTarget }),
      el('td', { 'data-label': 'Automation' }, badge('automation', t.automationStatus)),
      el('td', { 'data-label': 'Result' }, badge('result', t.latestResult)),
      el('td', { class: 'nowrap', 'data-label': 'Last run', text: t.lastExecuted || '—' }),
    ),
  );
  if (!rows.length) rows.push(el('tr', {}, el('td', { colspan: '8', class: 'empty', text: 'No test cases match the filters.' })));
  $('#rows').replaceChildren(...rows);
}

// ---------------------------------------------------------------- detail dialog

function section(title, content) {
  return el('section', { class: 'detail-section' }, el('h3', { text: title }), content);
}

function list(items, ordered, testId) {
  if (!items.length) return el('p', { class: 'muted', text: 'None' });
  return el(ordered ? 'ol' : 'ul', { 'data-testid': testId }, items.map((i) => el('li', { text: i })));
}

function field(label, control) {
  return el('label', { class: 'field' }, el('span', { text: label }), control);
}

function select(name, value) {
  return el('select', { name, 'data-testid': `edit-${name}` }, ENUMS[name].map((v) => el('option', { value: v, selected: v === value, text: v })));
}

function openDetail(id) {
  const t = state.catalogue.tests.find((x) => x.id === id);
  if (!t) return showBanner(`Test case ${id} was not found.`, 'error');
  state.openId = id;
  state.dirty = false;
  history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
  renderDetail(t, false);
  const dialog = $('#detail');
  if (!dialog.open) dialog.showModal();
}

function renderDetail(t, editingContent) {
  const header = el(
    'header',
    { class: 'detail-header' },
    el(
      'div',
      {},
      el('div', { class: 'detail-id mono', 'data-testid': 'detail-id', text: t.id }),
      el('h2', { id: 'detail-title', 'data-testid': 'detail-title', text: t.title }),
      el('div', { class: 'badges' }, badge('layer', t.layer), badge('priority', t.priority), badge('automation', t.automationStatus), badge('result', t.latestResult)),
    ),
    el('button', { type: 'button', class: 'btn', 'aria-label': 'Close', 'data-testid': 'close-detail', onclick: closeDetail, text: 'Close' }),
  );

  const content = editingContent ? contentForm(t) : procedureView(t);
  $('#detail-body').replaceChildren(header, trackingForm(t), content);
}

function procedureView(t) {
  return el(
    'div',
    { class: 'procedure', 'data-testid': 'procedure' },
    el(
      'div',
      { class: 'procedure-head' },
      el('h3', { text: 'Test procedure' }),
      el('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'edit-content', onclick: () => renderDetail(t, true), text: 'Edit content' }),
    ),
    section('Business objective', el('p', { 'data-testid': 'detail-objective', text: t.objective })),
    section('Risk addressed', el('p', { 'data-testid': 'detail-risk', text: t.risk })),
    section('Preconditions', list(t.preconditions, false, 'detail-preconditions')),
    section('Test data', list(t.testData, false, 'detail-test-data')),
    section('Execution steps', list(t.steps, true, 'detail-steps')),
    section('Expected results', list(t.expectedResults, true, 'detail-expected')),
    section('References', list(t.references, false, 'detail-references')),
    el('p', { class: 'muted small', text: `Automation target: ${t.automationTarget} · Last updated ${new Date(t.updatedAt).toLocaleString()}` }),
  );
}

function trackingForm(t) {
  const form = el(
    'form',
    { class: 'tracking card', 'data-testid': 'tracking-form', onsubmit: (e) => saveTracking(e, t.id), oninput: () => (state.dirty = true) },
    el('h3', { text: 'Execution & tracking' }),
    el(
      'div',
      { class: 'grid' },
      field('Automation status', select('automationStatus', t.automationStatus)),
      field('Latest result', select('latestResult', t.latestResult)),
      field('Last executed', el('input', { type: 'date', name: 'lastExecuted', value: t.lastExecuted || '', 'data-testid': 'edit-lastExecuted' })),
      field('Script path', el('input', { type: 'text', name: 'scriptPath', value: t.scriptPath, placeholder: 'e.g. tests/playwright/api/payments/PAY-API-003.spec.ts', 'data-testid': 'edit-scriptPath' })),
    ),
    field('Notes', el('textarea', { name: 'notes', rows: '3', 'data-testid': 'edit-notes', text: t.notes })),
    el('div', { class: 'form-errors', 'data-testid': 'form-errors', hidden: true }),
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn btn-primary', 'data-testid': 'save-tracking', text: 'Save' })),
  );
  // Recording a result without a date: default to today.
  form.elements.latestResult.addEventListener('change', () => {
    if (form.elements.latestResult.value !== 'not run' && !form.elements.lastExecuted.value) form.elements.lastExecuted.value = today();
  });
  return form;
}

function contentForm(t) {
  const textarea = (name, value, rows = 3) => el('textarea', { name, rows: String(rows), 'data-testid': `edit-${name}`, text: value });
  return el(
    'form',
    { class: 'content-form card', 'data-testid': 'content-form', onsubmit: (e) => saveContent(e, t.id), oninput: () => (state.dirty = true) },
    el('h3', { text: 'Edit test content' }),
    el('p', { class: 'muted small', text: `The ID ${t.id} is permanent. Lists: one item per line.` }),
    field('Title', el('input', { type: 'text', name: 'title', value: t.title, 'data-testid': 'edit-title' })),
    el('div', { class: 'grid' }, field('Layer', select('layer', t.layer)), field('Priority', select('priority', t.priority)), field('Automation target', select('automationTarget', t.automationTarget))),
    field('Business objective', textarea('objective', t.objective, 2)),
    field('Risk addressed', textarea('risk', t.risk, 2)),
    ...LIST_FIELDS.map(([name, label]) => field(label, textarea(name, t[name].join('\n'), Math.min(Math.max(t[name].length + 1, 3), 10)))),
    el('div', { class: 'form-errors', 'data-testid': 'form-errors', hidden: true }),
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'button', class: 'btn', onclick: () => renderDetail(t, false), text: 'Cancel' }),
      el('button', { type: 'submit', class: 'btn btn-primary', 'data-testid': 'save-content', text: 'Save content' }),
    ),
  );
}

async function patch(id, changes, form) {
  const current = state.catalogue.tests.find((x) => x.id === id);
  const errors = validateTest({ ...current, ...changes });
  const box = form.querySelector('.form-errors');
  if (errors.length) {
    box.replaceChildren(el('ul', {}, errors.map((e) => el('li', { text: e }))));
    box.hidden = false;
    return;
  }
  box.hidden = true;
  try {
    const updated = await api('PATCH', `/api/tests/${encodeURIComponent(id)}`, changes);
    const i = state.catalogue.tests.findIndex((x) => x.id === id);
    state.catalogue.tests[i] = updated;
    state.dirty = false;
    render();
    renderDetail(updated, false);
    showBanner(`${id} saved.`, 'success');
  } catch (err) {
    box.replaceChildren(el('strong', { text: err.message }), el('ul', {}, (err.details || []).map((e) => el('li', { text: e }))));
    box.hidden = false;
  }
}

function saveTracking(e, id) {
  e.preventDefault();
  const f = e.currentTarget.elements;
  patch(id, {
    automationStatus: f.automationStatus.value,
    latestResult: f.latestResult.value,
    lastExecuted: f.lastExecuted.value || null,
    scriptPath: f.scriptPath.value.trim(),
    notes: f.notes.value,
  }, e.currentTarget);
}

function saveContent(e, id) {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const lines = (name) => f[name].value.split('\n').map((s) => s.trim()).filter(Boolean);
  const changes = {
    title: f.title.value.trim(),
    layer: f.layer.value,
    priority: f.priority.value,
    automationTarget: f.automationTarget.value,
    objective: f.objective.value.trim(),
    risk: f.risk.value.trim(),
  };
  for (const [name] of LIST_FIELDS) changes[name] = lines(name);
  patch(id, changes, e.currentTarget);
}

function closeDetail() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  state.openId = null;
  state.dirty = false;
  $('#detail').close();
}

// ---------------------------------------------------------------- import / export

async function exportJson() {
  try {
    const doc = await api('GET', '/api/catalogue');
    const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `test-catalogue-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

async function importJson(file) {
  let doc;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    return showBanner(`${file.name} is not valid JSON.`, 'error');
  }
  const errors = validateCatalogue(doc);
  if (errors.length) return showBanner(`Import rejected: ${errors.length} problem(s) in ${file.name}.`, 'error', errors.slice(0, 20));

  const currentIds = new Set(state.catalogue.tests.map((t) => t.id));
  const incomingIds = new Set(doc.tests.map((t) => t.id));
  const removed = [...currentIds].filter((id) => !incomingIds.has(id));
  const added = [...incomingIds].filter((id) => !currentIds.has(id));
  const summary = `Replace the catalogue with ${doc.tests.length} test cases from ${file.name}?\n\n` +
    `Added: ${added.length}  Removed: ${removed.length}${removed.length ? `\n(${removed.join(', ')})` : ''}`;
  if (!confirm(summary)) return;
  try {
    state.catalogue = await api('PUT', '/api/catalogue', doc);
    render();
    showBanner(`Imported ${doc.tests.length} test cases.`, 'success');
  } catch (err) {
    showBanner(err.message, 'error', err.details);
  }
}

// ---------------------------------------------------------------- wiring

function init() {
  for (const k of FILTER_KEYS) {
    const sel = $(`#filter-${k}`);
    for (const v of ENUMS[k]) sel.append(el('option', { value: v, text: v }));
    sel.addEventListener('change', () => {
      state.filters[k] = sel.value;
      writeUrl();
      render();
    });
  }
  $('#search').addEventListener('input', (e) => {
    state.filters.q = e.target.value.trim();
    writeUrl();
    render();
  });
  $('#clear-filters').addEventListener('click', () => {
    state.filters = { q: '', layer: '', priority: '', automationStatus: '', latestResult: '' };
    readUrlFromState();
    writeUrl();
    render();
  });
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      render();
    });
  }
  $('#reload-btn').addEventListener('click', async () => {
    await load();
    showBanner('Catalogue reloaded from disk.', 'success');
  });
  $('#export-btn').addEventListener('click', exportJson);
  $('#import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importJson(file);
  });
  const dialog = $('#detail');
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDetail();
  });
  dialog.addEventListener('close', () => history.replaceState(null, '', `${location.pathname}${location.search}`));
  // Pick up edits made to catalogue.json by other tools when the tab regains focus.
  window.addEventListener('focus', () => {
    if (!dialog.open) load();
  });

  // Deep links: /#PAY-API-003 opens that test case (on load and on later hash changes).
  const openFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && state.catalogue && id !== state.openId) openDetail(id);
  };
  window.addEventListener('hashchange', openFromHash);

  readUrl();
  load().then(openFromHash);
}

function readUrlFromState() {
  $('#search').value = state.filters.q;
  for (const k of FILTER_KEYS) $(`#filter-${k}`).value = state.filters[k];
}

init();
