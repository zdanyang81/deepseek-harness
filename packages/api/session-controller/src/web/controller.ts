/** Web opening aggregation over one observation and a shared transforming buffer. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionObservation, SessionTailObservation } from '@deepseek-ai/dsh-session-query'
import type { HistoryController } from '../history/controller.ts'
import { addressId, pageRecords, paginateSuffix, rejectNotFound } from '../history.ts'
import { EventListener, ListenerBuffer } from '../history/listener.ts'
import { history, projections, resolveHistoryRequest, validateObservationAddress } from '../history/controller.ts'
import type { SessionFollowFrame, SessionFollowRequest, SessionPageRequest } from '../types.ts'

/** Combines opening data and consumes transformed listener output from one queue. */
export class WebController {

  /**
   * @param ctx - Host context carrying Session queries and identity projections.
   * @param historyController - passive reading and listener construction.
   * @param promote - background activation requested before an opening snapshot is delivered.
   */
  constructor(
    private readonly ctx: Context,
    private readonly historyController: HistoryController,
    private readonly promote: (observation: SessionObservation) => void,
  ) {}

  /**
   * Open a history snapshot and follow uncovered history and assistant notifications.
   * A cold ordinary Session whose stored suffix covers the opening page opens
   * from that suffix; its full observation then validates the log and serves
   * the requested activation.
   * @param request - Session identity, page budget, assistant output and optional activation (default false).
   * @param signal - cancellation for opening and streaming.
   * @returns an opening snapshot followed by uncovered queued increments.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const sessionId = addressId(request.address)
    const spec = resolveHistoryRequest(request)
    using queue = new ListenerBuffer<SessionFollowFrame>(this.ctx, signal)
    using listener = new EventListener(this.ctx, sessionId, signal, queue)
    const streams = this.historyController.streamsListener
    using assistantListener = request.assistantStream === true
      ? streams.bind(sessionId, signal, queue)
      : undefined
    const tail = request.address.kind === 'session' ? await this.tailOpening(sessionId, spec, signal) : undefined
    let opening: SessionFollowFrame
    let activation: Promise<void> | undefined
    if (tail === undefined) {
      using observation = await this.historyController.usingObservation({ sessionId, projection: true }, signal)
        .catch((error: unknown) => {
          if (remoteErrorOf(error)?.code === 'session/not-found') rejectNotFound(request.address)
          throw error
        })
      validateObservationAddress(request.address, observation)
      opening = {
        type: 'snapshot',
        header: { ...observation.header },
        projections: projections(observation),
        ...history(observation, spec),
      }
      // Promotion starts before the opening is delivered, so a consumer that
      // stops after the snapshot still gets the activation it asked for.
      if (request.activate === true) this.promoteObservation(observation, signal)
    } else {
      opening = tail
      // The full read starts before the opening is delivered for the same
      // reason; its failure reaches a consumer that keeps following.
      if (request.activate === true) {
        activation = this.activateAfterTail(sessionId, tail.cursor, signal)
        activation.catch(() => {
          // Rejections reach the consumer through the await below; a consumer
          // that stopped after the snapshot has nothing left to report to.
        })
      }
    }
    listener.setCursor(opening.cursor)
    if (assistantListener !== undefined) {
      const { baseline: assistantStream, ordinal } = assistantListener.snapshot()
      opening = { ...opening, assistantStream }
      assistantListener.setOrdinalCut(ordinal)
    }
    yield opening
    await activation
    yield* queue.items()
  }

  /**
   * Build the opening frame from a stored suffix of a cold ordinary Session.
   * Any failure leaves the opening to the full observation, which reports the
   * authoritative not-found, ownership, or corruption error.
   */
  private async tailOpening(
    sessionId: SessionId,
    spec: SessionPageRequest & { readonly maxMessages: number },
    signal: AbortSignal,
  ): Promise<Extract<SessionFollowFrame, { type: 'snapshot' }> | undefined> {
    let tail: SessionTailObservation | undefined
    try {
      tail = await this.ctx.sessionQuery.observeSessionTail(sessionId, {
        signal,
        sufficient: events => paginateSuffix(events, spec.maxMessages, spec.turnWindow) !== undefined,
      })
    } catch (error: unknown) {
      signal.throwIfAborted()
      this.ctx.logger.debug(`session-controller: suffix opening for "${sessionId}" fell back to a full read: ${String(error)}`)
      return undefined
    }
    if (tail === undefined || tail.header.cwd === undefined || tail.header.origin === 'subagent'
      || tail.projections === undefined) return undefined
    const page = paginateSuffix(tail.events, spec.maxMessages, spec.turnWindow)
    if (page === undefined) return undefined
    return {
      type: 'snapshot',
      header: { ...tail.header },
      projections: projections(tail),
      cursor: tail.cursor,
      records: pageRecords(page.events),
      hasMore: page.hasMore,
    }
  }

  /**
   * Observe the whole log behind a suffix opening and activate it.
   * @throws RemoteError `gateway/internal` when the log no longer reaches the opening cursor.
   */
  private async activateAfterTail(sessionId: SessionId, cursor: number, signal: AbortSignal): Promise<void> {
    using observation = await this.historyController.usingObservation({ sessionId, projection: true }, signal)
    if (observation.cursor < cursor) {
      throw new RemoteError('gateway/internal', `session log shrank below its opening suffix seq ${String(cursor)}`, {})
    }
    this.promoteObservation(observation, signal)
  }

  /** Hand a retained lease of a prepared ordinary observation to background activation. */
  private promoteObservation(observation: SessionObservation, signal: AbortSignal): void {
    if (signal.aborted || observation.header.origin === 'subagent' || observation.source !== 'prepared') return
    const promotion = observation.retain()
    try {
      this.promote(promotion)
    } catch (error: unknown) {
      promotion[Symbol.dispose]()
      throw error
    }
  }
}
