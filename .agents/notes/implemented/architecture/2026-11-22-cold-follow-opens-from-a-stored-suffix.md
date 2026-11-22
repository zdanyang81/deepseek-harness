# Agent Note: Cold follow opens from a stored suffix

Status: implemented

English | [中文](2026-11-22-cold-follow-opens-from-a-stored-suffix.zh.md)

## Problem

Opening a cold Session in `dsh web` builds its first snapshot from a full observation: the JSONL backend decodes every Zstandard frame, the Session store validates and prepares the whole log, and the projection cache folds it, all before the opening page is sent. On a generated 3000-Turn Session (18005 events, 2 MB compressed, 21 MB plaintext), the Host spent about 360 ms of CPU before the first frame, and the Chat's first rows appeared a median of 588 ms after the click, against about 300 ms for a 300-Turn Session. The opening page itself needs only the newest few hundred messages.

## Decision

A follow of a cold ordinary Session opens from a stored suffix and runs the full observation afterwards.

- `SessionPersistence.readTail?` is an optional backend method that returns a validated suffix ending at the last stored event, widening backward until a caller predicate accepts it. The JSONL backend serves current-generation Zstandard logs: it decodes the header frame and then doubling runs of the newest frames, and decodes each row with `decodeReleasedV4Row`, the released V4 row admission and framing without cross-row seq state. Torn, seeded, historical, damaged, or non-contiguous logs return `undefined`.
- `SessionProjectionCache.suffixFloor` and `restoreSuffix` fold that suffix over the cached checkpoint rows to exact projection values at the log end.
- `sessionQuery.observeSessionTail` combines them. It requires the suffix to reach the cache floor and contain a turn boundary, and it returns `undefined` for live, already prepared, forked, or interrupted-turn Sessions.
- `WebController.follow` asks for the suffix with the opening page as the predicate (`paginateSuffix` returns the same cut `paginate` takes from the whole log, or `undefined` when that cut lies below the suffix). A requested activation starts the full observation before the opening is delivered and promotes it as before; the event listener emits events committed after the suffix cursor when the promoted Session is created. Concurrent cold reads of one revision share one in-flight load, so a history page requested right after the opening joins the activation's read.

## Alternatives considered

**Keep a persisted page cache beside the log.** A separate opening-page artifact would make the first frame independent of log size, but it is a second durable source of model-visible history that must agree with the log after every append, repair, and migration. A suffix read stays a view of the log itself.

**Speed up the full read.** Decoding and JSON parsing cost about 100 ms of the 360 ms; Session preparation, projection folding, and garbage collection take most of the rest and scale with the whole log. A faster full read still makes the first frame wait for work the first frame does not use.

## Consequences

On the same 3000-Turn Session, the Chat's first rows appeared after a median of 409 ms over three cold server starts (376–418 ms), against 588 ms (550–897 ms) before. The gain grows with log size, because the suffix read decodes only the frames the opening page needs. A Turn-rail jump into unloaded history still landed on the requested Turn.

The opening can show a suffix of a log whose earlier region or cross-event relationships a full read would reject. The activation's full observation reports that error after the opening, and a log that shrank below the suffix cursor fails the follow with `gateway/internal`. A passive follow (`activate` omitted) never runs the full read.

Verification: `JSONL readTail` in `packages/session/session-persistence-jsonl/tests/tail.spec.ts`, `SessionObservationReader cold suffix` and `in-flight cold loads` in `packages/session-query/session-query/tests/observation.spec.ts`, and the suffix-opening cases in `packages/api/session-controller/tests/history-controller.host.spec.ts`.
