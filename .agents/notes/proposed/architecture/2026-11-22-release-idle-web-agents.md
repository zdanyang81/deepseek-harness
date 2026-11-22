# Agent Note: Release idle Web Agents

Status: proposed

English | [中文](2026-11-22-release-idle-web-agents.zh.md)

## Problem

`ApiSessionAgentController` keeps only `.agent` from `ctx.agents.resume()` and `ctx.agents.create()` and drops the returned disposer. `SessionController.promote` resumes every Session a Web client follows. A Web Host therefore keeps every Agent it has ever opened, with its Session event array, projections, listeners, and plugin state, until the Host context is disposed.

On one long-running production Web Host, the process held 69 Session locks after 21 hours. Those logs decode to about 150 MB of JSON. The process ran with `--max-old-space-size=1024` at about 900 MB resident and had about 535 MB swapped out. Page requests stalled on major GC and swap-in page faults. Raising the heap limit postpones that state, and periodic restarts interrupt running turns. Neither bounds residency.

Releasing an Agent is not just a cache eviction. Several plugins tie work to the live Agent: `schedule` registers wake-ups under `agent.ctx`, `goal-round-driver` keeps per-Agent round state until `agent/disposed`, subagent continuations and background children are owned by the parent Agent, and `jobs` performs owner cleanup when the owner Agent is disposed. Disposing an Agent that owns such work stops schedules, abandons goals, and cancels jobs.

## Proposal

The session controller keeps the disposer for each Agent it creates or resumes and releases an Agent when all of the following hold for a configured idle duration:

- `agent.status` is `idle` and its inbox and queue are empty;
- no `follow` stream or `control` subscriber references the Session;
- no plugin holds a residency lease on the Agent.

### Residency leases

`AgentRegistry` gains `retain(agent, reason): () => void`. A lease is an effect-registered disposer, so a plugin that unloads drops its leases. The registry exposes `isRetained(agent)` and emits `agent/residency` when the lease count crosses zero. These plugins take leases:

- `schedule`, while the Agent has a pending schedule entry;
- `goal-round-driver`, while a goal is active;
- subagent continuation, while a child Activation or Task is non-terminal;
- `jobs`, while the Agent owns a non-terminal job.

A plugin that owns Agent-scoped background work but takes no lease loses that work on release, so a deployment that loads such a plugin leaves release disabled. The proposal does not add a default lease for unknown plugins, because that would make release a no-op wherever any plugin loads.

### Configuration

`SessionController.Config` gains `idleReleaseMs`, a duration with no default. A Web profile sets it in `cordis.yml`, for example `idleReleaseMs: 900000`. When it is absent, the controller keeps every Agent, as it does now. Release calls the retained disposer, which stops the loop, awaits its exit, and unregisters the Agent. The next `follow` or command cold-resumes the Session through the existing path.

## Alternatives considered

**Raise the heap limit and restart the Host on a schedule.** This is the operational stopgap. It interrupts running turns and still lets residency grow without bound between restarts.

**Cap live Agents with an LRU and release the least recently used.** A count cap ignores ownership: the least recently viewed Agent can be the one running a schedule or a background job. Leases are still required, and with leases an idle timer releases the same Agents without choosing an arbitrary count.

**Keep Agents resident and shrink their in-memory Session.** Dropping event history from a live Session breaks projections, compaction, fork, and inspection, which read the complete log. Release with cold resume keeps one authoritative source.

**Treat any registered `agent.ctx` effect as a lease.** Every Agent composition registers tools and listeners under `agent.ctx`, so no Agent would ever be released.

## Acceptance criteria

- With `idleReleaseMs` set, an idle Agent that has no subscribers and no leases emits `agent/disposed` after the duration, and its Session lock is released.
- A pending schedule, an active goal, a non-terminal subagent child, and a non-terminal job each prevent release; when that work settles, the Agent is released after the next idle duration.
- A `follow` or prompt that arrives after release cold-resumes the Session, and the resulting history matches the history before release.
- A `follow` or prompt that arrives while release is draining waits for the drain and then resumes; it never attaches to a disposing Agent.
- With `idleReleaseMs` absent, behavior is unchanged.
- A REAL-composition Web profile test boots through the Loader and asserts release and resume through the Remote API.

## Risks

A plugin that owns Agent-scoped work and does not take a lease loses that work when release fires. Enabling release in a profile therefore requires auditing that profile's plugins, including external plugins loaded by patch layers.

Cold resume after release costs a full observation. A [suffix opening](../../implemented/architecture/2026-11-22-cold-follow-opens-from-a-stored-suffix.md) serves the first snapshot quickly, but the full observation still runs before promotion.

The release timer adds a disposal path that races with `resolveAgent`, `ensureSession`, and `promote`. The controller must serialize release with resume per Session id, under the same rule that already deduplicates concurrent resumes.
