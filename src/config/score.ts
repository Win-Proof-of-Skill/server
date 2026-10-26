/** Exact JSON representation: retain legacy safe integers; larger values are decimal strings. */
export type ScoreValue = number | string;

/** Never allow an already-rounded JavaScript number into score arithmetic. */
export function scoreUnits(value: ScoreValue | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^(?:0|-?[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error('Score must use exact integer millionths');
}

/** JSON cannot encode BigInt. Conversion to number is allowed only when exact. */
export function scoreValue(value: bigint): ScoreValue {
  if (typeof value !== 'bigint') throw new Error('Score serialization requires BigInt');
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value) : value.toString();
}
