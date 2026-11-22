# Agent Note: Chat rows skip rendering instead of unmounting

Status: implemented

English | [中文](2026-11-22-chat-rows-skip-rendering-instead-of-unmounting.zh.md)

## Problem

A Chat view that has paged in several hundred rows lays out every row whenever the column changes width, the theme or font changes, or a style recalculation reaches the column. On a 400-row window of long Markdown answers, one forced relayout of the column took a median of about 14 ms in Chrome, which is most of a frame per resize step or style change.

## Decision

Every loaded row stays mounted; distant top-level rows skip rendering.

`OffscreenRows` in `ui-chat` keeps one `IntersectionObserver` rooted at the Chat scrollport, with a margin of two scrollport heights on each side. `ChatView` provides its registration through `OffscreenRowsContext` around the `conversation.chat.flow` slot, and `ChatNodeSeat` and `ChatGroupSeat` register their wrapper elements. `ChatGroupSeat` provides `null` to the members inside its body, so only top-level rows are observed. A row outside the margin receives `data-chat-offscreen` and an inline `contain-intrinsic-size` equal to the size the observer measured, and `ChatView.module.css` maps the attribute to `content-visibility: auto`. A row that re-enters the margin loses both. Zero-height rows are never marked, `hidden="until-found"` rows keep the user-agent style, and an environment without `IntersectionObserver` renders every row.

## Alternatives considered

**Window the list with `@tanstack/react-virtual`.** Unmounting rows would remove text from browser find, break the `beforematch` reveal of folded rows, and remove the DOM rows that the viewport's paging anchors, saved positions, Turn-rail landings, fold measurements, and reading-line hit tests look up. Each of those would need an index-based materialization path first.

**Apply `content-visibility: auto` to every row.** `auto` imposes layout and paint containment even while a row is rendered. Paint containment clips content that overflows the row, such as wide Markdown tables that break out of the column through `100cqw`. Limiting the property to rows two scrollport heights away keeps it off every row the reader can see.

## Consequences

On a generated 300-Turn Session opened in `dsh web`, the forced column relayout over 400 loaded rows dropped to a median of about 1.2 ms, and scroll height stayed constant while sweeping the whole window. With the property enabled and with it overridden to `visible`, automatic history loading left the same row at the same viewport offset, and a Turn-rail jump into unloaded history landed on the same row. `window.find` selected text inside a skipped row.

React mount and reconciliation cost still grows with the loaded window, because rows stay mounted. A skipped row whose content changes keeps its pinned size until it re-enters the margin, so a growing row far below the reader extends the scroll height only when the reader approaches it.

Verification: `ChatView distant-row render skipping` in `packages/client/ui-chat/tests/chat-view.client.spec.tsx`.
