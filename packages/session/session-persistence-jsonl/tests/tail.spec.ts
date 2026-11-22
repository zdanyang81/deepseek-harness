import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath, logPath, sessionDir, toHeaderLine, type JsonlCompression } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'
import { meta, releasedV1OneTurnLog } from '../../session-persistence/tests/contract.ts'

const roots: string[] = []
const contexts: Context[] = []

async function mount(compression: JsonlCompression = 'zstd'): Promise<{ root: string; persistence: SessionPersistence }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-tail-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression })
  return { root, persistence: ctx.sessionPersistence }
}

function record(seq: number): SessionEvent {
  return { type: 'feedback/record', seq: SessionSeq(seq), time: seq + 1, data: { text: `r${String(seq)}` } }
}

/** Persist `batches` single-event appends, so the log holds one frame per event. */
async function writeBatches(persistence: SessionPersistence, header: SessionHeader, batches: number): Promise<void> {
  const handle = await persistence.create(header)
  try {
    for (let seq = 0; seq < batches; seq++) await handle.append([record(seq)])
  } finally {
    await handle.close()
  }
}

async function readAll(persistence: SessionPersistence, id: SessionId): Promise<readonly SessionEvent[]> {
  const handle = await persistence.open(id, 'read')
  try {
    return await handle.read()
  } finally {
    await handle.close()
  }
}

