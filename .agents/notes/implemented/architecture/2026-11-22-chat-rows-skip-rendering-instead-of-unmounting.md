# Agent Note: Chat rows skip rendering instead of unmounting

Status: implemented

English | [中文](2026-11-22-chat-rows-skip-rendering-instead-of-unmounting.zh.md)

## Problem

A Chat view that has paged in several hundred rows lays out every row whenever the column changes width, the theme or font changes, or a style recalculation reaches the column. On a 300-row window of long Markdown answers, one forced relayout of the column took a median of about 16 ms in Chrome, which is a whole frame per resize step or style change.

## Decision

Every loaded row stays mounted; distant rows skip rendering.

`OffscreenRows` in `ui-chat` keeps one `IntersectionObserver` over the Chat Node Seat wrappers, rooted at the Chat scrollport with a margin of two scrollport heights on each side. A row outside that margin receives `data-chat-offscreen` and an inline `contain-intrinsic-size` equal to the size the observer measured, and `ChatView.module.css` maps the attribute to `content-visibility: auto`. A row that re-enters the margin loses both. Zero-height rows are never marked, `hidden="until-found"` rows keep the user-agent style, and an environment without `IntersectionObserver` renders every row.

## Alternatives considered

**Window the list with `@tanstack/react-virtual`.** Unmounting rows would remove text from browser find, break the `beforematch` reveal of folded Turn-process members, and remove the DOM rows that paging anchors, saved positions, Turn-rail landings, and reading-line hit tests look up by attribute. Each of those would need an index-based materialization path first.

**Apply `content-visibility: auto` to every row.** `auto` imposes layout and paint containment even while a row is rendered. The containment makes the row the containing block of non-portaled `position: fixed` descendants such as `Tooltip` bubbles and the JSON tree copy anchor, and clips them to the row. Limiting the property to rows two scrollport heights away keeps it off every row the reader can hover or focus.

## Consequences

On the same 300-row window, the forced column relayout dropped to a median of about 1.4 ms, scroll height stayed constant while sweeping the whole window, the load-earlier anchor stayed at the same viewport offset, a Turn-rail jump into unloaded history landed on its row, and `window.find` selected text inside a skipped row.

React mount and reconciliation cost still grows with the loaded window, because rows stay mounted. A skipped row whose content changes keeps its pinned size until it re-enters the margin, so a growing row far below the reader extends the scroll height only when the reader approaches it.

Verification: `ChatView distant-row render skipping` in `packages/client/ui-chat/tests/chat-view.client.spec.tsx`.
