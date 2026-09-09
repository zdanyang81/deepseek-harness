# Agent Note: Sidebar attention Manual order and independent gray line

Status: implemented

English | [中文](2026-09-09-sidebar-attention-manual-restore.zh.md)

## Problem

The office flat list had forced Last-updated ordering: the view menu hid **手动排序**, `setOrderBy` always wrote `updated`, and Session rows were not draggable. The gray attention divider still existed, but only as a time cutoff. The user then required real Manual order and a gray line that still works in Manual — without bringing back 1aa hybrid activity promotion.

## Decision

The browser viewing store writes the requested `orderBy`. Last updated keeps strict descending `updatedAt` with Session-ID ties, the `{timestamp,id,side}` cutoff, and new-activity promotion. Manual uses `sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]` plus `setSessionOrder`; unseen ids append at the tail; later activity does not move a row. Native HTML row drag (`draggable=true`) is enabled only in Manual on the flat list. Grouped Workspace rows stay timestamp-ordered; Host Workspace drag is unchanged.

The same 32px divider, 28×20 handle, immediate press-to-drag, keyboard, cancel, and append-only paging rules remain. Last updated still commits a time cutoff. Manual commits an independent integer `attentionManualGap` (rows above the line), clamped to `[0, rows.length]`. Reordering a Session across the line does not change the count. Removing an above-line row decrements it. Tail pagination leaves it unchanged. A missing count initializes once from the current Last-updated visual index. Mode switch restores each boundary independently. There is no fake SessionId sentinel. Both modes keep `data-attention-cutoff` and `data-attention-index` so the live sidebar overlay can locate the line and rewrite `--attention-row` / `--attention-gap-row`; Manual writes the non-time marker `manual` in cutoff and still exposes the integer index.

This restores the Manual menu entry that [Workspace Sidebar Order and Folding](2026-08-11-workspace-sidebar-order-and-folding.md) described, without that note's activity-promotion policy. It keeps the presentation rules in [Sidebar attention handle alignment](2026-09-09-sidebar-attention-handle-alignment.md) and reverses the earlier time-only product rule for the gray line.

## Alternatives considered

**Keep Last updated only and treat the gray line as a time cutoff in both modes.** Rejected because the user confirmed real Manual order and an independent gray line in Manual.

**Restore 1aa `nextSessionOrderAccount` promotion in Last updated and Manual.** Rejected because original 1aa Manual had no promotion, and Last updated already reclassifies by timestamp without rewriting a membership list.

**Encode the Manual line as a fake SessionId or reuse `attentionCutoff`.** Rejected because dragging an anchor row would move the line, and a sentinel is not a Session.

**Restore grouped-mode Session drag.** Rejected: the confirmed surface is the flat list plus its gray line. Grouped Session order stays timestamp-based; Host Workspace order is unchanged.

## Consequences

Users can switch Last updated and Manual from the view menu. Manual order and the count-based line persist in `dsh.workspace.view.v5` and survive remount and mode switch. Last-updated promotion and equal-time identity stay as they are. The first Manual visit copies the then-visible Last-updated index once; later time-line moves do not rewrite that count. Goal and deferred pinning still find the Manual line through the existing overlay selectors.

## Testing

Store tests persist `orderBy` and `attentionManualGap`. Attention helpers pin clamp, default, reorder-stable count, above-line decrement, and pagination. Divider tests keep the time-cutoff press-to-drag/cancel/paging coverage and add a count-mode commit that does not write a time boundary, while still exposing `[data-attention-cutoff]=manual` and `data-attention-index`. Workspace browser tests restore the Manual menu item, native flat drag without Host `insertSessionBefore`, no Manual promotion, independent gap behavior across mode switch, remount, drag, removal, and paging, and the overlay locator attributes.

## Related

Presentation-only handle rules stay in [Sidebar attention handle alignment](2026-09-09-sidebar-attention-handle-alignment.md). Immediate press-to-drag is owned by [Sidebar attention immediate drag](2026-09-09-sidebar-attention-immediate-drag.md). Stored session order and the restored Manual menu are described in [Workspace Sidebar Order and Folding](2026-08-11-workspace-sidebar-order-and-folding.md).
