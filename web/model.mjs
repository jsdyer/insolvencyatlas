export function completeYearSeries(months, values) {
  const counts = new Map();
  for (let i = 0; i < months.length; i++) {
    const year = months[i].slice(0, 4);
    if (!counts.has(year)) counts.set(year, new Map());
    counts.get(year).set(months[i].slice(5), values[i]);
  }
  return [...counts].map(([year, observations]) => {
    const entries = [...observations.values()];
    const total = entries.length === 12 && entries.every(Number.isFinite)
      ? entries.reduce((sum, value) => sum + value, 0)
      : null;
    return { period: year, value: total };
  });
}

export function rowsFor(dataset, area, key, calendarYear) {
  const observations = dataset.values[area][key];
  if (calendarYear) return completeYearSeries(dataset.periods, observations);
  return dataset.periods.map((period, i) => ({ period, value: observations[i] }));
}

export function lookBack(period) {
  return String(Number(period.slice(0, 4)) - 1) + period.slice(4);
}

export function csvText(header, rows) {
  const record = cells => cells.map(cell => '"' + String(cell ?? '').replaceAll('"', '""') + '"').join(',');
  return [header, ...rows].map(record).join('\r\n') + '\r\n';
}
