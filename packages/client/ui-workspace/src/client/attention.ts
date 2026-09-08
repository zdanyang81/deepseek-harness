/** A timestamp boundary, with a stable identity only to disambiguate equal-time gaps. */
export type AttentionBoundary = number | { readonly timestamp: number; readonly id: string; readonly side: 'before' | 'after' }
type TimedRow = { readonly updatedAt: number; readonly id: string }

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
}

/** Decode durable viewing state; missing/invalid values use this mount's fixed initialization time. */
export function attentionCutoff(value: unknown, initialTime: number): AttentionBoundary {
  if (validTime(value)) return value
  if (typeof value === 'object' && value !== null && 'timestamp' in value && validTime(value.timestamp)
    && 'id' in value && typeof value.id === 'string' && value.id.length > 0
    && 'side' in value && (value.side === 'before' || value.side === 'after')) {
    return value as AttentionBoundary
  }
  return initialTime
}

/** Numeric time of either a legacy cutoff or a timestamp/identity boundary. */
export function attentionTime(cutoff: AttentionBoundary): number {
  return typeof cutoff === 'number' ? cutoff : cutoff.timestamp
}

/** First ignored row in the same timestamp-descending, ID-ascending order as the catalog. */
export function attentionIndex(rows: readonly TimedRow[], cutoff: AttentionBoundary): number {
  const time = attentionTime(cutoff)
  const index = rows.findIndex((row) => {
    if (row.updatedAt !== time) return row.updatedAt < time
    if (typeof cutoff === 'number') return true
    return row.id > cutoff.id || (row.id === cutoff.id && cutoff.side === 'before')
  })
  return index < 0 ? rows.length : index
}

/** Resolve each exact row gap, including equal-time neighbors, without persisting a row number. */
export function cutoffAtGap(rows: readonly TimedRow[], gap: number, now: number): AttentionBoundary {
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (first === undefined || last === undefined) return now
  if (gap <= 0) return Math.max(now, first.updatedAt)
  if (gap >= rows.length) return { timestamp: last.updatedAt, id: last.id, side: 'after' }
  const row = rows[gap]
  return row === undefined ? now : { timestamp: row.updatedAt, id: row.id, side: 'before' }
}

/** Edge speed in pixels/frame; only the owned list scrolls. */
export function attentionScrollSpeed(y: number, top: number, bottom: number): number {
  const edge = Math.min(48, (bottom - top) / 3)
  if (edge <= 0) return 0
  if (y < top + edge) return -Math.min(12, Math.max(0, (top + edge - y) / 4))
  if (y > bottom - edge) return Math.min(12, Math.max(0, (y - bottom + edge) / 4))
  return 0
}
