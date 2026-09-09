// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type CSSProperties, createRef, useState } from 'react'
import { AttentionDivider } from '../src/client/AttentionDivider.tsx'
import { type AttentionBoundary, attentionCutoff, attentionIndex, attentionManualGap, attentionManualIndex, attentionPointerGap, attentionScrollSpeed, cutoffAtGap, nextAttentionManualGap } from '../src/client/attention.ts'
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

function pointer(target: EventTarget, type: string, x = 150, y?: number, id = 1) {
  const bounds = target instanceof HTMLElement ? target.getBoundingClientRect() : rect(100)
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, { clientX: x, clientY: y ?? (bounds.top + bounds.bottom) / 2, pointerId: id, isPrimary: true, button: 0, pointerType: 'touch' })
  act(() => { target.dispatchEvent(e) })
}

function mount(cutoff: AttentionBoundary = 200, more = false, initialRows = rows) {
  const listRef = createRef<HTMLDivElement>()
  const commit = vi.fn()
  const open = vi.fn()
  function Fixture({ items }: { items: typeof rows }) {
    const [preview, setPreview] = useState<AttentionBoundary | null>(null)
    const gap = attentionIndex(items, preview ?? cutoff)
    return <div ref={listRef}>
      <AttentionDivider rows={items} listRef={listRef} cutoff={cutoff} preview={preview} setPreview={setPreview}
        commit={commit} hasMore={more} />
      {items.map((row, index) => (
        <div key={row.id} data-attention-row={row.id} style={{ '--attention-row': index + 1 + (index >= gap ? 1 : 0) } as CSSProperties}
          onClick={() => { open(row.id) }}>{row.id}</div>
      ))}
    </div>
  }
  const content = (items = initialRows) => <Fixture items={items} />
  const view = render(content())
  const list = listRef.current!
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rect(0, 250))
  const measureRows = () => {
    list.querySelectorAll<HTMLElement>('[data-attention-row]').forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => rect(100 + (Number(el.style.getPropertyValue('--attention-row')) - 1) * 32 - list.scrollTop))
    })
  }
  measureRows()
  const button = screen.getByRole('button', { name: /关注分界线/ })
  const divider = button.closest<HTMLElement>('[data-attention-index]')!
  vi.spyOn(divider, 'getBoundingClientRect').mockImplementation(() => rect(100 + Number(divider.dataset.attentionIndex) * 32 - list.scrollTop))
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => rect(divider.getBoundingClientRect().top + 6, 20))
  return { view, list, commit, button, divider, open, content, measureRows }
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
    expect(cutoffAtGap(rows, 1.5, 1000)).toBe(1000)
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
    for (const value of [null, undefined, NaN, Infinity, -1, '200', 9e15, {}, { timestamp: 200, id: '', side: 'before' }, { timestamp: 200, id: 'b', side: 'beside' }]) {
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
    expect(first.getSnapshot().orderBy).toBe('manual')
    first.actions.setAttentionManualGap(2)
    expect(createWorkspaceViewStore().create().getSnapshot().attentionManualGap).toBe(2)
    expect(createWorkspaceViewStore().create().getSnapshot().orderBy).toBe('manual')
  })
  it('clamps a manual count and decrements only when an above-line row is removed', () => {
    expect(attentionManualIndex(3, 5)).toBe(3)
    expect(attentionManualIndex(3, -1)).toBe(0)
    expect(attentionManualGap(undefined, 1, 3)).toBe(1)
    expect(attentionManualGap(2.5, 1, 3)).toBe(1)
    expect(attentionManualGap(2, 1, 3)).toBe(2)
    expect(nextAttentionManualGap(['a', 'b', 'c'], ['a', 'c', 'b'], 2)).toBe(2)
    expect(nextAttentionManualGap(['a', 'b', 'c'], ['a', 'c'], 2)).toBe(1)
    expect(nextAttentionManualGap(['a', 'b', 'c'], ['a', 'b'], 2)).toBe(2)
    expect(nextAttentionManualGap(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 2)).toBe(2)
  })
  it('bounds edge scroll and does not scroll the middle', () => {
    expect(attentionScrollSpeed(0, 0, 300)).toBe(-12)
    expect(attentionScrollSpeed(300, 0, 300)).toBe(12)
    expect(attentionScrollSpeed(150, 0, 300)).toBe(0)
    expect(attentionScrollSpeed(0, 0, 0)).toBe(0)
  })
})

