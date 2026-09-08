# Sidebar attention divider with strict timestamp ordering

Status: isolated candidate; not deployed.

## Decision

The office user explicitly selected strict `updatedAt` ordering instead of manually editable session order. The session catalog remains the authoritative data source through `useSessions`; the cutoff is browser viewing state in the registered workspace store, read through `useStore` and written through `actions.setAttentionCutoff`. Sessions with `updatedAt > cutoff` are above the line; remaining sessions are below. New activity reclassifies a session by its new timestamp without a membership list. Equal timestamps stay together and use the existing session-ID tiebreak for display.

The flat view renders one native divider. The grouped view retains workspace ordering and folding, sorts sessions within each group by timestamp, and offers an explicit switch to the flat attention view instead of drawing a misleading global line across independent groups. Search results never display the divider. This partially supersedes the session ordering decision in [Workspace Sidebar Order and Folding](implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md); its Host account and workspace folding decisions remain unchanged. No historical note is archived for this unshipped office candidate.

## Interaction and persistence

Only the 44px handle owns the 450ms pointer hold. Session rows keep their click, menu and hover behavior; session native drag is disabled. Movement before activation, pointer cancellation, capture loss, Escape, window blur, outside release, component disposal and catalog timestamp changes cancel without committing. Edge scrolling operates only on the existing list container, leaving catalog pagination to its existing scroll handler. A moved gesture commits once on pointerup. Keyboard arrows/Home/End provide equivalent explicit cutoff moves.

The cutoff is local to this browser and origin, not synchronized to other devices. Initial or missing legacy cutoff is zero (all loaded sessions need attention). A cutoff before the loaded catalog is preserved with a paging explanation; loading more does not reset it. Code rollback does not delete this viewing state or alter sessions. The complete previous `client-lib` is the rollback unit; only browser JS/map change in the candidate.

## Verification

The baseline native browser build is compared against the production source map and generated JavaScript, preserving all previously deployed paging, scroll, search and first-prompt fixes. Focused tests cover cutoff projection, tied times, persistence, pointer ownership, cancellation and edge scrolling, alongside updated workspace browser behavior tests. A separate isolated browser can route only the candidate JavaScript at the existing 3080 URL; that is candidate verification, not production activation. Activation and original-URL production acceptance remain with the coordinating parent.
