import { csvText } from './model.mjs';
import { alignedRows, AREAS, lastPolicyObservations, shiftMonth, validMonth } from './comparison-model.mjs';

const $ = id => document.getElementById(id);
const monthFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const countFormat = new Intl.NumberFormat('en-CA');
const currencyFormat = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const rateFormat = new Intl.NumberFormat('en-CA', { style: 'percent', maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const monthLabel = month => monthFormat.format(new Date(month + '-01T00:00:00Z'));
const utcMonth = new Date().toISOString().slice(0, 7);
const seriesKey = 'V39079';
const rateSource = 'https://www.bankofcanada.ca/valet/observations/V39079/json';
const tracks = [
  { key: 'count', label: 'Consumer insolvency filings', unit: 'filings', color: '#9aebbd', format: value => countFormat.format(value) },
  { key: 'price', label: 'Average retail price', unit: 'CAD per package', color: '#f5c47d', format: value => currencyFormat.format(value) },
  { key: 'rate', label: 'Target overnight rate', unit: 'percent', color: '#9eccfc', format: value => rateFormat.format(value / 100) },
];
const sourcePaths = {
  filings: ['./snapshot.json', 'Insolvency Atlas'],
  prices: ['../priceatlas/snapshot.json', 'Price Atlas'],
  rates: ['../bankrates/snapshot.json', 'BankRate Lab'],
};

let data;
let bounds;
let rows = [];
let inspectIndex = 0;
let view = {};

function make(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function validMonths(months) {
  return Array.isArray(months) && months.length && months.every((month, i) => validMonth(month) && (!i || month > months[i - 1]));
}

function isSeries(values, dateCount) {
  return Array.isArray(values) && values.length === dateCount;
}

function verifySnapshot(type, value) {
  if (type === 'filings') {
    const counts = value?.counts;
    return value?.version === 1 && validMonths(counts?.periods) && Object.keys(AREAS)
      .every(area => isSeries(counts.values?.[area]?.['consumer-insolvency'], counts.periods.length));
  }
  if (type === 'prices') {
    return validMonths(value?.months) && Array.isArray(value.products) && value.products.length &&
      value.products.every(product => typeof product.name === 'string' && typeof product.id === 'string' &&
        Object.keys(AREAS).every(area => isSeries(product.regions?.[area], value.months.length)));
  }
  return Array.isArray(value?.dates) && value.dates.length && value.dates.every(date => /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) &&
    isSeries(value.tracks?.[seriesKey]?.data, value.dates.length);
}

async function fetchSnapshot(type, path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Snapshot unavailable');
  const value = await response.json();
  if (!verifySnapshot(type, value)) throw new Error('Unsupported data snapshot');
  return value;
}

function dateBounds(sources) {
  const spans = [sources.filings?.counts.periods, sources.prices?.months, sources.policy && [...sources.policy.keys()].sort()].filter(list => list?.length);
  if (!spans.length) return null;
  const earliest = spans.map(list => list[0]).sort().at(-1);
  const endDates = spans.map(list => list.at(-1)).sort();
  const latest = [endDates.at(-1), shiftMonth(utcMonth, -1)].sort()[0];
  const shared = [endDates[0], latest].sort()[0];
  return earliest <= shared ? { earliest, latest, shared } : null;
}

function activeBounds() {
  const from = $('from').value;
  const through = $('through').value;
  if (validMonth(from) && validMonth(through) && bounds.earliest <= from && through <= bounds.latest && from <= through) {
    return { from, through };
  }
  $('month-error').textContent = `Choose an ordered range between ${monthLabel(bounds.earliest)} and ${monthLabel(bounds.latest)}.`;
  $('month-error').hidden = false;
  return null;
}

function safeSource(id, value) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') $(id).href = url.href;
  } catch {}
}

function chooseWindow(preset) {
  $('through').value = bounds.shared;
  const first = { recent: shiftMonth(bounds.shared, -35), 2020: '2020-01', full: bounds.earliest }[preset];
  $('from').value = [bounds.earliest, [first, bounds.shared].sort()[0]].sort().at(-1);
}

function displayedValue(value, track) {
  return Number.isFinite(value) ? track.format(value) : 'Unavailable';
}

function updateLinks() {
  if (view.product) {
    const query = new URLSearchParams({ product: view.product.id, areas: view.area, unit: 'package', from: view.from, through: view.through });
    $('retail-atlas').href = '../priceatlas/?' + query;
  }
  const lastDate = shiftMonth(view.through, 1) + '-01';
  const endDate = new Date(Date.parse(lastDate + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  $('rate-lab').href = '../bankrates/?' + new URLSearchParams({
    view: 'rates', series: seriesKey, compare: '', from: view.from + '-01', through: endDate,
  });
}

function updateURL() {
  const query = new URLSearchParams({ area: view.area, from: view.from, through: view.through, month: rows[inspectIndex].month });
  if (view.product) query.set('product', view.product.id);
  history.replaceState(null, '', '?' + query);
}

function showTable() {
  const tableRows = rows.map(row => {
    const tr = make('tr');
    const month = make('th', monthLabel(row.month));
    month.scope = 'row';
    tr.append(month, ...tracks.map(track => make('td', displayedValue(row[track.key], track))), make('td', row.rateDate ?? 'Unavailable'));
    return tr;
  });
  $('comparison-body').replaceChildren(...tableRows.reverse());
}

function extent(points, integerScale) {
  const values = points.filter(Number.isFinite);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, Math.abs(high) * .02, .04);
  const base = 10 ** Math.floor(Math.log10(span / 3));
  const step = Math.max(integerScale ? 1 : .01, [1, 2, 2.5, 5, 10].find(n => n * base >= span / 3) * base);
  const start = Math.floor(low / step) * step;
  const end = Math.max(start + step * 2, Math.ceil(high / step) * step);
  return { start, end, steps: Math.round((end - start) / step) };
}

function drawChart(track) {
  const canvas = track.canvas;
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 80 || height < 60 || !rows.length) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const values = rows.map(row => row[track.key]);
  const scale = extent(values, track.key === 'count');
  const left = width < 400 ? 61 : 76;
  const right = width - 18;
  const top = 15;
  const bottom = height - 29;
  track.axis = { left, right };
  const x = index => rows.length > 1 ? left + index * (right - left) / (rows.length - 1) : (left + right) / 2;
  context.font = '11px system-ui';
  context.fillStyle = '#b4c3bf';
  context.textBaseline = 'middle';
  if (!scale) {
    context.fillText('No observations in this range', left, height / 2);
  } else {
    const y = value => bottom - (value - scale.start) * (bottom - top) / (scale.end - scale.start);
    context.strokeStyle = '#344641';
    context.textAlign = 'right';
    for (let i = 0; i <= scale.steps; i++) {
      const value = scale.start + i * (scale.end - scale.start) / scale.steps;
      const line = y(value);
      context.beginPath();
      context.moveTo(left, line);
      context.lineTo(right, line);
      context.stroke();
      context.fillText(track.format(value), left - 7, line);
    }
    context.strokeStyle = track.color;
    context.fillStyle = track.color;
    context.lineWidth = 2;
    context.beginPath();
    let connected = false;
    for (const [index, value] of values.entries()) {
      if (value === null) {
        connected = false;
        continue;
      }
      if (connected) context.lineTo(x(index), y(value));
      else context.moveTo(x(index), y(value));
      connected = true;
    }
    context.stroke();
    for (const [index, value] of values.entries()) {
      if (value === null || (rows.length > 30 && values[index - 1] != null && values[index + 1] != null)) continue;
      context.beginPath();
      context.arc(x(index), y(value), 2, 0, 2 * Math.PI);
      context.fill();
    }
    context.strokeStyle = '#dfebe880';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x(inspectIndex), top);
    context.lineTo(x(inspectIndex), bottom);
    context.stroke();
    const picked = values[inspectIndex];
    if (picked !== null) {
      context.beginPath();
      context.arc(x(inspectIndex), y(picked), 5, 0, 2 * Math.PI);
      context.fill();
    }
  }
  context.fillStyle = '#b4c3bf';
  const ticks = Math.min(width < 450 ? 2 : 4, rows.length);
  for (let index = 0; index < ticks; index++) {
    const at = ticks === 1 ? 0 : Math.round(index * (rows.length - 1) / (ticks - 1));
    context.textAlign = ticks === 1 ? 'center' : index === 0 ? 'left' : index === ticks - 1 ? 'right' : 'center';
    context.fillText(monthLabel(rows[at].month), x(at), bottom + 16);
  }
}

