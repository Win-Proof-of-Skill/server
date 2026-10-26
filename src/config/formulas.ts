import { scoreUnits, type ScoreValue } from './score';

const winScale = 10n ** BigInt(18);

/** Consensus rules: scores are integer millionths, balances integer atomic WIN. */
export const formulas = Object.freeze({
  rulesVersion: 10,
  maxEndorsementMonths: 12,
  scoreScale: 1_000_000,
  maxScore: 1_000_000_000_000_000_000n,
  initialScore: 1_000_000,
  minimumScore: 1_000_000,
  minimumValidatorScore: 100_000_000,
  transferFeeBps: 50,
  feeRecipient: '9fe734826be44b76f06d1d3262130dce45076a3c000000000000000000000000',
  contractFee: winScale ,
  extractionFee: winScale / 10n,
  endorsementFee: winScale / 2n,
  baseFee: winScale / 100n,
  feePerKiB: winScale / 1_000n,
});

export const clampScore = (score: ScoreValue | bigint): bigint => {
  const value = scoreUnits(score);
  return value > formulas.maxScore ? formulas.maxScore : value < BigInt(formulas.minimumScore) ? BigInt(formulas.minimumScore) : value;
};
export const formatScore = (score: ScoreValue | bigint): string => {
  const units = scoreUnits(score); const negative = units < 0n; const absolute = negative ? -units : units;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
};
function checkedScore(score: ScoreValue | bigint): bigint {
  const value = scoreUnits(score);
  if (value < BigInt(formulas.minimumScore) || value > formulas.maxScore) throw new Error('Score outside allowed range');
  return value;
}
const boundedDelta = (value: bigint): bigint => value > formulas.maxScore ? formulas.maxScore : value;
function checkedMonths(months: number): bigint {
  if (!Number.isSafeInteger(months) || months < 1 || months > 1200) throw new Error('Duration must be 1 to 1200 months');
  return BigInt(months);
}
export function contractMonthlyDeltas(employeeScore: ScoreValue | bigint, hireScores: Record<string, ScoreValue | bigint>, durationMonths: number) {
  const employee = checkedScore(employeeScore); const months = checkedMonths(durationMonths);
  const entries = Object.entries(hireScores).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length === 0) throw new Error('At least one hiring profile is required');
  const scores = entries.map(([, value]) => checkedScore(value)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const mid = Math.floor(scores.length / 2);
  const medianTwice = scores.length % 2 ? scores[mid] * 2n : scores[mid - 1] + scores[mid];
  const sum = scores.reduce((a, b) => a + b, 0n);
  return {
    employee: boundedDelta(sum * BigInt(formulas.scoreScale) / (employee * months * 1200n)),
    hires: Object.fromEntries(entries.map(([id, score]) => [id, boundedDelta(employee * medianTwice / (checkedScore(score) * 2n * months * 1200n))])),
  };
}
export function endorsementDelta(sourceScore: ScoreValue | bigint, targetScore: ScoreValue | bigint, months: number): bigint {
  return boundedDelta(checkedMonths(months) * checkedScore(sourceScore) * BigInt(formulas.scoreScale) / (checkedScore(targetScore) * 1200n));
}
/** 0.5%, rounded up to one atomic WIN, charged separately. */
export function transferFee(amount: bigint): bigint {
  if (amount <= 0n) throw new Error('Transfer amount must be positive');
  return (amount * BigInt(formulas.transferFeeBps) + 9999n) / 10000n;
}
/** Original metadata/validator fee retained where no replacement fee was requested. */
export const transactionFee = (bytes: number): bigint => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Transaction size must be a nonnegative safe integer');
  return formulas.baseFee + formulas.feePerKiB * ((BigInt(bytes) + 1023n) / 1024n);
};