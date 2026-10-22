/**
 * WIN/wei conversions that depend on nothing.
 *
 * Kept out of the utils barrel so `config` can import it without pulling the barrel in. The barrel
 * imports `config`, and `config` calls `wintoWei` while evaluating INITIAL_PARAMETERS — so when the
 * barrel loaded first, `config` saw a half-initialised module and `wintoWei` was undefined. Any
 * entry point that reached `utils` before `config` failed on that, which took out three test suites.
 *
 * Add only dependency-free helpers here. Anything reading WinFlags belongs in the barrel —
 * `weiToWin` does, which is why it is not here.
 */
export function wintoWei(win: number): bigint {
  return BigInt(win* 10 ** 18)
}