function monthDelta(track, row, previous) {
  const value = row[track.key];
  const prior = previous?.[track.key];
  if (!Number.isFinite(value) || !Number.isFinite(prior)) return '';
  const difference = Number((value - prior).toFixed(2));
  const unit = track.key === 'rate' ? 'percentage points' : track.key === 'price' ? 'CAD' : 'filings';
  return ` · ${signed.format(difference)} ${unit} vs previous month`;
}

function updateInspection() {
  const row = rows[inspectIndex];
  $('inspect').value = row.month;
  for (const track of tracks) {
    track.value.textContent = displayedValue(row[track.key], track);
    const period = track.key === 'rate' && row.rateDate ? `Observed ${row.rateDate}` : monthLabel(row.month);
    track.observation.textContent = period + monthDelta(track, row, rows[inspectIndex - 1]);
    drawChart(track);
  }
  updateURL();
}

function render(preferredMonth) {
  $('month-error').hidden = true;
  const selectedWindow = activeBounds();
  $('compare-results').hidden = !selectedWindow;
  if (!selectedWindow) return;
  const inspected = typeof preferredMonth === 'string' ? preferredMonth : $('inspect').value;
  const area = $('area').value;
  const product = data.prices?.products.find(item => item.id === $('product').value);
  view = { ...selectedWindow, area, product };
  rows = alignedRows({ ...data, area, product, first: view.from, last: view.through });
  inspectIndex = rows.findIndex(row => row.month === inspected);
  if (inspectIndex < 0) {
    const comparable = rows.findLastIndex(row => row.count != null && row.price != null && row.rate != null);
    inspectIndex = comparable >= 0 ? comparable : rows.length - 1;
  }
  $('inspect').replaceChildren(...rows.map(row => new Option(monthLabel(row.month), row.month)).reverse());
  tracks[0].description.textContent = AREAS[area] + ' · bankruptcies and proposals per month';
  tracks[1].description.textContent = [AREAS[area], product?.name, 'CAD per package'].filter(Boolean).join(' · ');
  tracks[2].description.textContent = 'Canada · percent · last reported business day of each completed month';
  showTable();
  updateLinks();
  updateInspection();
}

