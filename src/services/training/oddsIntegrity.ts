// Dataset-only parsing. Never infer a line from market ordinals or from the price.
export function parseGoalTotal(market: string, selection: string, price: number) {
  const text = `${market} ${selection}`;
  if (!Number.isFinite(price) || price <= 1 || /team|home|away|local|visitante|corner|card|handicap|2nd|second|\b(2h|2t)\b/i.test(text)) return null;
  if (!/goals|goles|over\s*[/_-]\s*under/i.test(market)) return null;
  const first = /\b(1t|1h|first half|1st half)\b/i.test(text);
  const full = /\b(ft|full time|fulltime)\b/i.test(text);
  if (first === full) return null; // Unknown or contradictory period: no inferred FT.
  const clean = selection.replace(/\b(1t|1h|first half|1st half|ft|full time|fulltime)\b/ig, '').trim();
  const match = clean.match(/^(over|under)\s+(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?$/i);
  if (!match) return null;
  const a = Number(match[2].replace(',', '.')), b = match[3] ? Number(match[3].replace(',', '.')) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a * 4 % 1 || b * 4 % 1) return null;
  if (match[3] && (b - a !== 0.5 || a * 2 % 1 || b * 2 % 1)) return null;
  const line = (a + b) / 2;
  return { market: 'TOTAL_GOALS' as const, period: first ? 'FIRST_HALF' as const : 'FULL_TIME' as const,
    selection: match[1].toUpperCase() as 'OVER' | 'UNDER', line, price,
    settlement: line % 1 === 0 ? 'INTEGER_PUSH' as const : line * 2 % 1 === 0 ? 'HALF_LINE' as const : 'ASIAN_SPLIT' as const };
}

// No undocumented clock-skew allowance. Missing clocks are not evidence of availability.
export function timestampIssue(providerTimestamp: string, receivedAt: string, capturedAt: string): string | null {
  const p = Date.parse(providerTimestamp), r = Date.parse(receivedAt), c = Date.parse(capturedAt);
  if (![p, r, c].every(Number.isFinite)) return 'INVALID_TIMESTAMP';
  if (p > r) return 'PROVIDER_TIMESTAMP_AFTER_RECEIPT';
  if (r > c) return 'EVIDENCE_AFTER_CAPTURE';
  return null;
}
