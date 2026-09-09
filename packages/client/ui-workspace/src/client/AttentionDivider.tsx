/** A list-owned pointer gesture. Only pointerup after a held, moved drag commits the active channel. */
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from 'react'
import { type AttentionBoundary, attentionIndex, attentionManualIndex, attentionPointerGap, attentionRowsRetainPrefix, attentionTime, attentionScrollSpeed, cutoffAtGap } from './attention.ts'
import css from './AttentionDivider.module.css'

/** Independent row-count channel used only in Manual session order. */
type CountChannel = {
  gap: number
  preview: number | null
  setPreview: (value: number | null) => void
  commit: (gap: number) => void
}

type Props = {
  rows: readonly { readonly id: string; readonly updatedAt: number }[]
  listRef: RefObject<HTMLDivElement>
  cutoff: AttentionBoundary
  preview: AttentionBoundary | null
  setPreview: (value: AttentionBoundary | null) => void
  commit: (cutoff: AttentionBoundary) => void
  hasMore: boolean
  /** When set, the divider commits a persisted row count instead of a time cutoff. */
  count?: CountChannel | undefined
}

type Gesture = {
  pointerId: number
  x: number
  y: number
  lastY: number
  active: boolean
  moved: boolean
  cutoff: AttentionBoundary
  savedCutoff: AttentionBoundary
  gap: number
  savedGap: number
  rows: Props['rows']
  timer: ReturnType<typeof setTimeout>
  frame: number
  dispose: () => void
}

