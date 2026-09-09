/** A list-owned pointer gesture. Pointerdown starts the drag; only pointerup after a moved drag commits. */
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type AttentionBoundary, attentionIndex, attentionManualIndex, attentionPointerGap, attentionRowsRetainPrefix, attentionTime, attentionScrollSpeed, cutoffAtGap } from './attention.ts'
import css from './AttentionDivider.module.css'

/** Independent row-count channel used only in Manual session order. */
type CountChannel = {
  gap: number
  commit: (gap: number) => void
}

type Props = {
  rows: readonly { readonly id: string; readonly updatedAt: number }[]
  listRef: RefObject<HTMLDivElement>
  cutoff: AttentionBoundary
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
  frame: number
  layout: () => void
  dispose: () => void
}

function hideOverlay(ghost: HTMLDivElement | null, marker: HTMLDivElement | null, track: HTMLDivElement | null): void {
  ghost?.removeAttribute('data-show')
  marker?.removeAttribute('data-show')
  if (track !== null) delete track.dataset.attentionPreviewGap
}

/** Occupy one real grid track without reparenting the handle or owning Session nodes. */
export function AttentionDivider({
  rows, listRef, cutoff, commit, hasMore, count,
}: Props) {
  const dividerRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const latest = useRef({ rows, cutoff, commit, count })
  latest.current = { rows, cutoff, commit, count }
  const [dragging, setDragging] = useState(false)
  const index = count === undefined
    ? attentionIndex(rows, cutoff)
    : attentionManualIndex(rows.length, count.gap)

  function cancel(): void {
    gesture.current?.dispose()
    gesture.current = null
    hideOverlay(ghostRef.current, markerRef.current, dividerRef.current)
    setDragging(false)
  }

  function reconcile(g: Gesture): boolean {
    /* v8 ignore next -- down() rejects a second capture; cancel() clears the gesture before remaining listeners run. */
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

  useLayoutEffect(() => {
    const g = gesture.current
    if (g === null) {
      hideOverlay(ghostRef.current, markerRef.current, dividerRef.current)
      return
    }
    if (reconcile(g)) g.layout()
  })
  useEffect(() => cancel, [])

  function down(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.isPrimary === false || event.button !== 0 || rows.length === 0 || gesture.current !== null) return
    event.stopPropagation()
    const button = event.currentTarget
    const list = listRef.current
    const divider = dividerRef.current
    if (list === null || divider === null) return
    event.preventDefault()
    button.focus({ preventScroll: true })
    const scroller = list
    const reservedTrack = divider
    button.setPointerCapture(event.pointerId)
    const g: Gesture = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY,
      active: true, moved: false, cutoff, savedCutoff: cutoff, gap: index, savedGap: index,
      rows, frame: 0,
      layout: () => {},
      dispose: () => {
        const frame = g.frame
        g.frame = 0
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', abort)
        window.removeEventListener('blur', abort)
        window.removeEventListener('keydown', key)
        button.removeEventListener('lostpointercapture', abort)
        if (button.hasPointerCapture(g.pointerId)) button.releasePointerCapture(g.pointerId)
        hideOverlay(ghostRef.current, markerRef.current, reservedTrack)
      },
    }
    function layout(): void {
      const nodes = [...scroller.querySelectorAll<HTMLElement>('[data-attention-row]')]
      const gap = attentionPointerGap(nodes.map(node => node.getBoundingClientRect()), reservedTrack.getBoundingClientRect(), g.lastY)
      g.gap = gap
      if (latest.current.count === undefined) {
        g.cutoff = cutoffAtGap(latest.current.rows, gap, Date.now())
      }
      const ghost = ghostRef.current
      const marker = markerRef.current
      if (ghost === null || marker === null) return
      ghost.toggleAttribute('data-show', g.moved)
      marker.toggleAttribute('data-show', g.moved && gap !== g.savedGap)
      if (g.moved) reservedTrack.dataset.attentionPreviewGap = String(gap)
      else delete reservedTrack.dataset.attentionPreviewGap
      if (!g.moved) return
      const listBox = scroller.getBoundingClientRect()
      ghost.style.left = `${listBox.left + 8}px`
      ghost.style.width = `${Math.max(0, listBox.width - 16)}px`
      ghost.style.top = `${g.lastY}px`
      if (!marker.hasAttribute('data-show')) return
      const rects = nodes.map(node => node.getBoundingClientRect())
      const first = rects[0]
      const last = rects[rects.length - 1]
      const y = gap <= 0
        ? (first?.top ?? listBox.top)
        : gap >= rects.length
          ? (last?.bottom ?? listBox.bottom)
          : (rects[gap]?.top ?? listBox.top)
      marker.style.left = `${listBox.left}px`
      marker.style.width = `${Math.max(0, listBox.width - 4)}px`
      marker.style.top = `${y - 6}px`
    }
    g.layout = layout
    gesture.current = g
    function tick(): void {
      /* v8 ignore next -- dispose() cancels the animation frame before a cancelled gesture can tick. */
      if (g.frame === 0 || !reconcile(g)) return
      const bounds = scroller.getBoundingClientRect()
      const before = scroller.scrollTop
      scroller.scrollTop += attentionScrollSpeed(g.lastY, bounds.top, bounds.bottom)
      // Native scrolling triggers the existing catalog loader; never call a second page loader.
      if (scroller.scrollTop !== before) layout()
      g.frame = requestAnimationFrame(tick)
    }
    function move(e: PointerEvent): void {
      if (e.pointerId !== g.pointerId || !reconcile(g)) return
      e.preventDefault()
      g.lastY = e.clientY
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) {
        g.moved = true
        layout()
        if (g.frame === 0) g.frame = requestAnimationFrame(tick)
      }
    }
    function up(e: PointerEvent): void {
      if (e.pointerId !== g.pointerId) return
      /* v8 ignore next -- dispose() removes this listener before a cancelled gesture can release. */
      if (!reconcile(g)) return
      const bounds = scroller.getBoundingClientRect()
      const inside = e.clientX >= bounds.left && e.clientX <= bounds.right
        && e.clientY >= bounds.top && e.clientY <= bounds.bottom
      const shouldCommit = g.active && g.moved && inside
      if (shouldCommit) { g.lastY = e.clientY; layout() }
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
    setDragging(true)
  }

  const beyondPage = count === undefined
    && index === rows.length && hasMore && attentionTime(cutoff) < (rows[rows.length - 1]?.updatedAt ?? 0)
  return (
    <div ref={dividerRef} className={css.divider} style={{ '--attention-gap-row': index + 1 } as CSSProperties}
      data-attention-cutoff={count === undefined ? attentionTime(cutoff) : 'manual' /* overlay locator; not a timestamp */}
      data-attention-boundary={count === undefined ? JSON.stringify(cutoff) : undefined}
      data-attention-manual-gap={count === undefined ? undefined : index}
      data-attention-index={index}>
      <span className={css.line} />
      <button
        type="button"
        className={css.handle}
        aria-label="关注分界线：上方需关注，下方可忽略；按下后拖动"
        aria-pressed={dragging}
        title={beyondPage
          ? '分界点在更早历史中；继续加载可定位。按下后可重新设置。'
          : count === undefined
            ? '上方需关注 · 下方可忽略。按下后拖动；同一时间按会话ID稳定分界。'
            : '上方需关注 · 下方可忽略。按下后拖动。'}
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
        <span aria-hidden="true">{dragging ? '↕' : '⋮⋮'}</span>
      </button>
      <div ref={ghostRef} className={css.ghost} data-attention-ghost>
        <span className={css.line} />
        <span className={css.handle} aria-hidden="true">↕</span>
      </div>
      <div ref={markerRef} className={css.marker} data-attention-marker />
    </div>
  )
}
