/** UTC calendar anniversaries, clamped to the target month's last day. */
export function addMonths(timestamp: number, months: number): number {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isSafeInteger(months) || months < 0) throw new Error('Invalid calendar duration');
  const origin = new Date(timestamp);
  if (!Number.isFinite(origin.getTime())) throw new Error('Invalid timestamp');
  const target = new Date(timestamp);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const end = new Date(target.getTime()); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  target.setUTCDate(Math.min(origin.getUTCDate(), end.getUTCDate()));
  const result = target.getTime();
  if (!Number.isSafeInteger(result)) throw new Error('Calendar duration outside supported date range');
  return result;
}
