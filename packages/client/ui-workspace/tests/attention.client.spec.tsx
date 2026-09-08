// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { AttentionDivider } from '../src/client/AttentionDivider.tsx'
import { type AttentionBoundary, attentionCutoff, attentionIndex, attentionScrollSpeed, cutoffAtGap } from '../src/client/attention.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

const rows = [{ id: 'a', updatedAt: 300 }, { id: 'b', updatedAt: 200 }, { id: 'c', updatedAt: 100 }]
const rect = (top: number, height = 32) => ({
  x: 0, y: top, top, bottom: top + height, left: 0, right: 300, width: 300, height, toJSON: () => ({}),
})

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function pointer(target: EventTarget, type: string, x = 150, y = 116, id = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, { clientX: x, clientY: y, pointerId: id, isPrimary: true, button: 0, pointerType: 'touch' })
  act(() => { target.dispatchEvent(e) })
}

function mount(cutoff: AttentionBoundary = 200, more = false, initialRows = rows) {
  const listRef = createRef<HTMLDivElement>()
  const commit = vi.fn()
  const content = (items = initialRows) => <div ref={listRef}>
    <AttentionDivider rows={items} listRef={listRef} cutoff={cutoff} commit={commit} hasMore={more} />
    {items.map(row => <div key={row.id} data-attention-row={row.id}>{row.id}</div>)}
  </div>
  const view = render(content())
  const list = listRef.current!
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rect(0, 250))
  list.querySelectorAll<HTMLElement>('[data-attention-row]').forEach((el, i) => {
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => rect(100 + i * 32 - list.scrollTop))
  })
  const button = screen.getByRole('button', { name: /关注分界线/ })
  return { view, list, commit, button, content }
}

describe('timestamp partition', () => {
  it('partitions new activity and newly discovered old pages by unchanged time', () => {
    expect(attentionIndex(rows, 200)).toBe(1)
    expect(attentionIndex([{ id: 'c', updatedAt: 400 }, ...rows.slice(0, 2)], 200)).toBe(2)
    expect(attentionIndex([...rows, { id: 'd', updatedAt: 50 }], 200)).toBe(1)
    expect(attentionIndex(rows, 0)).toBe(3)
    expect(attentionIndex([], 10)).toBe(0)
  })
  it('maps top, middle and bottom gaps to timestamps, never persistent row indexes', () => {
    expect(cutoffAtGap(rows, 0, 1000)).toBe(1000)
    expect(cutoffAtGap(rows, 0, 100)).toBe(300)
    expect(cutoffAtGap(rows, 1, 1000)).toEqual({ timestamp: 200, id: 'b', side: 'before' })
    expect(cutoffAtGap(rows, 3, 1000)).toEqual({ timestamp: 100, id: 'c', side: 'after' })
    expect(cutoffAtGap([], 0, 1000)).toBe(1000)
  })
  it('resolves every gap in equal timestamps exactly, including first and last', () => {
    const tied = ['a', 'b', 'c', 'd'].map(id => ({ id, updatedAt: 200 }))
    for (let gap = 0; gap <= tied.length; gap++) {
      expect(attentionIndex(tied, cutoffAtGap(tied, gap, 1000))).toBe(gap)
    }
  })
  it('keeps identity boundaries stable after anchor removal and new activity', () => {
    const tied = ['a', 'b', 'c'].map(id => ({ id, updatedAt: 200 }))
    const cutoff = cutoffAtGap(tied, 1, 1000)
    expect(attentionIndex([tied[0]!, tied[2]!], cutoff)).toBe(1)
    expect(attentionIndex([{ id: 'c', updatedAt: 201 }, tied[0]!, tied[1]!], cutoff)).toBe(2)
    expect(attentionIndex([{ id: 'aa', updatedAt: 200 }, tied[1]!, tied[2]!], cutoff)).toBe(1)
  })
  it('initializes invalid/absent state to the fixed mount time but preserves legacy numbers', () => {
    for (const value of [null, undefined, NaN, Infinity, -1, '200', 9e15, {}, { timestamp: 200, id: '', side: 'before' }]) {
      expect(attentionCutoff(value, 1000)).toBe(1000)
    }
    expect(attentionCutoff(200, 1000)).toBe(200)
    const cutoff = { timestamp: 200, id: 'b', side: 'before' } as const
    expect(attentionCutoff(cutoff, 1000)).toBe(cutoff)
  })
  it('persists just the cutoff through the actual declared store', () => {
    const first = createWorkspaceViewStore().create()
    first.actions.setAttentionCutoff(200)
    expect(createWorkspaceViewStore().create().getSnapshot().attentionCutoff).toBe(200)
    first.actions.setOrderBy('manual')
    expect(first.getSnapshot().orderBy).toBe('updated')
  })
  it('bounds edge scroll and does not scroll the middle', () => {
    expect(attentionScrollSpeed(0, 0, 300)).toBe(-12)
    expect(attentionScrollSpeed(300, 0, 300)).toBe(12)
    expect(attentionScrollSpeed(150, 0, 300)).toBe(0)
    expect(attentionScrollSpeed(0, 0, 0)).toBe(0)
  })
})