function setupCharts() {
  for (const track of tracks) {
    const panel = make('article');
    panel.className = 'comparison-track';
    panel.style.setProperty('--track-color', track.color);
    const heading = make('h3', track.label);
    heading.id = 'series-' + track.key;
    const header = make('div');
    header.className = 'track-header';
    const description = make('p');
    description.className = 'muted';
    track.description = description;
    const label = make('div');
    label.append(heading, description);
    const reading = make('div');
    reading.className = 'track-reading';
    track.value = make('strong');
    track.observation = make('p');
    track.observation.className = 'muted';
    reading.append(track.value, track.observation);
    header.append(label, reading);
    const canvas = make('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-labelledby', heading.id);
    canvas.setAttribute('aria-describedby', 'timeline-title');
    track.canvas = canvas;
    canvas.addEventListener('click', event => {
      if (!track.axis || !rows.length) return;
      const { left, right } = track.axis;
      const fraction = (event.clientX - canvas.getBoundingClientRect().left - left) / (right - left);
      inspectIndex = Math.round(Math.min(Math.max(fraction, 0), 1) * (rows.length - 1));
      updateInspection();
    });
    panel.append(header, canvas);
    $('comparison-tracks').append(panel);
    new ResizeObserver(() => drawChart(track)).observe(canvas);
  }
}

