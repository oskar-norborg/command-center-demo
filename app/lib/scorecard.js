// Journal scorecard (SPEC.md §5.6a): the graded decisions summed up by kind. Pure: it reads the journal entries and the
// build's outcome prices (dist/data/outcomes.json) and counts; it computes no price of its own.

/** The decision kinds, in the order the table lists them. `stay-out` is a hold on a name not held (no account). */
export const KINDS = Object.freeze(['buy', 'add', 'trim', 'sell', 'hold', 'stay-out']);
export const KIND_LABEL = Object.freeze({ buy: 'Buys', add: 'Adds', trim: 'Trims', sell: 'Sells', hold: 'Holds', 'stay-out': 'Stayed out' });
// The letters as one word, lowest first: a single-letter string here would read as a ticker to the demo leak check.
const SCALE = 'DCBA';
const points = (g) => (typeof g === 'string' && g.length === 1 && SCALE.includes(g) ? SCALE.indexOf(g) + 1 : null);

/** Which way the price had to move for the decision to have paid: up for buying or keeping, down for selling or staying out. */
export function kindOf(entry) {
  if (entry.action === 'hold') return entry.account ? 'hold' : 'stay-out';
  return KINDS.includes(entry.action) ? entry.action : null;
}
export const wantsUp = (kind) => kind === 'buy' || kind === 'add' || kind === 'hold';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10 + 0);

/** An average of A–D grades as a letter (rounded to the nearest), or null. */
export function averageGrade(letters) {
  const pts = letters.map(points).filter(isNum);
  const m = mean(pts);
  return m === null ? null : SCALE[Math.min(3, Math.max(0, Math.round(m) - 1))];
}

/**
 * The scorecard rows and the grading status.
 * @param {object[]} entries   journal entries (state.journal values)
 * @param {Record<string, object|null>} outcomes   outcomes.json
 * @param {string} today       ET date
 */
export function scorecard(entries, outcomes, today) {
  const rows = [];
  let due = 0;
  let next = null;
  let graded = 0;
  let decisions = 0;
  for (const kind of KINDS) {
    const own = entries.filter((e) => kindOf(e) === kind);
    if (!own.length) continue;
    decisions += own.length;
    const grades = own.flatMap((e) => (e.grades ?? []).filter((g) => g.decision_quality && g.outcome));
    graded += grades.length;
    const sign = wantsUp(kind) ? 1 : -1;
    const moves = (horizon) => own.map((e) => {
      const o = outcomes?.[e.id];
      const p = horizon === 'now' ? o?.now : o?.horizons?.find((h) => h.horizon === horizon);
      return p && !p.pending && isNum(p.change_pct) ? sign * p.change_pct : null;
    }).filter(isNum);
    const cell = (horizon) => {
      const m = moves(horizon);
      return { count: m.length, yourWay: m.filter((x) => x > 0).length, avg: round1(mean(m)) };
    };
    rows.push({
      kind,
      label: KIND_LABEL[kind],
      entries: own.length,
      graded: grades.length,
      decision: averageGrade(grades.map((g) => g.decision_quality)),
      outcome: averageGrade(grades.map((g) => g.outcome)),
      d90: cell('90d'),
      d180: cell('180d'),
      now: cell('now'),
    });
  }
  for (const e of entries) {
    for (const g of e.grades ?? []) {
      if (g.decision_quality && g.outcome) continue;
      if (g.due <= today) due += 1;
      else if (!next || g.due < next) next = g.due;
    }
  }
  return { rows, decisions, graded, due, next };
}