describe('divider pointer ownership', () => {
  it('held drag commits the exact middle gap between same-time rows', () => {
    const tied = ['a', 'b', 'c'].map(id => ({ id, updatedAt: 200 }))
    const b = mount(1000, false, tied)
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 170)
    pointer(window, 'pointerup', 150, 170)
    const expected = { timestamp: 200, id: 'c', side: 'before' }
    expect(b.commit).toHaveBeenCalledExactlyOnceWith(expected)
    expect(attentionIndex(tied, expected as AttentionBoundary)).toBe(2)
  })
  it('keyboard advances one row within a same-time cohort', () => {
    const tied = ['a', 'b', 'c'].map(id => ({ id, updatedAt: 200 }))
    const b = mount({ timestamp: 200, id: 'b', side: 'before' }, false, tied)
    fireEvent.keyDown(b.button, { key: 'ArrowDown' })
    expect(b.commit).toHaveBeenLastCalledWith({ timestamp: 200, id: 'c', side: 'before' })
  })
  it('short tap and movement before 450ms never persist', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(449))
    pointer(window, 'pointerup')
    expect(b.commit).not.toHaveBeenCalled()
    pointer(b.button, 'pointerdown')
    pointer(window, 'pointermove', 150, 140)
    act(() => vi.advanceTimersByTime(500))
    pointer(window, 'pointerup', 150, 180)
    expect(b.commit).not.toHaveBeenCalled()
  })
  it('long hold without movement does not move the cutoff', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    pointer(window, 'pointerup')
    expect(b.commit).not.toHaveBeenCalled()
    expect(b.button.getAttribute('aria-pressed')).toBe('false')
  })
  it('commits exactly once after a held drag at a real row gap', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 170)
    expect(b.commit).not.toHaveBeenCalled()
    pointer(window, 'pointerup', 150, 170)
    pointer(window, 'pointerup', 150, 170)
    expect(b.commit).toHaveBeenCalledExactlyOnceWith({ timestamp: 100, id: 'c', side: 'before' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape'])('%s cancels without persisting', (kind) => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 170)
    if (kind === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else pointer(kind === 'lostpointercapture' ? b.button : window, kind)
    pointer(window, 'pointerup', 150, 170)
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores other fingers and rejects a release outside the list', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 170, 2)
    pointer(window, 'pointerup', 150, 170, 2)
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    pointer(window, 'pointermove', 150, 170)
    pointer(window, 'pointerup', 400, 170)
    expect(b.commit).not.toHaveBeenCalled()
  })
  it('new activity while dragging cancels the old geometry', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 170)
    b.view.rerender(b.content([{ id: 'b', updatedAt: 400 }, rows[0]!, rows[2]!]))
    pointer(window, 'pointerup', 150, 170)
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('unmount owns all pending timers and listeners', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    b.view.unmount()
    act(() => vi.advanceTimersByTime(1000))
    pointer(window, 'pointerup')
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('scrolls only the list while held at its edge, then stops on cancel', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 245)
    act(() => vi.advanceTimersByTime(48))
    expect(b.list.scrollTop).toBeGreaterThan(0)
    const atCancel = b.list.scrollTop
    pointer(window, 'pointercancel')
    act(() => vi.advanceTimersByTime(100))
    expect(b.list.scrollTop).toBe(atCancel)
    expect(b.commit).not.toHaveBeenCalled()
  })
  it('preserves a cutoff beyond loaded history and explains paging', () => {
    const b = mount(10, true)
    expect(b.button.title).toContain('更早历史')
    expect(b.button.closest('[data-attention-cutoff]')?.getAttribute('data-attention-cutoff')).toBe('10')
  })
  it('supports explicit keyboard gap movement and suppresses handle clicks', () => {
    const b = mount()
    const click = vi.fn()
    b.list.addEventListener('click', click)
    fireEvent.click(b.button)
    expect(click).not.toHaveBeenCalled()
    fireEvent.keyDown(b.button, { key: 'ArrowDown' })
    expect(b.commit).toHaveBeenLastCalledWith({ timestamp: 100, id: 'c', side: 'before' })
    fireEvent.keyDown(b.button, { key: 'Home' })
    expect(b.commit).toHaveBeenLastCalledWith(1000)
    fireEvent.keyDown(b.button, { key: 'End' })
    expect(b.commit).toHaveBeenLastCalledWith({ timestamp: 100, id: 'c', side: 'after' })
  })
})
