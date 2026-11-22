# Agent Note: Opening a cold follow from a stored suffix

Status: implemented

English | [中文](2026-11-22-cold-follow-opens-from-a-stored-suffix.zh.md)

## Problem

Opening a cold Session in the Web UI waited for the whole stored log. `SessionHistoryController.follow` called `observeSession`, which decoded every Zstandard frame, cloned the events, prepared an unpublished Session, and hydrated projections before the first snapshot frame left the Host. The opening page shows only the newest 50 messages, but its latency grew with the whole log: on a 3,000-turn, 18,000-event log the opening observation took about 270 ms of mostly synchronous work on the Host event loop, and other clients' requests queued behind it.

## Decision

The opening page is served from a stored suffix, and the full observation runs after it.

`SessionPersistence` gains an optional `readTail(id, { sufficient })`. The JSONL backend decodes the header frame and then the newest complete event frames, doubling the frame count backward until the predicate accepts the suffix, and checks that the decoded seqs are contiguous. A memoized full read at the same revision serves the suffix without decoding. Anything it cannot serve exactly (an uncompressed root, a pending session, a historical generation, a forked log, a torn final frame, or a decode failure) returns `undefined`.

`SessionProjectionCache` gains `suffixFloor`, the lowest usable checkpoint-row watermark, and `restoreSuffix`, which folds the cached rows over a suffix starting at or below that floor through the registry's existing `restore`. `SessionObservationReader.readTail`, exposed as `SessionQueryEngine.observeSessionTail`, combines the two. It requires the suffix to reach the floor and to contain a turn boundary, rejects logs that would need interrupted-turn closers, and declines live, already-prepared, and forked Sessions, as well as a floor at the log start.

`follow` for an ordinary Session asks for a suffix that contains a complete opening page. When one arrives, it yields the snapshot from the suffix, then runs the existing full observation. Events committed between the two reads are queued ahead of any buffered live event, and the existing continuity loop drops duplicates. The full observation still promotes the Session. Any suffix failure falls back to the full observation, which reports the authoritative error.

Concurrent cold reads of one persistence instance and revision share one in-flight load, so a suffix opening followed by other readers of the same Session does not decode the log twice.

## Alternatives considered

**Paginate inside persistence.** A message-aware read in the backend would duplicate message-group and surface rules that the history controller owns. The predicate keeps the backend ignorant of page semantics.

**Serve the opening without projections.** Projection values such as the model selection and list metadata are part of the snapshot frame. Omitting them would make the opening visibly incomplete until the full observation arrived, so the suffix is accepted only when the projection cache can restore exact values at its end.

**Skip the full observation after a suffix opening.** Promotion, header compatibility, and full-log validation all depend on the full observation, so it still runs; only its position relative to the first frame changes.

## Consequences

On the 3,000-turn log the first snapshot is ready about 7 ms after the request instead of about 270 ms, and on a 300-turn log about 5 ms instead of about 40 ms. Total Host work for an opening is unchanged or slightly higher, because the suffix decode precedes the full observation.

A suffix opening does not validate the committed region before the suffix. The full observation that follows performs that validation and fails the follow if it disagrees, for example when the log ends below the suffix cursor. Sessions without a usable projection-cache record, forked Sessions, interrupted logs, and uncompressed roots keep the full-read opening.

Verification: `packages/session/session-persistence-jsonl/tests/tail.spec.ts`, the suffix cases in `packages/session/session-projection-cache/tests/cache.spec.ts`, the suffix and in-flight cases in `packages/session-query/session-query/tests/observation.spec.ts`, and `SessionHistoryController cold suffix opening` in `packages/api/session-controller/tests/transport.host.spec.ts`.
