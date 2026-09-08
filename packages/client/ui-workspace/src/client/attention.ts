/** Timestamp-only attention partition; equal timestamps always stay together. */
type TimedRow = { readonly updatedAt: number }

/** Read a persisted cutoff, including older viewing stores that lack the field. */
export function attentionCutoff(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : 0
}

/** First ignored row in a strictly newest-first projection. */
export function attentionIndex(rows: readonly TimedRow[], cutoff: number): number {
  const index = rows.findIndex(row => row.updatedAt <= cutoff)
  return index < 0 ? rows.length : index
}

/** Resolve a visual gap to time, snapping ties to before the equal-time cohort. */
export function cutoffAtGap(rows: readonly TimedRow[], gap: number, now: number): number {
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (first === undefined || last === undefined) return now
  if (gap <= 0) return Math.max(now, first.updatedAt)
  if (gap >= rows.length) return Math.max(0, last.updatedAt - 1)
  return rows[gap]?.updatedAt ?? now
}

/** Edge speed in pixels/frame; only the owned list scrolls. */
export function attentionScrollSpeed(y: number, top: number, bottom: number): number {
  const edge = Math.min(48, (bottom - top) / 3)
  if (edge <= 0) return 0
  if (y < top + edge) return -Math.min(12, Math.max(0, (top + edge - y) / 4))
  if (y > bottom - edge) return Math.min(12, Math.max(0, (y - bottom + edge) / 4))
  return 0
}
