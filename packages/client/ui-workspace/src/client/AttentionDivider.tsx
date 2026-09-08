/** A list-owned pointer gesture. Only pointerup after a held, moved drag commits time. */
import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { attentionIndex, attentionScrollSpeed, cutoffAtGap } from './attention.ts'
import css from './AttentionDivider.module.css'

type Props = {
  rows: readonly { readonly id: string; readonly updatedAt: number }[]
  listRef: RefObject<HTMLDivElement>
  cutoff: number
  commit: (cutoff: number) => void
  hasMore: boolean
}

type Gesture = {
  pointerId: number
  x: number
  y: number
  lastY: number
  active: boolean
  moved: boolean
  cutoff: number
  timer: ReturnType<typeof setTimeout>
  frame: number
  dispose: () => void
}

/** Render one stable handle over the gap; moving it never reorders or owns session nodes. */
export function AttentionDivider({ rows, listRef, cutoff, commit, hasMore }: Props) {
  const [preview, setPreview] = useState<number | null>(null)
  const [top, setTop] = useState(12)
  const gesture = useRef<Gesture | null>(null)
  const latest = useRef({ rows, cutoff, commit })
  latest.current = { rows, cutoff, commit }
  const effective = preview ?? cutoff
  const index = attentionIndex(rows, effective)
  const signature = rows.map(row => `${row.id}:${row.updatedAt}`).join('|')

  function cancel(): void {
    gesture.current?.dispose()
    gesture.current = null
    setPreview(null)
  }

  // New activity/pages invalidate geometry while dragging, rather than committing a stale gap.
  useEffect(() => cancel, [signature, cutoff])
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    function measure(): void {
      if (list === null) return
      const nodes = list.querySelectorAll<HTMLElement>('[data-attention-row]')
      const row = nodes[index]
      const last = nodes[nodes.length - 1]
      const origin = list.getBoundingClientRect().top - list.scrollTop + list.clientTop
      setTop(row !== undefined ? row.getBoundingClientRect().top - origin
        : last !== undefined ? last.getBoundingClientRect().bottom - origin : 12)
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(list)
    window.addEventListener('resize', measure)
    return () => { resize?.disconnect(); window.removeEventListener('resize', measure) }
  }, [signature, index, listRef])

  function down(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.isPrimary === false || event.button !== 0 || rows.length === 0 || gesture.current !== null) return
    event.stopPropagation()
    const button = event.currentTarget
    const list = listRef.current
    if (list === null) return
    const scroller = list
    button.setPointerCapture(event.pointerId)
    const g: Gesture = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY,
      active: false, moved: false, cutoff, frame: 0,
      timer: setTimeout(() => {
        g.active = true
        setPreview(g.cutoff)
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
      const gap = nodes.findIndex((node) => {
        const rect = node.getBoundingClientRect()
        return g.lastY < rect.top + rect.height / 2
      })
      g.cutoff = cutoffAtGap(latest.current.rows, gap < 0 ? nodes.length : gap, Date.now())
      setPreview(g.cutoff)
    }
    function tick(): void {
      if (gesture.current !== g) return
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
      if (e.pointerId !== g.pointerId) return
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
      const bounds = scroller.getBoundingClientRect()
      const inside = e.clientX >= bounds.left && e.clientX <= bounds.right
        && e.clientY >= bounds.top && e.clientY <= bounds.bottom
      const shouldCommit = g.active && g.moved && inside
      if (shouldCommit) { g.lastY = e.clientY; choose() }
      const value = g.cutoff
      cancel()
      if (shouldCommit) latest.current.commit(value)
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

  const beyondPage = index === rows.length && hasMore && cutoff < (rows[rows.length - 1]?.updatedAt ?? 0)
  return (
    <div className={css.divider} style={{ top }} data-attention-cutoff={effective} data-attention-index={index}>
      <span className={css.line} />
      <button
        type="button"
        className={css.handle}
        aria-label="关注分界线：上方需关注，下方可忽略；长按后拖动"
        aria-pressed={preview !== null}
        title={beyondPage ? '分界点在更早历史中；继续加载可定位。长按可重新设置。' : '上方需关注 · 下方可忽略。长按450毫秒后拖动；相同更新时间一起移动。'}
        onPointerDown={down}
        onClickCapture={(e) => { e.preventDefault(); e.stopPropagation() }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          cancel()
          let gap = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length : index + (e.key === 'ArrowUp' ? -1 : 1)
          if (e.key === 'ArrowDown') {
            while (gap < rows.length && rows[gap]?.updatedAt === rows[index]?.updatedAt) gap++
          }
          commit(cutoffAtGap(rows, gap, Date.now()))
        }}
      >
        <span aria-hidden="true">{preview !== null ? '↕' : '⋮⋮'}</span>
      </button>
      <span className={css.caption} aria-hidden="true">{beyondPage ? '分界在更早历史 ↓' : '↑ 关注 · 可忽略 ↓'}</span>
    </div>
  )
}
