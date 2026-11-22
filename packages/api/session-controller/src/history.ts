/** Shared Session history pagination, address validation and wire conversion. */

import {
  isAppendSurfaceEvent,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  SessionSeqCursor,
} from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionAddress,
  SessionEventEntry,
  SessionHistoryRecord,
  SessionPageRequest,
  SessionWireEvent,
} from './types.ts'

/** Message budget applied when a history request omits `maxMessages`. */
export const DEFAULT_MAX_MESSAGES = 50
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/**
 * Reject an invalid message budget or turn window.
 * @param request - history window fields.
 */
export function validateHistoryWindow(request: Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'>): void {
  if (request.maxMessages !== undefined
    && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    throw new RemoteError('gateway/bad-request', 'maxMessages must be a positive safe integer', {})
  }
  const window = request.turnWindow
  if (window !== undefined) {
    if (!Number.isSafeInteger(window.minMessages) || window.minMessages <= 0
      || window.minMessages > (request.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minMessages must be a positive safe integer no greater than maxMessages', {})
    }
    if (!Number.isSafeInteger(window.minTurns) || window.minTurns <= 0) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minTurns must be a positive safe integer', {})
    }
  }
}

/**
 * Select the Session whose log an address names.
 * @param address - ordinary Session or direct-subagent address.
 * @returns the Session whose log the address reads.
 */
export function addressId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

/**
 * Reject an address that does not match the observed Session.
 * @param address - ordinary Session or direct-subagent address.
 * @param header - observed Session header.
 * @param inheritedEventCount - observed fork-inherited event count.
 * @param projections - observed projections; subagent addresses require them.
 */
export function validateAddress(
  address: SessionAddress,
  header: SessionHeader,
  inheritedEventCount: SessionLogOffsetType,
  projections: SessionObservation['projections'],
): void {
  if (address.kind === 'session') {
    if (header.origin === 'subagent') {
      throw new RemoteError('session/agent-busy', 'subagent Sessions require their durable parent address', {
        reason: 'use subagent delivery for this child session',
      })
    }
    return
  }
  if (header.origin !== 'subagent' || header.parentSession !== address.parentSessionId) {
    throw new RemoteError('subagent/unauthorized', 'subagent does not belong to the supplied parent', {
      childSessionId: address.childSessionId,
    })
  }
  const identity = projections?.values.subagent
  if (identity === null) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is corrupt', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'corrupt',
    })
  }
  if (identity === undefined || identity.seq < inheritedEventCount) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is unavailable', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'unsupported',
    })
  }
  if (address.mode !== 'unknown' && identity.mode !== address.mode) {
    throw new RemoteError('subagent/unauthorized', 'subagent mode does not match the supplied address', {
      childSessionId: address.childSessionId,
    })
  }
}

/**
 * Reject a missing Session using its address-specific error.
 * @param address - ordinary Session or direct-subagent address.
 * @returns never; this operation always throws.
 * @throws RemoteError `session/not-found` or `subagent/not-found`.
 */
export function rejectNotFound(address: SessionAddress): never {
  if (address.kind === 'session') {
    throw new RemoteError('session/not-found', `session "${address.sessionId}" not found`, { sessionId: address.sessionId })
  }
  throw new RemoteError('subagent/not-found', 'subagent is unavailable', {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
  })
}

/**
 * Cut one message-aligned backwards page from a contiguous event prefix.
 * @param events - contiguous events starting at seq 0.
 * @param beforeSeq - exclusive upper offset of an older page.
 * @param maxMessages - message budget.
 * @param throughSeq - inclusive log cut.
 * @param turnWindow - optional turn-boundary stop rule.
 * @returns the page events and whether older events remain.
 */
export function paginate(
  events: readonly SessionEvent[],
  beforeSeq: SessionLogOffsetType | undefined,
  maxMessages: number,
  throughSeq: SessionSeqCursor,
  turnWindow?: SessionPageRequest['turnWindow'],
): { readonly events: SessionEvent[]; readonly hasMore: boolean } {
  const end = SessionLogOffset(Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1))
  const cut = pageCut(events, SessionLogOffset(0), end, maxMessages, turnWindow) as SessionLogOffsetType
  return { events: events.slice(cut, end), hasMore: cut > 0 }
}

/**
 * Cut the newest message-aligned page from a contiguous suffix that ends at the log end.
 * @param events - contiguous events whose first element sits at its own seq.
 * @param maxMessages - message budget.
 * @param turnWindow - optional turn-boundary stop rule.
 * @returns the same page {@link paginate} cuts from the whole log, or
 *   `undefined` when that cut lies below the suffix.
 */
export function paginateSuffix(
  events: readonly SessionEvent[],
  maxMessages: number,
  turnWindow?: SessionPageRequest['turnWindow'],
): { readonly events: SessionEvent[]; readonly hasMore: boolean } | undefined {
  const base = SessionLogOffset(events[0]?.seq ?? 0)
  const cut = pageCut(events, base, SessionLogOffset(base + events.length), maxMessages, turnWindow)
  if (cut === undefined) return undefined
  return { events: events.slice(cut - base), hasMore: cut > 0 }
}

/**
 * Find the first seq of the message-aligned page ending before `end`.
 * @param events - contiguous events whose first element has seq `base`.
 * @param base - seq of `events[0]`.
 * @param end - exclusive page end seq.
 * @param maxMessages - message budget.
 * @param turnWindow - optional turn-boundary stop rule.
 * @returns the cut seq, or `undefined` when it lies below `base`.
 */
function pageCut(
  events: readonly SessionEvent[],
  base: SessionLogOffsetType,
  end: SessionLogOffsetType,
  maxMessages: number,
  turnWindow: SessionPageRequest['turnWindow'],
): SessionLogOffsetType | undefined {
  let count = 0
  let turns = 0
  for (let index = end - 1; index >= base; index--) {
    const event = events[index - base] as SessionEvent
    if (turnWindow !== undefined && event.type === 'turn/start') {
      turns++
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) return SessionLogOffset(index)
    }
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    const sources = event.sourceEventSeqs
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source
      }
    }
    if (count >= maxMessages) return groupStart < base ? undefined : SessionLogOffset(groupStart)
  }
  return base === 0 ? SessionLogOffset(0) : undefined
}

/**
 * Convert a committed event to its wire entry.
 * @param event - committed Session event.
 * @returns the wire event entry.
 */
export function entryFor(event: SessionEvent): SessionEventEntry {
  return {
    type: 'event',
    // Session.append validates and freezes event data as JSON before publication.
    event: event as unknown as SessionWireEvent,
  }
}

/**
 * Encode one bounded logical page without changing its pagination cut.
 * @param events - page events.
 * @returns the wire records.
 */
export function pageRecords(events: readonly SessionEvent[]): SessionHistoryRecord[] {
  return events.map(entryFor)
}