describe('divider pointer ownership', () => {
  it('held drag in count mode commits a row count rather than a time boundary', () => {
    const listRef = createRef<HTMLDivElement>()
    const commit = vi.fn()
    const countCommit = vi.fn()
    function Fixture() {
      const [preview, setPreview] = useState<AttentionBoundary | null>(null)
      const [countPreview, setCountPreview] = useState<number | null>(null)
      return <div ref={listRef}>
        <AttentionDivider rows={rows} listRef={listRef} cutoff={200} preview={preview} setPreview={setPreview}
          commit={commit} hasMore={false}
          count={{ gap: 1, preview: countPreview, setPreview: setCountPreview, commit: countCommit }} />
        {rows.map((row, index) => {
          const gap = countPreview ?? 1
          return <div key={row.id} data-attention-row={row.id}
            style={{ '--attention-row': index + 1 + (index >= gap ? 1 : 0) } as CSSProperties}>{row.id}</div>
        })}
      </div>
    }
    const view = render(<Fixture />)
    const list = listRef.current!
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => rect(0, 250))
    list.querySelectorAll<HTMLElement>('[data-attention-row]').forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => rect(100 + (Number(el.style.getPropertyValue('--attention-row')) - 1) * 32))
    })
    const button = screen.getByRole('button', { name: /关注分界线/ })
    const divider = button.closest<HTMLElement>('[data-attention-index]')!
    vi.spyOn(divider, 'getBoundingClientRect').mockImplementation(() => rect(100 + Number(divider.dataset.attentionIndex) * 32))
    expect(divider.getAttribute('data-attention-manual-gap')).toBe('1')
    expect(divider.getAttribute('data-attention-cutoff')).toBe('manual')
    expect(divider.getAttribute('data-attention-index')).toBe('1')
    expect(divider.hasAttribute('data-attention-cutoff')).toBe(true)
    pointer(button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    pointer(window, 'pointerup', 150, 202)
    expect(countCommit).toHaveBeenCalledExactlyOnceWith(2)
    expect(commit).not.toHaveBeenCalled()
    view.unmount()
  })
  it('count-mode keyboard, unused keys, and context menu never write a time cutoff', () => {
    const listRef = createRef<HTMLDivElement>()
    const commit = vi.fn()
    const countCommit = vi.fn()
    function Fixture({ gap }: { gap: number }) {
      const [preview, setPreview] = useState<AttentionBoundary | null>(null)
      const [countPreview, setCountPreview] = useState<number | null>(null)
      return <div ref={listRef}>
        <AttentionDivider rows={rows} listRef={listRef} cutoff={200} preview={preview} setPreview={setPreview}
          commit={commit} hasMore={true}
          count={{ gap, preview: countPreview, setPreview: setCountPreview, commit: countCommit }} />
      </div>
    }
    const view = render(<Fixture gap={1} />)
    const button = screen.getByRole('button', { name: /关注分界线/ })
    expect(button.title).not.toContain('更早历史')
    expect(button.textContent).toBe('⋮⋮')
    fireEvent.contextMenu(button)
    fireEvent.keyDown(button, { key: 'a' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(countCommit).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(button, { key: 'Home' })
    expect(countCommit).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(button, { key: 'End' })
    expect(countCommit).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(button, { key: 'ArrowUp' })
    expect(countCommit).toHaveBeenLastCalledWith(0)
    expect(commit).not.toHaveBeenCalled()
    view.unmount()
  })
  it('count-mode hold shows the drag glyph and cancels when the committed count moves', () => {
    const listRef = createRef<HTMLDivElement>()
    const commit = vi.fn()
    const countCommit = vi.fn()
    function Fixture({ gap }: { gap: number }) {
      const [preview, setPreview] = useState<AttentionBoundary | null>(null)
      const [countPreview, setCountPreview] = useState<number | null>(null)
      return <div ref={listRef}>
        <AttentionDivider rows={rows} listRef={listRef} cutoff={200} preview={preview} setPreview={setPreview}
          commit={commit} hasMore={false}
          count={{ gap, preview: countPreview, setPreview: setCountPreview, commit: countCommit }} />
      </div>
    }
    const view = render(<Fixture gap={1} />)
    const button = screen.getByRole('button', { name: /关注分界线/ })
    pointer(button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toBe('↕')
    view.rerender(<Fixture gap={2} />)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    pointer(window, 'pointerup', 150, 202)
    expect(countCommit).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    view.unmount()
  })
  it('ignores a secondary pointer and an empty catalog', () => {
    const emptyRef = createRef<HTMLDivElement>()
    const commit = vi.fn()
    const empty = render(<div ref={emptyRef}>
      <AttentionDivider rows={[]} listRef={emptyRef} cutoff={200} preview={null} setPreview={() => {}} commit={commit} hasMore={true} />
    </div>)
    const emptyButton = screen.getByRole('button', { name: /关注分界线/ })
    pointer(emptyButton, 'pointerdown')
    act(() => vi.advanceTimersByTime(500))
    pointer(window, 'pointerup')
    expect(commit).not.toHaveBeenCalled()
    empty.unmount()
    const b = mount()
    const secondary = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.assign(secondary, { clientX: 150, clientY: 116, pointerId: 1, isPrimary: true, button: 1, pointerType: 'mouse' })
    act(() => { b.button.dispatchEvent(secondary) })
    const nonPrimary = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.assign(nonPrimary, { clientX: 150, clientY: 116, pointerId: 1, isPrimary: false, button: 0, pointerType: 'touch' })
    act(() => { b.button.dispatchEvent(nonPrimary) })
    act(() => vi.advanceTimersByTime(500))
    expect(b.commit).not.toHaveBeenCalled()
  })
  it('ignores pointerdown before the list is attached and a second capture', () => {
    const listRef = createRef<HTMLDivElement>()
    const commit = vi.fn()
    const detached = render(
      <AttentionDivider rows={rows} listRef={listRef} cutoff={200} preview={null} setPreview={() => {}} commit={commit} hasMore={false} />,
    )
    pointer(screen.getByRole('button', { name: /关注分界线/ }), 'pointerdown')
    act(() => vi.advanceTimersByTime(500))
    pointer(window, 'pointerup')
    expect(commit).not.toHaveBeenCalled()
    detached.unmount()
    const b = mount()
    pointer(b.button, 'pointerdown')
    pointer(b.button, 'pointerdown', 150, undefined, 3)
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 152, (b.button.getBoundingClientRect().top + b.button.getBoundingClientRect().bottom) / 2)
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: 'a' })
    pointer(window, 'pointercancel', 150, 202, 2)
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    pointer(window, 'pointerup')
    expect(b.commit).not.toHaveBeenCalled()
  })
  it('keeps a pending hold through a short nudge and a held tick that does not scroll', () => {
    const b = mount()
    const start = b.button.getBoundingClientRect()
    const y = (start.top + start.bottom) / 2
    pointer(b.button, 'pointerdown', 150, y)
    pointer(window, 'pointermove', 154, y + 2)
    act(() => vi.advanceTimersByTime(450))
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    act(() => vi.advanceTimersByTime(16))
    pointer(window, 'pointermove', 151, y + 1)
    act(() => vi.advanceTimersByTime(16))
    pointer(window, 'pointermove', 150, 202)
    act(() => vi.advanceTimersByTime(16))
    pointer(window, 'pointerup', 150, 202)
    expect(b.commit).toHaveBeenCalledExactlyOnceWith({ timestamp: 100, id: 'c', side: 'before' })
  })
  it('held drag commits the exact middle gap between same-time rows', () => {
    const tied = ['a', 'b', 'c'].map(id => ({ id, updatedAt: 200 }))
    const b = mount(1000, false, tied)
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    pointer(window, 'pointerup', 150, 202)
    const expected = { timestamp: 200, id: 'c', side: 'before' }
    expect(b.commit).toHaveBeenCalledExactlyOnceWith(expected)
    expect(attentionIndex(tied, expected as AttentionBoundary)).toBe(2)
  })
  it('keeps pointer targets stable when the reserved track moves, including variable row heights and scrolling', () => {
    const heights = [34, 48, 26]
    for (const scrollTop of [0, 60]) {
      const geometry = (gap: number) => {
        let top = 100 - scrollTop
        const items = heights.map((height, index) => {
          const rowTop = top + (index >= gap ? 32 : 0)
          top += height
          return { top: rowTop, bottom: rowTop + height }
        })
        const gapTop = 100 - scrollTop + heights.slice(0, gap).reduce((sum, height) => sum + height, 0)
        return { items, track: { top: gapTop, bottom: gapTop + 32 } }
      }
      for (let gap = 0; gap <= heights.length; gap++) {
        const original = geometry(gap)
        for (let y = 20; y < 280; y++) {
          const target = attentionPointerGap(original.items, original.track, y)
          const moved = geometry(target)
          expect(attentionPointerGap(moved.items, moved.track, y)).toBe(target)
        }
      }
    }
  })
  it('keeps the held handle and capture stable as its real track changes, then restores the saved gap on cancellation', () => {
    const b = mount()
    const capture = vi.spyOn(b.button, 'setPointerCapture')
    const release = vi.spyOn(b.button, 'releasePointerCapture')
    vi.spyOn(b.button, 'hasPointerCapture').mockReturnValue(true)
    const savedTrack = b.divider.style.getPropertyValue('--attention-gap-row')
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    expect(b.divider.dataset.attentionIndex).toBe('2')
    expect(b.divider.style.getPropertyValue('--attention-gap-row')).toBe('3')
    for (let i = 0; i < 4; i++) pointer(window, 'pointermove', 150, 202)
    expect(b.divider.dataset.attentionIndex).toBe('2')
    expect(screen.getByRole('button', { name: /关注分界线/ })).toBe(b.button)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    pointer(window, 'pointercancel')
    expect(release).toHaveBeenCalledTimes(1)
    expect(b.divider.style.getPropertyValue('--attention-gap-row')).toBe(savedTrack)
    expect(b.divider.dataset.attentionIndex).toBe('1')
    expect(b.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('b'))
    expect(b.open).toHaveBeenCalledExactlyOnceWith('b')
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
    pointer(window, 'pointermove', 150, 180)
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
    pointer(window, 'pointermove', 150, 202)
    expect(b.commit).not.toHaveBeenCalled()
    pointer(window, 'pointerup', 150, 202)
    pointer(window, 'pointerup', 150, 202)
    expect(b.commit).toHaveBeenCalledExactlyOnceWith({ timestamp: 100, id: 'c', side: 'before' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape'])('%s cancels without persisting', (kind) => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    expect(b.divider.dataset.attentionIndex).toBe('2')
    if (kind === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else pointer(kind === 'lostpointercapture' ? b.button : window, kind)
    pointer(window, 'pointerup', 150, 202)
    expect(b.commit).not.toHaveBeenCalled()
    expect(b.divider.dataset.attentionIndex).toBe('1')
    expect(b.divider.style.getPropertyValue('--attention-gap-row')).toBe('2')
    expect([...b.list.querySelectorAll<HTMLElement>('[data-attention-row]')].map(row => row.style.getPropertyValue('--attention-row'))).toEqual(['1', '3', '4'])
    fireEvent.click(b.button)
    expect(b.open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('b'))
    expect(b.open).toHaveBeenCalledExactlyOnceWith('b')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores other fingers and rejects a release outside the list', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202, 2)
    pointer(window, 'pointerup', 150, 202, 2)
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    pointer(window, 'pointermove', 150, 202)
    pointer(window, 'pointerup', 400, 202)
    expect(b.commit).not.toHaveBeenCalled()
  })
  it.each([
    { side: 'before', y: 202, index: '4' },
    { side: 'after', y: 240, index: '5' },
  ] as const)('retains a held drag through append-only paging and commits $side a new-page Session', ({ side, y, index }) => {
    const b = mount(200, true)
    const capture = vi.spyOn(b.button, 'setPointerCapture')
    const release = vi.spyOn(b.button, 'releasePointerCapture')
    vi.spyOn(b.button, 'hasPointerCapture').mockReturnValue(true)
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 245)
    act(() => vi.advanceTimersByTime(32))
    expect(b.list.scrollTop).toBeGreaterThan(0)
    const preview = b.divider.dataset.attentionBoundary
    b.view.rerender(b.content([...rows.map(row => ({ ...row })), { id: 'd', updatedAt: 50 }, { id: 'e', updatedAt: 25 }]))
    b.measureRows()
    expect(screen.getByRole('button', { name: /关注分界线/ })).toBe(b.button)
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    expect(b.divider.dataset.attentionBoundary).toBe(preview)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    b.list.scrollTop = 64
    pointer(window, 'pointermove', 150, y)
    expect(b.divider.dataset.attentionIndex).toBe(index)
    pointer(window, 'pointerup', 150, y)
    expect(b.commit).toHaveBeenCalledExactlyOnceWith({ timestamp: 25, id: 'e', side })
    expect(release).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains the pending hold deadline when an older page is appended', () => {
    const b = mount(200, true)
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(449))
    b.view.rerender(b.content([...rows, { id: 'd', updatedAt: 50 }]))
    b.measureRows()
    act(() => vi.advanceTimersByTime(1))
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    pointer(window, 'pointercancel')
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    { kind: 'reorder', items: [rows[1]!, rows[0]!, rows[2]!] },
    { kind: 'timestamp update without reorder', items: [{ ...rows[0]!, updatedAt: 301 }, ...rows.slice(1)] },
    { kind: 'deletion', items: rows.slice(0, 2) },
    { kind: 'insertion within prefix', items: [rows[0]!, { id: 'x', updatedAt: 250 }, ...rows.slice(1)] },
  ])('cancels a held gesture on $kind rather than accepting a changed prefix', ({ items }) => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    b.view.rerender(b.content(items))
    expect(b.button.getAttribute('aria-pressed')).toBe('false')
    pointer(window, 'pointerup', 150, 202)
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('protects an appended page as part of the prefix and cancels if that page is removed', () => {
    const b = mount(200, true)
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    b.view.rerender(b.content([...rows, { id: 'd', updatedAt: 50 }]))
    expect(b.button.getAttribute('aria-pressed')).toBe('true')
    b.view.rerender(b.content(rows))
    expect(b.button.getAttribute('aria-pressed')).toBe('false')
    pointer(window, 'pointerup', 150, 202)
    expect(b.commit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('new activity while dragging cancels the old geometry', () => {
    const b = mount()
    pointer(b.button, 'pointerdown')
    act(() => vi.advanceTimersByTime(450))
    pointer(window, 'pointermove', 150, 202)
    b.view.rerender(b.content([{ id: 'b', updatedAt: 400 }, rows[0]!, rows[2]!]))
    pointer(window, 'pointerup', 150, 202)
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
  it('keeps accessible names without a visible attention label', () => {
    const loaded = mount()
    expect(loaded.button.getAttribute('aria-label')).toMatch(/^关注分界线/)
    expect(screen.queryByText('↑ 关注 · 可忽略 ↓')).toBeNull()
    expect(screen.queryByText('分界在更早历史 ↓')).toBeNull()
    loaded.view.unmount()
    const paged = mount(10, true)
    expect(paged.button.title).toContain('更早历史')
    expect(screen.queryByText('分界在更早历史 ↓')).toBeNull()
    expect(paged.button.textContent).toBe('⋮⋮')
  })
  it('supports explicit keyboard gap movement and suppresses handle clicks', () => {
    const b = mount()
    const click = vi.fn()
    b.list.addEventListener('click', click)
    fireEvent.click(b.button)
    fireEvent.contextMenu(b.button)
    fireEvent.keyDown(b.button, { key: 'a' })
    expect(click).not.toHaveBeenCalled()
    fireEvent.keyDown(b.button, { key: 'ArrowDown' })
    expect(b.commit).toHaveBeenLastCalledWith({ timestamp: 100, id: 'c', side: 'before' })
    fireEvent.keyDown(b.button, { key: 'Home' })
    expect(b.commit).toHaveBeenLastCalledWith(1000)
    fireEvent.keyDown(b.button, { key: 'End' })
    expect(b.commit).toHaveBeenLastCalledWith({ timestamp: 100, id: 'c', side: 'after' })
  })
})
