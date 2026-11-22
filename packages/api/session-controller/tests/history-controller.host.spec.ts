import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type { SessionObservation, SessionTailObservation } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paginate, paginateSuffix } from '../src/history.ts'
import { HistoryController } from '../src/history/controller.ts'
import { WebController } from '../src/web/controller.ts'
import { installSessionReadTestServices } from './test-remote.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const roots: Context[] = []
const aborters: AbortController[] = []
afterEach(async () => {
  for (const abort of aborters.splice(0)) abort.abort()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})
async function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await installSessionReadTestServices(ctx)
  const history = new HistoryController(ctx)
  const web = new WebController(ctx, history, (observation) => { observation[Symbol.dispose]() })
  const session = ctx.sessions.create(brandString<SessionId>('history-target'), { meta: { cwd: '/history-test' } })
  const abort = new AbortController()
  aborters.push(abort)
  const address = { kind: 'session' as const, sessionId: session.id }
  return { ctx, history, web, session, abort, address }
}

/** Append `turns` completed turns, each with one user and one assistant message. */
function conversation(session: Session, turns: number): SessionEvent[] {
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createMessage({
      role: 'user', content: [{ type: 'text', text: `ask ${String(turn)}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: `answer ${String(turn)}` }], source: { kind: 'model', provider: 'p', model: 'm' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return [...session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(session.seq))]
}

/**
 * Serve the fixture Session as if it were cold: a stored suffix from
 * `observeSessionTail` and a prepared full observation from `observeSession`.
 */
async function coldReads(
  f: Awaited<ReturnType<typeof fixture>>,
  events: readonly SessionEvent[],
  suffix: readonly SessionEvent[] = events,
  options: { readonly fullCursor?: SessionSeqCursor } = {},
) {
  const live = await f.ctx.sessionQuery.observeSession(f.session.id)
  const projections = live.projections as ProjectionSnapshot
  live[Symbol.dispose]()
  const tail: SessionTailObservation = {
    header: f.session.header,
    inheritedEventCount: SessionLogOffset(0),
    events: suffix,
    cursor: SessionSeq(f.session.seq - 1),
    revision: brandString<SessionPersistenceRevision>('r1'),
    projections,
  }
  const retained = { source: 'prepared' } as unknown as SessionObservation
  const prepared = {
    source: 'prepared',
    header: f.session.header,
    inheritedEventCount: SessionLogOffset(0),
    events,
    cursor: options.fullCursor ?? tail.cursor,
    projections,
    retain: () => retained,
    [Symbol.dispose]: vi.fn(),
  } as unknown as SessionObservation
  const observeTail = vi.spyOn(f.ctx.sessionQuery, 'observeSessionTail').mockResolvedValue(tail)
  const observe = vi.spyOn(f.ctx.sessionQuery, 'observeSession').mockResolvedValue(prepared)
  return { tail, prepared, retained, observeTail, observe }
}

describe('HistoryController passive reads', () => {
  it('subscribes without reading an Observation and emits later durable events', async () => {
    const f = await fixture()
    const observe = vi.spyOn(f.ctx.sessionQuery, 'observeSession')
    const stream = f.history.observeEvent({ address: f.address }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({ done: false, value: { type: 'ready' } })
    expect(observe).not.toHaveBeenCalled()
    f.session.append('turn/start', { turn: 1 })
    expect(await stream.next()).toMatchObject({ value: { type: 'event', event: { seq: 0 } } })
    f.abort.abort()
    expect(await stream.next()).toMatchObject({ done: true })
  })

  it('subscribes to per-event projection changes without an Observation', async () => {
    const f = await fixture()
    const observe = vi.spyOn(f.ctx.sessionQuery, 'observeSession')
    let receive: Parameters<typeof f.ctx.sessionProjections.onEventChanged>[0] | undefined
    const dispose = vi.fn()
    vi.spyOn(f.ctx.sessionProjections, 'onEventChanged').mockImplementation((callback) => {
      receive = callback
      return dispose
    })
    const stream = f.history.observeProjections({ sessionId: f.session.id }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { type: 'ready' } })
    receive?.(f.session, [{ key: 'title', val: 'new title' }, { key: 'goal', val: null }], SessionSeq(0))
    expect(await stream.next()).toEqual({
      done: false,
      value: { type: 'projection', seq: 0, changes: [{ key: 'title', val: 'new title' }, { key: 'goal', val: null }] },
    })
    expect(observe).not.toHaveBeenCalled()
    f.abort.abort()
    expect(await stream.next()).toMatchObject({ done: true })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('reads newest assistant messages within the exclusive/inclusive interval and detects actual truncation', async () => {
    const f = await fixture()
    f.session.append('turn/start', { turn: 1 })
    const first = f.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'first' }], source: { kind: 'model', provider: 'p', model: 'm' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    const second = f.session.append('assistant/message', {
      turn: 1, step: 2,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'second' }], source: { kind: 'model', provider: 'p', model: 'm' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const observe = vi.spyOn(f.ctx.sessionQuery, 'observeSession')
    const all = await f.history.assistantOutput(f.session.id, -1, 3, 2, f.abort.signal)
    expect(all.records.map(record => record.event.seq)).toEqual([second.seq, first.seq])
    expect(all.truncated).toBe(false)
    const limited = await f.history.assistantOutput(f.session.id, -1, 3, 1, f.abort.signal)
    expect(limited.records.map(record => record.event.seq)).toEqual([second.seq])
    expect(limited.truncated).toBe(true)
    const interval = await f.history.assistantOutput(f.session.id, first.seq, second.seq, 2, f.abort.signal)
    expect(interval.records.map(record => record.event.seq)).toEqual([second.seq])
    expect(observe).toHaveBeenCalledWith(f.session.id, { signal: f.abort.signal, projectionMode: 'none' })
    await expect(f.history.assistantOutput(f.session.id, -1, 9, 2, f.abort.signal)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('reads at the observed log end when throughSeq is omitted', async () => {
    const f = await fixture()
    f.session.append('turn/start', { turn: 1 })
    f.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'latest' }], source: { kind: 'model', provider: 'p', model: 'm' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    const page = await f.history.events({ address: f.address }, f.abort.signal)
    expect(page.cursor).toBe(f.session.seq - 1)
    expect(page.records.at(-1)?.event.seq).toBe(f.session.seq - 1)
  })

  it('keeps the append copy a model-facing replacement shadowed', async () => {
    const f = await fixture()
    f.session.append('turn/start', { turn: 1 })
    const replaced = f.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'visible' }], source: { kind: 'model', provider: 'p', model: 'm' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    // Compaction rewrites the model-facing surface with a replacement that shadows the original;
    // the human-readable transcript keeps the shadowed append copy.
    const replacement = f.session.append('user/message', createMessage({
      role: 'user', content: [{ type: 'text', text: 'compacted' }], source: { kind: 'user' },
    }), { surfaceOp: { op: 'replace', startSeq: replaced.seq, endSeq: replaced.seq }, sourceEventSeqs: [replaced.seq] })
    const output = await f.history.assistantOutput(f.session.id, -1, replacement.seq, 5, f.abort.signal)
    expect(output.records.map(record => record.event.seq)).toEqual([replaced.seq])
  })

  it('releases the opening Observation when activation has nothing to promote', async () => {
    const f = await fixture()
    const source = await f.ctx.sessionQuery.observeSession(f.session.id)
    const dispose = vi.fn(() => { source[Symbol.dispose]() })
    vi.spyOn(f.ctx.sessionQuery, 'observeSession').mockResolvedValue({ ...source, [Symbol.dispose]: dispose })
    const stream = f.web.follow({ address: f.address, activate: true }, f.abort.signal)[Symbol.asyncIterator]()
    await stream.next()
    f.abort.abort()
    await stream.next()
    expect(dispose).toHaveBeenCalled()
  })

  it('releases an acquired Observation when caller cancellation wins its return', async () => {
    const f = await fixture()
    const source = await f.ctx.sessionQuery.observeSession(f.session.id)
    const dispose = vi.fn(() => { source[Symbol.dispose]() })
    vi.spyOn(f.ctx.sessionQuery, 'observeSession').mockImplementation(async () => {
      f.abort.abort()
      return { ...source, [Symbol.dispose]: dispose }
    })
    await expect(f.history.usingObservation({ sessionId: f.session.id, projection: false }, f.abort.signal)).rejects.toBeDefined()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('maps a non-Error query cancellation to a cancelled Remote error', async () => {
    const f = await fixture()
    // A cross-realm or opaque source may reject with the code alone; the message falls back.
    vi.spyOn(f.ctx.sessionQuery, 'observeSession').mockRejectedValue({ code: 'SESSION_QUERY_ABORTED' })
    await expect(f.history.events({ address: f.address }, f.abort.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled', message: 'Session read was cancelled',
    })
  })

  it('maps missing subagent Follow reads through the Address error', async () => {
    const f = await fixture()
    const stream = f.web.follow({ address: {
      kind: 'subagent', parentSessionId: f.session.id, childSessionId: brandString<SessionId>('missing-child'), mode: 'continuable',
    } }, f.abort.signal)[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toMatchObject({ code: 'subagent/not-found' })
  })

  it('cuts the same page from any suffix that reaches the whole-log cut', async () => {
    const f = await fixture()
    const events = conversation(f.session, 4)
    const windows = [undefined, { minMessages: 1, minTurns: 1 }, { minMessages: 3, minTurns: 2 }]
    for (const turnWindow of windows) {
      for (const maxMessages of [1, 2, 3, 5, 9]) {
        const whole = paginate(events, undefined, maxMessages, SessionSeq(events.length - 1), turnWindow)
        for (let start = 0; start < events.length; start++) {
          const suffix = paginateSuffix(events.slice(start), maxMessages, turnWindow)
          const reachable = start === 0 || (whole.hasMore && (whole.events[0] as SessionEvent).seq >= start)
          expect(suffix).toEqual(reachable ? whole : undefined)
        }
      }
    }
    expect(paginateSuffix([], 1)).toEqual({ events: [], hasMore: false })
    const grouped = { ...events.at(-2), sourceEventSeqs: [SessionSeq(1)] } as SessionEvent
    const withGroup = [...events.slice(0, -2), grouped, events.at(-1) as SessionEvent]
    expect(paginate(withGroup, undefined, 1, SessionSeq(withGroup.length - 1)).events[0]?.seq).toBe(1)
    expect(paginateSuffix(withGroup.slice(2), 1)).toBeUndefined()
  })

  it('opens a cold Session from its stored suffix and activates from the full observation', async () => {
    const f = await fixture()
    const events = conversation(f.session, 3)
    const { tail, prepared, retained, observeTail, observe } = await coldReads(f, events, events.slice(events.length - 4))
    const promote = vi.fn()
    const web = new WebController(f.ctx, f.history, promote)
    const stream = web.follow({ address: f.address, activate: true, maxMessages: 2 }, f.abort.signal)[Symbol.asyncIterator]()
    const opening = await stream.next()
    expect(opening.value).toEqual({
      type: 'snapshot',
      header: { ...tail.header },
      projections: { asOfSeq: tail.projections?.asOfSeq, values: tail.projections?.values },
      cursor: tail.cursor,
      records: events.slice(events.length - 3).map(event => ({ type: 'event', event })),
      hasMore: true,
    })
    expect(observeTail).toHaveBeenCalledWith(f.session.id, expect.objectContaining({ signal: f.abort.signal }))
    const { sufficient } = observeTail.mock.calls[0]?.[1] ?? { sufficient: () => false }
    expect(sufficient(events.slice(events.length - 2))).toBe(false)
    expect(sufficient(events.slice(events.length - 3))).toBe(true)
    expect(observe).toHaveBeenCalledWith(f.session.id, { signal: f.abort.signal, projectionMode: 'all' })
    const pending = stream.next()
    await vi.waitFor(() => { expect(promote).toHaveBeenCalledWith(retained) })
    expect(prepared[Symbol.dispose]).toHaveBeenCalledOnce()
    f.abort.abort()
    expect(await pending).toMatchObject({ done: true })
  })

  it('keeps a passive suffix opening off the full observation', async () => {
    const f = await fixture()
    const events = conversation(f.session, 2)
    const { observe } = await coldReads(f, events)
    const stream = f.web.follow({ address: f.address, maxMessages: 1 }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { type: 'snapshot', cursor: events.length - 1, hasMore: true } })
    const pending = stream.next()
    f.abort.abort()
    expect(await pending).toMatchObject({ done: true })
    expect(observe).not.toHaveBeenCalled()
  })

  it('activates after a suffix opening even when the consumer stops at the snapshot', async () => {
    const f = await fixture()
    const events = conversation(f.session, 2)
    const { retained } = await coldReads(f, events)
    const promote = vi.fn()
    const web = new WebController(f.ctx, f.history, promote)
    const stream = web.follow({ address: f.address, activate: true, maxMessages: 1 }, f.abort.signal)[Symbol.asyncIterator]()
    await stream.next()
    await stream.return?.()
    await vi.waitFor(() => { expect(promote).toHaveBeenCalledWith(retained) })
  })

  it('fails the follow after a suffix opening when the full log no longer reaches it', async () => {
    const f = await fixture()
    const events = conversation(f.session, 2)
    await coldReads(f, events, events, { fullCursor: SessionSeq(events.length - 2) })
    const stream = f.web.follow({ address: f.address, activate: true, maxMessages: 1 }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { type: 'snapshot' } })
    await expect(stream.next()).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('falls back to the full observation when the suffix cannot serve the opening', async () => {
    const f = await fixture()
    const events = conversation(f.session, 2)
    const { tail, observeTail, observe } = await coldReads(f, events)
    const tails = [
      undefined,
      { ...tail, header: { ...tail.header, cwd: undefined } },
      { ...tail, header: { ...tail.header, origin: 'subagent' as const } },
      { ...tail, projections: undefined },
      { ...tail, events: events.slice(events.length - 1) },
    ]
    for (const candidate of tails) {
      observeTail.mockResolvedValueOnce(candidate as never)
      const stream = f.web.follow({ address: f.address, maxMessages: 1 }, f.abort.signal)[Symbol.asyncIterator]()
      expect(await stream.next()).toMatchObject({ value: { type: 'snapshot', cursor: events.length - 1 } })
      await stream.return?.()
    }
    const debug = vi.spyOn(f.ctx.logger, 'debug')
    observeTail.mockRejectedValueOnce(new Error('frame checksum'))
    const stream = f.web.follow({ address: f.address, maxMessages: 1 }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { type: 'snapshot' } })
    await stream.return?.()
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('fell back to a full read: Error: frame checksum'))
    expect(observe).toHaveBeenCalledTimes(tails.length + 1)
  })

  it('propagates cancellation during the suffix read', async () => {
    const f = await fixture()
    const observeTail = vi.spyOn(f.ctx.sessionQuery, 'observeSessionTail').mockImplementation(() => {
      f.abort.abort()
      return Promise.reject(new Error('aborted read'))
    })
    const stream = f.web.follow({ address: f.address }, f.abort.signal)[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toBeDefined()
    expect(observeTail).toHaveBeenCalledOnce()
  })

  it('does not promote a live Session when activation was requested', async () => {
    const f = await fixture()
    const promote = vi.fn()
    const web = new WebController(f.ctx, f.history, promote)
    const stream = web.follow({ address: f.address, activate: true }, f.abort.signal)[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { type: 'snapshot' } })
    const pending = stream.next()
    f.abort.abort()
    expect(await pending).toMatchObject({ done: true })
    expect(promote).not.toHaveBeenCalled()
  })
})
