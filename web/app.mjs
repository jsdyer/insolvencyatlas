import { csvText, lookBack, rowsFor } from './model.mjs';

const $ = id => document.getElementById(id);
const controls = $('controls');
const params = new URLSearchParams(location.search);
const integer = new Intl.NumberFormat('en-CA');
const decimal = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthlyLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short' });
const colors = ['#9aebbd', '#f5c47d'];
const presets = {
  provinces: ['monthly', 'BC', 'NS'],
  metros: ['consumer-metros', 'Vancouver, B.C.', 'Halifax, N.S.'],
  sectors: ['business-sectors', 'Information and Cultural Industries', 'Retail Trade'],
};
const keys = ['dataset', 'group', 'measure', 'primary', 'secondary', 'range'];
let snapshot;
let shown;

function el(tag, content, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function periodLabel(value) {
  return value.length === 4 ? value : monthlyLabel.format(new Date(value + '-01T00:00:00Z'));
}

function numberLabel(value) {
  return Number.isFinite(value) ? (shown.rates ? decimal : integer).format(value) : '—';
}

function isRate(dataset) {
  return dataset !== 'monthly' && dataset !== 'yearly';
}

function populate(select, options, preferred, fallback) {
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some(([value]) => value === preferred) ? preferred : fallback;
}

function updateSelections(preferred = {}) {
  const dataset = $('dataset').value;
  const rates = isRate(dataset);
  const source = rates ? snapshot.rates[dataset] : snapshot.counts;
  $('group-label').hidden = rates;
  const areaOptions = Object.entries(source.areas);
  const defaults = {
    monthly: ['BC', 'NS'],
    yearly: ['BC', 'NS'],
    'consumer-regions': ['BC', 'NS'],
    'business-regions': ['BC', 'NS'],
    'consumer-metros': presets.metros.slice(1),
    'business-metros': presets.metros.slice(1),
    'business-sectors': presets.sectors.slice(1),
  }[dataset];
  populate($('primary'), areaOptions, preferred.primary, defaults[0] || areaOptions[0][0]);
  populate($('secondary'), [['', 'Single series'], ...areaOptions], preferred.secondary, defaults[1] || '');
  const ranges = dataset === 'monthly'
    ? [['12', 'Last 12 months'], ['36', 'Last 3 years'], ['120', 'Last 10 years'], ['all', 'All available']]
    : [['5', 'Last 5 years'], ['10', 'Last 10 years'], ['20', 'Last 20 years'], ['all', 'All available']];
  populate($('range'), ranges, preferred.range, dataset === 'monthly' ? '36' : '10');
}

function updateURL(config) {
  const url = new URL(location.href);
  for (const key of keys) {
    if (key === 'group' && isRate(config.dataset)) url.searchParams.delete(key);
    else url.searchParams.set(key, config[key]);
  }
  if (url.href !== location.href) history.replaceState(null, '', url);
}

function render() {
  const config = Object.fromEntries(keys.map(key => [key, $(key).value]));
  const rates = isRate(config.dataset);
  const sourceType = rates ? 'rates' : 'counts';
  const dataset = rates ? snapshot.rates[config.dataset] : snapshot.counts;
  const key = rates ? config.measure : `${config.group}-${config.measure}`;
  const range = config.range === 'all' ? Infinity : Number(config.range);
  const ids = [config.primary];
  if (config.secondary && config.secondary !== config.primary) ids.push(config.secondary);
  const series = ids.map((area, i) => {
    const all = rowsFor(dataset, area, key, config.dataset === 'yearly');
    return { label: dataset.areas[area], color: colors[i], all, rows: all.slice(-range) };
  });
  const units = rates
    ? config.dataset.startsWith('consumer') ? 'Per 1,000 residents aged 18+' : 'Per 1,000 businesses'
    : config.dataset === 'yearly' ? 'Filings in a complete calendar year' : 'Filings per month';
  shown = { series, rates, units, sourceType, measure: config.measure, filer: rates ? config.dataset.split('-')[0] : config.group };
  $('units').textContent = units;
  const title = $('measure').selectedOptions[0].textContent;
  $('chart-title').textContent = rates ? `${title} · annual rates` : `${title} · filing counts`;
  showSummaries();
  showTable();
  drawChart();
  updateURL(config);
}

function showSummaries() {
  let missing = 0;
  const summary = $('summary');
  const legend = $('legend');
  const cards = [];
  const labels = [];
  for (const { label, color, rows, all } of shown.series) {
    missing += rows.filter(row => row.value == null).length;
    const last = rows.findLast(row => row.value != null);
    const prior = last && all.find(row => row.period === lookBack(last.period));
    const card = el('article');
    const name = el('h3', label);
    const display = el('strong', last ? numberLabel(last.value) : '—');
    display.style.color = color;
    let note = last ? periodLabel(last.period) : 'No reported observations in this range';
    if (last && prior && prior.value != null) {
      const delta = last.value - prior.value;
      const formatted = (shown.rates ? decimal : integer).format(Math.abs(delta));
      const change = Math.abs(delta) < (shown.rates ? 0.005 : 0.5)
        ? 'unchanged at displayed precision' : `${delta > 0 ? '+' : '−'}${formatted}`;
      note += ` · ${change} vs ${periodLabel(prior.period)}`;
    }
    card.append(name, display, el('p', note, 'muted'));
    cards.push(card);
    const badge = el('span');
    const swatch = el('b');
    swatch.style.background = color;
    badge.append(swatch, document.createTextNode(label));
    labels.push(badge);
  }
  summary.replaceChildren(...cards);
  legend.replaceChildren(...labels);
  $('missing').textContent = missing
    ? `${integer.format(missing)} missing observations in this view. Gaps in the chart mark unavailable values.`
    : `${integer.format(shown.series[0].rows.length)} periods in this view.`;
}

function showTable() {
  const heading = el('tr');
  for (const name of ['Period', ...shown.series.map(series => series.label)]) {
    const cell = el('th', name);
    cell.scope = 'col';
    heading.append(cell);
  }
  $('table-head').replaceChildren(heading);
  const rows = shown.series[0].rows.map((item, index) => {
    const row = el('tr');
    const period = el('th', periodLabel(item.period));
    period.scope = 'row';
    row.append(period, ...shown.series.map(series => el('td', numberLabel(series.rows[index].value))));
    return row;
  });
  $('table-body').replaceChildren(...rows.reverse());
}

function drawChart() {
  if (!shown) return;
  const canvas = $('chart');
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 150 || height < 100) return;
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const allValues = shown.series.flatMap(series => series.rows.map(row => row.value));
  const max = Math.max(0, ...allValues.filter(Number.isFinite));
  const desired = max / 4 || 1;
  const base = 10 ** Math.floor(Math.log10(desired));
  const step = Math.max(shown.rates ? 0.001 : 1, base * [1, 2, 5, 10].find(n => n * base >= desired));
  const top = step * 4;
  const tick = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 });
  const count = shown.series[0].rows.length;
  const left = 63;
  const right = width - 21;
  const bottom = height - 32;
  const y = value => bottom - value / top * (bottom - 18);
  const x = index => count > 1 ? left + index / (count - 1) * (right - left) : (left + right) / 2;
  context.font = '12px system-ui';
  context.textBaseline = 'middle';
  context.fillStyle = '#a0aea9';
  context.textAlign = 'right';
  context.strokeStyle = '#344641';
  for (let i = 0; i <= 4; i++) {
    const value = i / 4 * top;
    const level = y(value);
    context.beginPath();
    context.moveTo(left, level);
    context.lineTo(right, level);
    context.stroke();
    context.fillText(tick.format(value), left - 8, level);
  }
  const labelCount = Math.min(width < 440 ? 2 : 4, count);
  for (let i = 0; i < labelCount; i++) {
    const index = labelCount === 1 ? 0 : Math.round(i * (count - 1) / (labelCount - 1));
    const align = i === 0 ? 'left' : i === labelCount - 1 ? 'right' : 'center';
    context.textAlign = align;
    context.fillText(periodLabel(shown.series[0].rows[index].period), x(index), bottom + 17);
  }
  for (const { rows, color } of shown.series) {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    let draw = false;
    for (const [i, { value }] of rows.entries()) {
      if (value == null) {
        draw = false;
      } else if (draw) {
        context.lineTo(x(i), y(value));
      } else {
        context.moveTo(x(i), y(value));
        draw = true;
      }
    }
    context.stroke();
    for (const [i, { value }] of rows.entries()) {
      if (value == null || (count > 50 && rows[i - 1]?.value != null && rows[i + 1]?.value != null)) continue;
      context.beginPath();
      context.arc(x(i), y(value), 2.3, 0, 2 * Math.PI);
      context.fill();
    }
  }
}