/** Write raw frames: the header frame, then one frame per event-line group. */
async function writeFrames(root: string, header: SessionHeader, groups: readonly (readonly SessionEvent[])[]): Promise<void> {
  const frames = [await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`)]
  for (const group of groups) {
    frames.push(await compressZstdFrame(group.map(event => `${JSON.stringify(event)}\n`).join('')))
  }
  await mkdir(sessionDir(root, header.cwd, header.id), { recursive: true })
  await writeFile(logPath(root, header.cwd, header.id, 'zstd'), Buffer.concat(frames))
}

function seqs(events: readonly SessionEvent[] | undefined): number[] | undefined {
  return events?.map(event => event.seq)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('JSONL readTail', () => {
  it('widens by doubling frame counts until the predicate accepts the suffix', async () => {
    const { persistence } = await mount()
    const header = meta('tail-widen', '/work')
    await writeBatches(persistence, header, 10)
    const offered: number[] = []
    const tail = await persistence.readTail?.(header.id, {
      sufficient: (events) => {
        offered.push(events.length)
        return events.length >= 3
      },
    })
    expect(offered).toEqual([1, 3])
    expect(tail).toMatchObject({ meta: header, inheritedEventCount: 0 })
    expect(seqs(tail?.events)).toEqual([7, 8, 9])
    expect(tail?.revision).toBe((await persistence.stat(header.id))?.revision)
  })

  it('returns the whole log from seq 0 when no suffix suffices', async () => {
    const { persistence } = await mount()
    const header = meta('tail-whole', '/work')
    await writeBatches(persistence, header, 5)
    const tail = await persistence.readTail?.(header.id, { sufficient: () => false })
    expect(seqs(tail?.events)).toEqual([0, 1, 2, 3, 4])
  })

  it('serves a suffix of the memoized full read at the same revision', async () => {
    const { persistence } = await mount()
    const header = meta('tail-memo', '/work')
    await writeBatches(persistence, header, 6)
    expect(await readAll(persistence, header.id)).toHaveLength(6)
    const tail = await persistence.readTail?.(header.id, { sufficient: events => events.length >= 2 })
    expect(seqs(tail?.events)).toEqual([4, 5])
    const whole = await persistence.readTail?.(header.id, { sufficient: () => false })
    expect(seqs(whole?.events)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('leaves forked logs to the full read, decoded or memoized', async () => {
    const { persistence } = await mount()
    const header: SessionHeader = {
      ...meta('tail-seeded', '/work'),
      parentSession: SessionId('tail-parent'),
      isSeeded: true,
      origin: 'subagent',
    }
    const handle = await persistence.create(header, { inheritedEventCount: SessionLogOffset(0) })
    await handle.append([{ type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: { inherited: true } }])
    await handle.close()
    await expect(persistence.readTail?.(header.id, { sufficient: () => true })).resolves.toBeUndefined()
    await readAll(persistence, header.id)
    await expect(persistence.readTail?.(header.id, { sufficient: () => true })).resolves.toBeUndefined()
  })

  it('leaves uncompressed, absent, pending, and historical-version sessions to the full read', async () => {
    const plain = await mount('none')
    const plainHeader = meta('tail-plain', '/work')
    await writeBatches(plain.persistence, plainHeader, 2)
    await expect(plain.persistence.readTail?.(plainHeader.id, { sufficient: () => true })).resolves.toBeUndefined()

    const { root, persistence } = await mount()
    await expect(persistence.readTail?.(SessionId('tail-absent'), { sufficient: () => true })).resolves.toBeUndefined()

    const pending = meta('tail-pending', '/work')
    const handle = await persistence.create(pending)
    await expect(persistence.readTail?.(pending.id, { sufficient: () => true })).resolves.toBeUndefined()
    await handle.close()

    const historical = meta('tail-v0', '/work')
    await mkdir(sessionDir(root, historical.cwd, historical.id), { recursive: true })
    await writeFile(generationLogPath(root, historical.cwd, historical.id, 0, 'zstd'), Buffer.concat([
      await compressZstdFrame(`${JSON.stringify({ type: 'session', version: 0, id: historical.id, createdAt: historical.createdAt, cwd: historical.cwd, delegationDepth: 0 })}\n`),
      await compressZstdFrame(`${releasedV1OneTurnLog().map(event => JSON.stringify(event)).join('\n')}\n`),
    ]))
    await expect(persistence.readTail?.(historical.id, { sufficient: () => true })).resolves.toBeUndefined()
  })

  it('leaves torn, damaged, gapped, and seq-0-less logs to the full read', async () => {
    const { root, persistence } = await mount()
    const torn = meta('tail-torn', '/work')
    await writeBatches(persistence, torn, 2)
    const fragment = await compressZstdFrame(`${JSON.stringify(record(2))}\n`)
    await appendFile(logPath(root, torn.cwd, torn.id, 'zstd'), fragment.subarray(0, fragment.length - 1))
    await expect(persistence.readTail?.(torn.id, { sufficient: () => true })).resolves.toBeUndefined()

    const damaged = meta('tail-damaged', '/work')
    await mkdir(sessionDir(root, damaged.cwd, damaged.id), { recursive: true })
    await writeFile(logPath(root, damaged.cwd, damaged.id, 'zstd'), Buffer.concat([
      await compressZstdFrame('not a header\n'),
      await compressZstdFrame(`${JSON.stringify(record(0))}\n`),
    ]))
    await expect(persistence.readTail?.(damaged.id, { sufficient: () => true })).resolves.toBeUndefined()

    const unterminated = meta('tail-unterminated', '/work')
    await writeFrames(root, unterminated, [[record(0)]])
    await appendFile(
      logPath(root, unterminated.cwd, unterminated.id, 'zstd'),
      await compressZstdFrame(JSON.stringify(record(1))),
    )
    await expect(persistence.readTail?.(unterminated.id, { sufficient: () => true })).resolves.toBeUndefined()

    const gapped = meta('tail-gapped', '/work')
    await writeFrames(root, gapped, [[record(0), record(1)], [record(5)]])
    await expect(persistence.readTail?.(gapped.id, { sufficient: () => false })).resolves.toBeUndefined()

    const offset = meta('tail-offset', '/work')
    await writeFrames(root, offset, [[record(3)], [record(4)]])
    await expect(persistence.readTail?.(offset.id, { sufficient: () => false })).resolves.toBeUndefined()

    const headerOnly = meta('tail-header-only', '/work')
    await writeFrames(root, headerOnly, [])
    await expect(persistence.readTail?.(headerOnly.id, { sufficient: () => false }))
      .resolves.toMatchObject({ events: [] })
  })

  it('skips the predicate for an empty newest frame and keeps widening', async () => {
    const { root, persistence } = await mount()
    const header = meta('tail-empty-frame', '/work')
    await writeFrames(root, header, [[record(0)], [record(1)], []])
    const offered: number[] = []
    const tail = await persistence.readTail?.(header.id, {
      sufficient: (events) => {
        offered.push(events.length)
        return true
      },
    })
    expect(offered).toEqual([2])
    expect(seqs(tail?.events)).toEqual([0, 1])
  })

  it('propagates cancellation instead of falling back', async () => {
    const { persistence } = await mount()
    const header = meta('tail-abort', '/work')
    await writeBatches(persistence, header, 4)
    const abort = new AbortController()
    const read = persistence.readTail?.(header.id, {
      signal: abort.signal,
      sufficient: () => {
        abort.abort()
        return false
      },
    })
    await expect(read).rejects.toThrow()
    await expect(persistence.readTail?.(header.id, { signal: AbortSignal.abort(), sufficient: () => true }))
      .rejects.toThrow()
  })
})
