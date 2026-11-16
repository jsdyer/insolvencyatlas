export const AREAS = { CA: 'Canada', BC: 'British Columbia', NS: 'Nova Scotia' };
export const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function shiftMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const offset = year * 12 + number - 1 + delta;
  return String(Math.floor(offset / 12)).padStart(4, '0') + '-' + String(offset % 12 + 1).padStart(2, '0');
}

function indexedMonths(months, values) {
  return new Map(months.map((month, i) => [month, Number.isFinite(values[i]) ? values[i] : null]));
}

export function lastPolicyObservations(dates, values, asOfMonth) {
  const byMonth = new Map();
  for (const [i, date] of dates.entries()) {
    const month = date.slice(0, 7);
    const value = values[i];
    if (month < asOfMonth && Number.isFinite(value) && date > (byMonth.get(month)?.date ?? '')) {
      byMonth.set(month, { date, value });
    }
  }
  return byMonth;
}

export function alignedRows({ filings, prices, policy, area, product, first, last }) {
  if (!validMonth(first) || !validMonth(last) || first > last) return [];
  const filingSource = filings?.counts;
  const retail = product?.regions[area];
  const counts = filingSource ? indexedMonths(filingSource.periods, filingSource.values[area]['consumer-insolvency']) : new Map();
  const amounts = retail ? indexedMonths(prices.months, retail) : new Map();
  const result = [];
  for (let month = first; month <= last; month = shiftMonth(month, 1)) {
    const policyPoint = policy?.get(month);
    result.push({ month, count: counts.get(month) ?? null, price: amounts.get(month) ?? null,
      rate: policyPoint?.value ?? null, rateDate: policyPoint?.date ?? null });
  }
  return result;
}
