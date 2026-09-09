# Agent Note: Sidebar attention immediate drag

Status: implemented

English | [中文](2026-09-09-sidebar-attention-immediate-drag.zh.md)

## Problem

The gray attention divider required a 450ms hold before it would follow the pointer. The office user found that wait too long and asked to drag the line as soon as the handle is pressed.

## Decision

Pointerdown on the 28×20 handle starts the drag immediately: it captures the pointer, shows the pressed glyph, and follows later movement. A short press with no movement still does not save. Escape, blur, pointercancel, lost capture, an outside release, and a changed observed prefix still restore the saved gap. Manual and Last updated keep their independent saved boundaries. Presentation rules stay in [Sidebar attention handle alignment](2026-09-09-sidebar-attention-handle-alignment.md); Manual order stays in [Sidebar attention Manual order and independent gray line](2026-09-09-sidebar-attention-manual-restore.md).

## Alternatives considered

**Keep the 450ms hold so a short press cannot start a drag.** Rejected because the user asked to drag as soon as the handle is pressed.

**Commit on pointerdown without requiring movement.** Rejected because a tap on the handle would rewrite the saved gap.

**Start the drag only after a few pixels of movement.** Rejected as the primary rule because the requested behavior is press-then-drag, not another delay; the existing 3px movement threshold still decides whether pointerup saves.

## Consequences

Pressing the handle immediately arms the gray line. Users can drag without waiting. Accidental taps still leave the saved position unchanged. Keyboard, paging, overlay locators, and both sort modes stay as they are. The live preview no longer relocates Session tracks; that follow-the-pointer presentation is in [Sidebar attention smooth drag](2026-09-09-sidebar-attention-smooth-drag.md).

## Testing

Divider tests press, then drag, then save; a press without movement does not save; Escape and pointercancel restore the saved gap. Workspace browser tests keep the same press-to-drag path without a 450ms wait.
