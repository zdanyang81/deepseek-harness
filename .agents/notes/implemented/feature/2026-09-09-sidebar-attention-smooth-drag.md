# Agent Note: Sidebar attention smooth drag

Status: implemented

English | [中文](2026-09-09-sidebar-attention-smooth-drag.zh.md)

## Problem

Pressing the gray attention handle still felt unlike Manual session reordering. Session rows use native HTML drag: the list does not relayout while the pointer moves, and only a ghost plus an insert marker follow. The divider instead wrote a preview cutoff into the grid on every pointermove, so `--attention-row` and `--attention-gap-row` changed continuously and the whole catalog reflowed.

## Decision

The divider keeps its saved grid track until pointerup. After a 3px move it shows a fixed-position ghost that follows the pointer and the same insert chevron used by Session drag. Overlay locators (`data-attention-cutoff`, `data-attention-index`) stay on the saved gap; a transient `data-attention-preview-gap` records the live target without moving Session tracks. Commit, cancel, Escape, blur, paging, and both sort modes stay as in [Sidebar attention immediate drag](2026-09-09-sidebar-attention-immediate-drag.md).

## Alternatives considered

**Keep live grid preview so the reserved 32px track itself is the insertion preview.** Rejected because that is the jank the user compared against Manual row drag.

**Reuse native HTML5 drag on the handle.** Rejected because the divider is a gap, not a Session row, and native drag would still need a custom drop target among rows.

**Translate the reserved track with `transform` while leaving Session tracks still.** Rejected because the overlay still remaps `--attention-row` from the live gap, and a translated track would fight that mapping.

## Consequences

Dragging the gray line now matches Manual session reordering: the catalog stays still, a ghost follows the pointer, and the saved gap moves only on a successful release. Keyboard movement still commits immediately because it is not a pointer drag. Overlay pin/hide still reads the saved track.

## Testing

Divider tests keep press-then-drag-then-save and cancel paths, and assert that `--attention-row` / `--attention-gap-row` stay on the saved gap while `data-attention-preview-gap`, the ghost, and the insert marker follow the pointer. Workspace browser tests keep the same press-to-drag path without relocating Session tracks until commit.
