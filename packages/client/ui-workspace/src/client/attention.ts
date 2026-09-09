/** A timestamp boundary, with a stable identity only to disambiguate equal-time gaps. */
export type AttentionBoundary = number | { readonly timestamp: number; readonly id: string; readonly side: 'before' | 'after' }
type TimedRow = { readonly updatedAt: number; readonly id: string }

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
}

/**
 * Decode durable viewing state, preserving valid legacy numeric cutoffs.
 * @param value - persisted viewing-state value.
 * @param initialTime - fixed mount time used for missing or invalid state.
 * @returns the validated cutoff or initialization time.
 */
export function attentionCutoff(value: unknown, initialTime: number): AttentionBoundary {
  if (validTime(value)) return value
  if (typeof value === 'object' && value !== null && 'timestamp' in value && validTime(value.timestamp)
    && 'id' in value && typeof value.id === 'string' && value.id.length > 0
    && 'side' in value && (value.side === 'before' || value.side === 'after')) {
    return value as AttentionBoundary
  }
  return initialTime
}

/**
 * Read the timestamp shared by legacy numeric and identity-qualified cutoffs.
 * @param cutoff - validated cutoff.
 * @returns its timestamp in milliseconds.
 */
export function attentionTime(cutoff: AttentionBoundary): number {
  return typeof cutoff === 'number' ? cutoff : cutoff.timestamp
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)
}

/**
 * Clamp a manual-mode row count to the inclusive loaded range `[0, length]`.
 * @param length - current loaded row count.
 * @param gap - requested count of rows above the line.
 * @returns the clamped count.
 */
export function attentionManualIndex(length: number, gap: number): number {
  return Math.max(0, Math.min(length, gap))
}

/**
 * Decode a persisted manual gap; missing or invalid values use the updated-mode visual index.
 * @param value - stored count, or any invalid persist payload.
 * @param fallback - current Last-updated visual index used only when `value` is missing or invalid.
 * @param length - current loaded row count.
 * @returns the clamped count.
 */
export function attentionManualGap(value: unknown, fallback: number, length: number): number {
  return attentionManualIndex(length, validCount(value) ? value : fallback)
}

/**
 * Keep an independent count when the catalog membership changes.
 * Reorder and tail append leave the count unchanged; removing an above-line row decrements it.
 * @param previousIds - last accepted manual display order.
 * @param nextIds - latest manual display order.
 * @param gap - persisted count of rows above the line.
 * @returns the clamped count for `nextIds`.
 */
export function nextAttentionManualGap(
  previousIds: readonly string[],
  nextIds: readonly string[],
  gap: number,
): number {
  const previousAbove = previousIds.slice(0, gap)
  const removedAbove = previousAbove.filter(id => !nextIds.includes(id)).length
  return attentionManualIndex(nextIds.length, gap - removedAbove)
}

/**
 * Locate the first ignored row using the catalog's timestamp and identity ordering.
 * @param rows - rows sorted by descending timestamp, then ascending ID.
 * @param cutoff - saved time and optional equal-time identity position.
 * @returns the first ignored index, or the row count if none are ignored.
 */
export function attentionIndex(rows: readonly TimedRow[], cutoff: AttentionBoundary): number {
  const time = attentionTime(cutoff)
  const index = rows.findIndex((row) => {
    if (row.updatedAt !== time) return row.updatedAt < time
    if (typeof cutoff === 'number') return true
    return row.id > cutoff.id || (row.id === cutoff.id && cutoff.side === 'before')
  })
  return index < 0 ? rows.length : index
}

/**
 * Describe a row gap without persisting an index that activity could invalidate.
 * @param rows - rows sorted by descending timestamp, then ascending ID.
 * @param gap - requested insertion index, including positions before and after the list.
 * @param now - current time for an empty list or the position before its first row.
 * @returns the timestamp and optional identity locating that gap.
 */
export function cutoffAtGap(rows: readonly TimedRow[], gap: number, now: number): AttentionBoundary {
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (first === undefined || last === undefined) return now
  if (gap <= 0) return Math.max(now, first.updatedAt)
  if (gap >= rows.length) return { timestamp: last.updatedAt, id: last.id, side: 'after' }
  const row = rows[gap]
  return row === undefined ? now : { timestamp: row.updatedAt, id: row.id, side: 'before' }
}

/**
 * Accept unchanged rows or tail-only pagination, never mutations of an observed prefix.
 * @param previous - rows already accepted by the current gesture.
 * @param next - latest ordered catalog projection.
 * @returns whether every observed row retains its identity, time and position.
 */
export function attentionRowsRetainPrefix(previous: readonly TimedRow[], next: readonly TimedRow[]): boolean {
  return next.length >= previous.length && previous.every((row, index) => {
    const candidate = next[index]
    return candidate?.id === row.id && candidate.updatedAt === row.updatedAt
  })
}

type VerticalRect = { readonly top: number; readonly bottom: number }

/**
 * Hit-test in gap-free coordinates so moving the reserved track cannot move the target.
 * @param rows - current viewport rectangles of the ordered Session rows.
 * @param gap - current viewport rectangle of the divider's reserved track.
 * @param pointerY - current pointer position in viewport coordinates.
 * @returns the insertion gap before a row, or after the final row.
 */
export function attentionPointerGap(rows: readonly VerticalRect[], gap: VerticalRect, pointerY: number): number {
  const withoutGap = (y: number): number => y <= gap.top ? y : Math.max(gap.top, y - (gap.bottom - gap.top))
  const y = withoutGap(pointerY)
  const index = rows.findIndex(row => y < withoutGap((row.top + row.bottom) / 2))
  return index < 0 ? rows.length : index
}

/**
 * Compute signed edge-scroll speed for the owned list, not the page.
 * @param y - pointer's viewport Y coordinate.
 * @param top - list viewport's upper edge.
 * @param bottom - list viewport's lower edge.
 * @returns pixels per animation frame; negative scrolls toward earlier rows.
 */
export function attentionScrollSpeed(y: number, top: number, bottom: number): number {
  const edge = Math.min(48, (bottom - top) / 3)
  if (edge <= 0) return 0
  if (y < top + edge) return -Math.min(12, Math.max(0, (top + edge - y) / 4))
  if (y > bottom - edge) return Math.min(12, Math.max(0, (y - bottom + edge) / 4))
  return 0
}
