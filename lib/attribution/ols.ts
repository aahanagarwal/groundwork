/**
 * A small ridge-regularised least-squares solver with per-coefficient standard
 * errors. Four or five drivers over ninety days is a tiny system, so this is
 * normal equations rather than a QR decomposition: deterministic,
 * dependency-free, and legible enough to defend in the docs.
 *
 * The ridge penalty is NOT just numerical hygiene here - it is a modelling
 * decision with a purpose. Plain OLS on indicator regressors forces the
 * residuals to sum to zero within each driver's own day-set. When the window
 * being explained *is* that day-set - "why did tickets drop during the nine
 * days the road was shut" - the drivers then account for exactly 100% of the
 * movement as an accounting identity, and `unexplained` comes out at 0.0 no
 * matter what really happened. An engine that always explains everything is
 * the engine the dossier says not to build.
 *
 * So each coefficient is shrunk toward zero in proportion to how little
 * independent evidence supports it: a driver active on many days, whose
 * pattern separates cleanly from the others, barely moves; one resting on a
 * couple of overlapping days shrinks hard. The shrunk-away portion is never
 * redistributed to another driver - it falls through to `unexplained`, which
 * is the honest home for "something moved this and we cannot say what."
 */

/**
 * Penalty as a fraction of the mean diagonal of X'X. At 0.12 a well-evidenced
 * driver keeps ~90% of its OLS coefficient and a thin one keeps much less.
 * Raise it to make the engine more conservative about claiming causes.
 */
export const RIDGE_FRACTION = 0.25;

export interface OlsResult {
  /** One coefficient per column of X, in order. */
  beta: number[];
  /** Standard error of each coefficient. Drives the confidence band. */
  se: number[];
  /** Fitted value per row. */
  fitted: number[];
  residualSumSquares: number;
  totalSumSquares: number;
  rSquared: number;
  degreesOfFreedom: number;
  /**
   * Ratio of largest to smallest eigenvalue proxy on X'X. Large means two
   * drivers move together and their split is arbitrary - we downgrade
   * confidence rather than pretending we separated them.
   */
  conditionNumber: number;
  /** The penalty actually applied, for the methodology drawer. */
  ridge: number;
}

/** Inverse of a symmetric positive-definite matrix, for the SE diagonal. */
function invert(A: number[][], ridge: number): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) =>
    row
      .map((v, j) => (i === j ? v + ridge : v))
      .concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))),
  );

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row) => row.slice(n));
}

/**
 * No intercept: y is already a residual around an estimated baseline, so a
 * fitted intercept would just re-absorb baseline error and quietly shrink
 * every driver.
 */
export function ols(
  X: number[][],
  y: number[],
  ridgeFraction: number = RIDGE_FRACTION,
): OlsResult | null {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (n === 0 || k === 0 || n <= k) return null;

  // X'X and X'y
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }

  const trace = XtX.reduce((s, row, i) => s + row[i], 0);
  // Scaled to the design so the same fraction means the same thing whatever
  // units the magnitudes are in.
  const ridge = Math.max((trace / k) * ridgeFraction, 1e-10);

  const inv = invert(XtX, ridge);
  if (!inv) return null;

  const beta = new Array(k).fill(0).map((_, a) =>
    inv[a].reduce((s, v, b) => s + v * Xty[b], 0),
  );

  const fitted = X.map((row) => row.reduce((s, v, a) => s + v * beta[a], 0));
  const residualSumSquares = y.reduce(
    (s, v, i) => s + (v - fitted[i]) ** 2,
    0,
  );
  const totalSumSquares = y.reduce((s, v) => s + v * v, 0);
  const degreesOfFreedom = Math.max(1, n - k);
  const sigmaSquared = residualSumSquares / degreesOfFreedom;

  // Standard errors from the penalised inverse. These are the SEs of the
  // shrunk estimator, not of an unbiased one - the band describes where this
  // estimator's answer would land on repeated samples, and does not include
  // the bias the shrinkage deliberately introduces. Stated in ARCHITECTURE.md.
  const se = new Array(k)
    .fill(0)
    .map((_, a) => Math.sqrt(Math.max(0, sigmaSquared * inv[a][a])));

  const diag = XtX.map((row, i) => Math.abs(row[i]));
  const conditionNumber =
    Math.min(...diag) > 0 ? Math.max(...diag) / Math.min(...diag) : Infinity;

  return {
    beta,
    se,
    fitted,
    residualSumSquares,
    totalSumSquares,
    rSquared:
      totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : 0,
    degreesOfFreedom,
    conditionNumber,
    ridge,
  };
}
