export function getNairobiDay(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) throw new Error('Unable to determine the Nairobi day');
  return `${year}-${month}-${day}`;
}

export function addDays(day: string, count: number): string {
  const parts = day.split('-').map(Number);
  const [year, month, date] = parts;
  if (year === undefined || month === undefined || date === undefined) {
    throw new RangeError('Invalid day');
  }
  const value = new Date(Date.UTC(year, month - 1, date + count));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate(),
  ).padStart(2, '0')}`;
}
