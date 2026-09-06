# Agent Note: Web Session first-question preview

Status: implemented

English | [中文](2026-09-06-web-session-first-question-preview.zh.md)

## Problem

A generated Session title summarizes the topic but can drift away from the user's original request during a long task. Recovering that request requires scrolling to the oldest loaded message, and cold Sessions do not have their event bodies open while the sidebar lists them.

## Decision

The existing `sessionListMetadata` projection retains text from the first committed `user/message` whose source kind is `user`. It joins that message's text blocks, trims surrounding whitespace, keeps at most 2,000 Unicode code points without splitting astral characters, and never replaces the value with a later prompt. Projection state version 2 invalidates older cache rows; Sessions with a current row serve the preview without reading their logs.

A cold-safe `session.firstPrompt` operation scans one Session body without activating an Agent when its current list projection is absent. `ClientSessions` prefers the projected value, shares and retains each successful fallback request, retries failures, and cancels outstanding reads when its root scope disposes. The Workspace sidebar and conversation header receive the same plain callback through their inject faces, request the fallback when a title is first hovered, and show a localized loading state during the normal hover-card dwell. Textless first prompts and Sessions with no human prompt do not leave an empty card.

## Alternatives considered

**Reading every Session body during `session.list`.** This would make a root list request scale with all cold logs and violate the list's zero-body-I/O guarantee. The fallback reads only the hovered Session and leaves listing cache-backed.

**Sending the complete first prompt in every Session summary.** First prompts may contain pasted documents, so an unbounded field would inflate list responses and browser memory. The 2,000-code-point preview covers ordinary questions while keeping the root list bounded.

**Deriving the current header preview from its loaded conversation window.** The first message may sit before the current history page, and this would not solve the sidebar case. One Host projection gives both surfaces the same value.

## Consequences

Session list metadata and projection-cache rows carry up to 2,000 additional Unicode code points per nonblank Session. Current projection rows make previews immediate; an untouched cold Session incurs one bounded, cached body scan only after the user hovers its title. Both title surfaces share that result. Extremely long first questions are previews rather than complete transcripts, and image-only first prompts do not open an empty hover card.