function download() {
  if (!rows.length) return;
  const headings = ['Month', 'Area for filings and prices', 'Consumer insolvency filings', 'Filings workbook',
    'Product and package', 'Price (CAD)', 'Statistics Canada vector', 'Price source', 'Canada policy rate (%)', 'Rate observation date', 'Rate source'];
  const workbook = data.filings?.sources?.counts?.file ?? '';
  const source = data.prices?.source ?? '';
  const selected = rows.map(row => [row.month, AREAS[view.area], row.count, workbook, view.product?.name,
    row.price, view.product?.vectors?.[view.area], source, row.rate, row.rateDate, rateSource]);
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(headings, selected)], { type: 'text/csv;charset=utf-8' }));
  const link = make('a');
  link.href = url;
  link.download = 'insolvencies-prices-rates.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function load() {
  $('compare-retry').hidden = true;
  $('compare-status').textContent = 'Loading published data…';
  const entries = Object.entries(sourcePaths);
  const results = await Promise.allSettled(entries.map(([type, [path]]) => fetchSnapshot(type, path)));
  data = Object.fromEntries(entries.map(([type], index) => [type, results[index].value]));
  if (data.rates) data.policy = lastPolicyObservations(data.rates.dates, data.rates.tracks[seriesKey].data, utcMonth);
  bounds = dateBounds(data);
  const missing = entries.filter(([type]) => !data[type]).map(([, [, label]]) => label);
  if (missing.length) $('compare-retry').hidden = false;
  if (!bounds) {
    $('compare-status').textContent = 'No shared published dates are available. Retry or check the source tools below.';
    $('compare-retry').hidden = false;
    return;
  }
  const coverage = [
    data.filings && `Filings through ${monthLabel(data.filings.counts.periods.at(-1))}`,
    data.prices && `Prices through ${monthLabel(data.prices.months.at(-1))}`,
    data.policy?.size && `Policy rate through ${monthLabel([...data.policy.keys()].sort().at(-1))}`,
  ].filter(Boolean);
  $('comparison-coverage').textContent = coverage.join(' · ');
  $('compare-status').textContent = missing.length
    ? `Unavailable snapshot: ${missing.join(', ')}. Available series remain on the timeline.`
    : `Shared published months through ${monthLabel(bounds.shared)}.`;
  safeSource('filings-workbook', data.filings?.sources?.counts?.file);
  safeSource('retail-source', data.prices?.source);
  const query = new URLSearchParams(location.search);
  $('area').replaceChildren(...Object.entries(AREAS).map(([code, label]) => new Option(label, code)));
  $('area').value = Object.hasOwn(AREAS, query.get('area')) ? query.get('area') : 'BC';
  const products = data.prices?.products ?? [];
  $('product').replaceChildren(...(products.length ? products.map(item => new Option(item.name, item.id)) : [new Option('Prices unavailable', '')]));
  $('product').disabled = !products.length;
  const defaultProduct = products.find(item => item.name === 'Eggs, 1 dozen') ?? products[0];
  $('product').value = products.some(item => item.id === query.get('product')) ? query.get('product') : defaultProduct?.id ?? '';
  for (const id of ['from', 'through']) {
    $(id).min = bounds.earliest;
    $(id).max = bounds.latest;
  }
  chooseWindow('recent');
  const from = query.get('from');
  const through = query.get('through');
  if (validMonth(from) && validMonth(through) && bounds.earliest <= from && from <= through && through <= bounds.latest) {
    $('from').value = from;
    $('through').value = through;
  }
  $('compare-controls').hidden = false;
  render(query.get('month'));
}

$('comparison-form').addEventListener('submit', event => event.preventDefault());
$('comparison-form').addEventListener('change', render);
for (const button of document.querySelectorAll('[data-period]')) {
  button.addEventListener('click', () => { chooseWindow(button.dataset.period); render(); });
}
$('inspect').addEventListener('change', () => {
  inspectIndex = rows.findIndex(row => row.month === $('inspect').value);
  updateInspection();
});
$('export-comparison').addEventListener('click', download);
$('compare-retry').addEventListener('click', load);
setupCharts();
load();