/** Occupy one real grid track without reparenting the handle or owning Session nodes. */
export function AttentionDivider({
  rows, listRef, cutoff, preview, setPreview, commit, hasMore, count,
}: Props) {
  const dividerRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const latest = useRef({ rows, cutoff, commit, count })
  latest.current = { rows, cutoff, commit, count }
  const effective = preview ?? cutoff
  const index = count === undefined
    ? attentionIndex(rows, effective)
    : attentionManualIndex(rows.length, count.preview ?? count.gap)

  function cancel(): void {
    gesture.current?.dispose()
    gesture.current = null
    setPreview(null)
    count?.setPreview(null)
  }

  function reconcile(g: Gesture): boolean {
    /* v8 ignore next -- stale-gesture backstop: down() refuses a second capture, and cancel() nulls the current gesture before remaining listeners run. */
    if (gesture.current !== g) return false
    const committed = latest.current.count === undefined
      ? latest.current.cutoff !== g.savedCutoff
      : latest.current.count.gap !== g.savedGap
    if (committed || !attentionRowsRetainPrefix(g.rows, latest.current.rows)) {
      cancel()
      return false
    }
    // Newly appended rows become part of the protected prefix for subsequent updates.
    g.rows = latest.current.rows
    return true
  }

  // Row updates reconcile without a cleanup: append-only paging must retain capture and preview.
  useEffect(() => {
    const g = gesture.current
    if (g !== null) reconcile(g)
  }, [rows, cutoff, count?.gap])
  useEffect(() => cancel, [])

  function down(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.isPrimary === false || event.button !== 0 || rows.length === 0 || gesture.current !== null) return
    event.stopPropagation()
    const button = event.currentTarget
    const list = listRef.current
    const divider = dividerRef.current
    if (list === null || divider === null) return
    const scroller = list
    const reservedTrack = divider
    button.setPointerCapture(event.pointerId)
    const g: Gesture = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY,
      active: false, moved: false, cutoff, savedCutoff: cutoff, gap: index, savedGap: index,
      rows, frame: 0,
      timer: setTimeout(() => {
        /* v8 ignore next -- dispose() clears this timeout before a cancelled gesture can fire. */
        if (!reconcile(g)) return
        g.active = true
        if (latest.current.count === undefined) setPreview(g.cutoff)
        else latest.current.count.setPreview(g.gap)
        g.frame = requestAnimationFrame(tick)
      }, 450),
      dispose: () => {
        clearTimeout(g.timer)
        cancelAnimationFrame(g.frame)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', abort)
        window.removeEventListener('blur', abort)
        window.removeEventListener('keydown', key)
        button.removeEventListener('lostpointercapture', abort)
        if (button.hasPointerCapture(g.pointerId)) button.releasePointerCapture(g.pointerId)
      },
    }
    gesture.current = g
    function choose(): void {
      const nodes = [...scroller.querySelectorAll<HTMLElement>('[data-attention-row]')]
      const gap = attentionPointerGap(nodes.map(node => node.getBoundingClientRect()), reservedTrack.getBoundingClientRect(), g.lastY)
      g.gap = gap
      if (latest.current.count === undefined) {
        g.cutoff = cutoffAtGap(latest.current.rows, gap, Date.now())
        setPreview(g.cutoff)
        return
      }
      latest.current.count.setPreview(gap)
    }
    function tick(): void {
      /* v8 ignore next -- dispose() cancels the animation frame before a cancelled gesture can tick. */
      if (!reconcile(g)) return
      if (g.moved) {
        const bounds = scroller.getBoundingClientRect()
        const before = scroller.scrollTop
        scroller.scrollTop += attentionScrollSpeed(g.lastY, bounds.top, bounds.bottom)
        // Native scrolling triggers the existing catalog loader; never call a second page loader.
        if (scroller.scrollTop !== before) choose()
      }
      g.frame = requestAnimationFrame(tick)
    }
    function move(e: PointerEvent): void {
      if (e.pointerId !== g.pointerId || !reconcile(g)) return
      const distance = Math.hypot(e.clientX - g.x, e.clientY - g.y)
      if (!g.active) {
        if (distance > 10) cancel()
        return
      }
      e.preventDefault()
      g.lastY = e.clientY
      if (distance > 3) { g.moved = true; choose() }
    }
    function up(e: PointerEvent): void {
      if (e.pointerId !== g.pointerId) return
      /* v8 ignore next -- dispose() removes this listener before a cancelled gesture can release. */
      if (!reconcile(g)) return
      const bounds = scroller.getBoundingClientRect()
      const inside = e.clientX >= bounds.left && e.clientX <= bounds.right
        && e.clientY >= bounds.top && e.clientY <= bounds.bottom
      const shouldCommit = g.active && g.moved && inside
      if (shouldCommit) { g.lastY = e.clientY; choose() }
      const value = g.cutoff
      const gap = g.gap
      const countCommit = latest.current.count?.commit
      cancel()
      if (!shouldCommit) return
      if (countCommit !== undefined) countCommit(gap)
      else latest.current.commit(value)
    }
    function abort(e: Event): void {
      if ('pointerId' in e && e.pointerId !== g.pointerId) return
      cancel()
    }
    function key(e: KeyboardEvent): void { if (e.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', abort)
    window.addEventListener('blur', abort)
    window.addEventListener('keydown', key)
    button.addEventListener('lostpointercapture', abort)
  }

  const beyondPage = count === undefined
    && index === rows.length && hasMore && attentionTime(cutoff) < (rows[rows.length - 1]?.updatedAt ?? 0)
  return (
    <div ref={dividerRef} className={css.divider} style={{ '--attention-gap-row': index + 1 } as CSSProperties}
      data-attention-cutoff={count === undefined ? attentionTime(effective) : 'manual' /* overlay locator; not a timestamp */}
      data-attention-boundary={count === undefined ? JSON.stringify(effective) : undefined}
      data-attention-manual-gap={count === undefined ? undefined : index}
      data-attention-index={index}>
      <span className={css.line} />
      <button
        type="button"
        className={css.handle}
        aria-label="关注分界线：上方需关注，下方可忽略；长按后拖动"
        aria-pressed={count === undefined ? preview !== null : count.preview !== null}
        title={beyondPage
          ? '分界点在更早历史中；继续加载可定位。长按可重新设置。'
          : count === undefined
            ? '上方需关注 · 下方可忽略。长按450毫秒后拖动；同一时间按会话ID稳定分界。'
            : '上方需关注 · 下方可忽略。长按450毫秒后拖动。'}
        onPointerDown={down}
        onClickCapture={(e) => { e.preventDefault(); e.stopPropagation() }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          cancel()
          const gap = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length : index + (e.key === 'ArrowUp' ? -1 : 1)
          if (count === undefined) commit(cutoffAtGap(rows, gap, Date.now()))
          else count.commit(attentionManualIndex(rows.length, gap))
        }}
      >
        <span aria-hidden="true">{(count === undefined ? preview : count.preview) !== null ? '↕' : '⋮⋮'}</span>
      </button>
    </div>
  )
}
