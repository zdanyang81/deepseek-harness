# Agent Note: Sidebar attention handle alignment

Status: implemented

English | [中文](2026-09-09-sidebar-attention-handle-alignment.zh.md)

## Problem

The gray attention divider already occupies a reserved 32px track and accepts a 450ms hold before it moves. Its visible “↑ 关注 · 可忽略 ↓” caption and the later-history caption competed with Session titles, and the 44×24 centered handle sat in the middle of the row instead of the Session time column.

## Decision

The divider still owns one 32px CSS Grid track and the same hold, drag, cancel, keyboard, and browser-local cutoff rules. It no longer renders a visible caption. The handle is a 28×20 button. Its right edge shares the Session time column's 8px inset because `.time` has no fixed column width: the divider uses `.sessionRow`'s `padding: 0 8px` as `margin-inline: 8px` and `justify-content: flex-end`. Accessible meaning stays on the handle `aria-label` and `title`, including the beyond-page paging explanation. This is a presentation change to the office attention divider; it does not restore Manual session order and does not change [Workspace Sidebar Order and Folding](2026-08-11-workspace-sidebar-order-and-folding.md) Host workspace order.

## Alternatives considered

**Keep the visible caption and only shrink the handle.** Rejected because the requested product copy is a line with no 关注/可忽略 text; a smaller handle next to the same caption would still occupy the time column.

**Absolutely position the handle with a hardcoded right offset.** Rejected because the time column’s right edge is already the shared 8px row inset; a magic pixel offset would drift when list padding or scrollbar variables change.

**Move the explanation into a second visible control.** Rejected because the handle already owns the hold target, keyboard focus, and accessible name; a second control would add a click target inside the reserved track.

**Center the handle on every timestamp string.** Rejected because `.time` is content-sized; only the shared 8px right inset is stable across `12:03` and `昨天`. Right-edge alignment within ±1px is the geometry that can be verified.

**Use a 24×18 handle.** Rejected as the primary size because a touch long-press target that small is easy to miss; 28×20 still stays under the old 44×24 box.

## Consequences

Sighted users infer the cutoff from the gray line and the 28×20 handle on the time column's right edge. Screen-reader and tooltip users still hear the attention meaning. Beyond-page cutoffs no longer show an in-track caption; the handle `title` remains the only visible explanation until more history loads.

## Testing

CSS contract tests pin the 32px track, 28×20 handle, shared 8px inset, right-edge alignment, and the absence of a `.caption` rule. Divider tests keep the hold, cancel, paging, and keyboard coverage and add an assertion that the visible 关注/可忽略 and later-history captions are gone while the accessible name remains.

## Related

This note owns only the divider presentation rules. Manual session order and the independent count-based gray line are owned by [Sidebar attention Manual order and independent gray line](2026-09-09-sidebar-attention-manual-restore.md).
