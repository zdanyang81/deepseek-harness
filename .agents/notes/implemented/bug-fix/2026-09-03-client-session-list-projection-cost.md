# Agent Note: bound session-list transfer and Client projection cost

Status: implemented

English | [中文](2026-09-03-client-session-list-projection-cost.zh.md)

## Problem

The Client Session manager rebuilt every flattened row whenever any field in the combined list snapshot changed. Opening or clearing a Session therefore repeated title lookup, lineage flattening, identity reconciliation, and `ids`/`byId` projection across the complete catalog even though only `current` changed. Cache pruning also searched the complete output once for every cached id, making a structural rebuild quadratic in the Session count.

Metadata-only consumers also received every visible row and every cached projection value, so a small recent-session window paid the complete catalog serialization, transfer, and parse cost.

## Decision

The Session manager tracks row invalidation separately from the combined snapshot. Summary, projection, pending-interaction, and completion changes rebuild rows; selection, subagent catalogs, jobs, and request state reuse the existing row array. Identity reconciliation builds one live-id `Set` and prunes cached rows with indexed membership checks.

`SessionRuntime` keys its base `ids`/`byId` projection by the manager row-array identity. Ordinary selection changes reuse both values. A selected subagent route still derives addressed breadcrumb rows from a shallow copy, so route-only entries never enter the reusable base catalog.

`session.list` preserves the complete projection-bearing response by default. A bounded metadata consumer can request 1 through 1,000 activity-ordered rows with `limit` and omit projection blocks with `includeProjections: false`.

## Alternatives considered

**Split selection into a second public observable.** Rejected because the standard sessions feed intentionally publishes list rows and `current` atomically. Internal invalidation domains remove repeated work without changing that contract.

**Rely only on stable row identities after every rebuild.** Rejected because flattening, field comparison, and cache cleanup would still traverse the complete catalog when no row can have changed.

**Use elapsed-time assertions.** Rejected because machine speed is not a correctness contract. Focused 2,500-row tests instead pin zero row rebuilds for selection-only changes, stable `ids`/`byId` identities, and linearly bounded row-id reads.

## Consequences

Opening and clearing an ordinary Session perform constant catalog-projection work after validation, while real row changes remain linear and preserve existing identities. The implementation carries explicit row-dirty state and retained base projections.

## Related

The existing [session-row identity decision](2026-08-10-session-row-identity-covers-the-preset.md) owns which row fields participate in identity reuse. This decision preserves that guard and changes when reconciliation runs and how its cache is pruned.
