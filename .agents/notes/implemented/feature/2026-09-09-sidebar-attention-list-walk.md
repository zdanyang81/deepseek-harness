# Agent Note: Sidebar attention list-walk drag

Status: implemented

English | [中文](2026-09-09-sidebar-attention-list-walk.zh.md)

## Problem

The live gray line stayed on its saved grid track while a fixed-position ghost and insert marker followed the pointer. The office user compared that to the earlier press-to-drag preview and asked to put the 32px reserved row back in the list so Sessions yield as the line moves.

## Decision

Restore the live grid preview from [Sidebar attention immediate drag](2026-09-09-sidebar-attention-immediate-drag.md): pointermove writes the preview cutoff or Manual count into `--attention-gap-row` and `--attention-row`, so the reserved 32px track walks between Sessions. Press-to-drag, the 3px save threshold, short taps, Escape, blur, paging, overlay locators, and both sort modes stay as they are. This reverses the still-catalog presentation in [Sidebar attention smooth drag](2026-09-09-sidebar-attention-smooth-drag.md).

## Alternatives considered

**Keep the ghost and insert marker so Session tracks stay still.** Rejected because the user asked for the line to walk in the list.

**Reuse native HTML5 drag on the handle.** Rejected because the divider is a gap, not a Session row, and native drag would still need a custom drop target among rows.

**Translate the reserved track with `transform` while leaving Session tracks still.** Rejected because the overlay remaps `--attention-row` from the live gap, and a translated track would fight that mapping.

## Consequences

Dragging the handle moves the real gray line through the catalog. Sessions above and below the preview gap yield. The saved cutoff still commits only on a moved release inside the list. Keyboard movement still commits immediately. Overlay pin/hide follows the live gap while the gesture is held.

## Testing

Divider tests keep press-then-drag-then-save and cancel paths, and assert that `--attention-gap-row` and Session `--attention-row` follow the preview until commit or restore. Workspace browser tests keep the same press-to-drag path without a 450ms wait.