function download() {
  const header = ['Period', 'Area or sector', 'Filer', 'Measure', 'Value', 'Unit', 'Source workbook'];
  const source = snapshot.sources[shown.sourceType].file;
  const rows = shown.series.flatMap(series => series.rows.map(({ period, value }) => (
    [period, series.label, shown.filer, shown.measure, value, shown.units, source]
  )));
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(header, rows)], { type: 'text/csv;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = 'insolvency-atlas.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadDefaults() {
  for (const key of ['dataset', 'group', 'measure']) {
    const select = $(key);
    const value = params.get(key);
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  updateSelections(Object.fromEntries(['primary', 'secondary', 'range'].map(key => [key, params.get(key)])));
}

async function start() {
  const response = await fetch('./snapshot.json');
  if (!response.ok) throw new Error('Snapshot unavailable');
  snapshot = await response.json();
  if (snapshot.version !== 1) throw new Error('Unsupported snapshot');
  const lastMonth = snapshot.counts.periods.at(-1);
  const lastYear = snapshot.rates['consumer-regions'].periods.at(-1);
  $('coverage').textContent = `Monthly filings through ${periodLabel(lastMonth)} · Annual rates through ${lastYear}`;
  for (const [kind, selector] of [['counts', 'count-file'], ['rates', 'rate-file']]) {
    const source = snapshot.sources[kind];
    $(selector).href = source.file;
    if (source.retrieved_at) $(selector).textContent = `Workbook retrieved ${source.retrieved_at.slice(0, 10)} ↗`;
    $(selector).hidden = false;
  }
  loadDefaults();
  $('analyzer').hidden = false;
  render();
  controls.addEventListener('change', event => {
    if (event.target === $('dataset')) {
      const preferred = (shown.sourceType === 'rates') === isRate($('dataset').value)
        ? { primary: $('primary').value, secondary: $('secondary').value, range: $('range').value } : {};
      updateSelections(preferred);
    }
    render();
  });
  controls.addEventListener('submit', event => event.preventDefault());
  $('export').addEventListener('click', download);
  for (const button of document.querySelectorAll('[data-example]')) {
    button.addEventListener('click', () => {
      const [dataset, primary, secondary] = presets[button.dataset.example];
      $('dataset').value = dataset;
      $('group').value = 'consumer';
      $('measure').value = 'insolvency';
      updateSelections({ primary, secondary });
      render();
    });
  }
  new ResizeObserver(drawChart).observe($('chart'));
}

start().catch(() => {
  $('analyzer').hidden = true;
  $('coverage').textContent = 'The local data snapshot could not load. Reload or use the official datasets below.';
});
