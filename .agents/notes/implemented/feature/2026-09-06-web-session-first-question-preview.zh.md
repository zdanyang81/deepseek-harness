# Agent Note: Web 会话首问预览

Status: implemented

[English](2026-09-06-web-session-first-question-preview.md) | 中文

## Problem

自动生成的会话标题只概括主题，长任务推进后可能与用户最初的要求产生距离。要找回原问题，用户必须滚动到已加载历史的最前面；侧边栏列出冷会话时又不会打开其事件正文。

## Decision

现有 `sessionListMetadata` projection 保留首条已提交且 source kind 为 `user` 的 `user/message` 文本。它拼接该消息中的文本块、去掉首尾空白，并在不切断 astral character 的前提下最多保留 2,000 个 Unicode code point；后续 prompt 永远不会覆盖该值。Projection state version 2 会使旧 cache row 失效；已有当前 cache row 的会话无需读取日志即可返回预览。

当当前列表 projection 缺失时，冷安全的 `session.firstPrompt` 操作会扫描一个会话正文，但不激活 Agent。`ClientSessions` 优先采用 projection 值，共享并保留每次成功的 fallback 请求，失败后允许重试，并在 root scope 销毁时取消未完成读取。工作区侧边栏和会话主标题通过各自 inject face 接收同一个普通回调，在首次悬停标题时请求 fallback，并在 HoverCard 的常规等待期间显示本地化加载状态。纯附件首问或没有人工 prompt 的会话不会留下空卡片。

## Alternatives considered

**在 `session.list` 中读取每个会话正文。** 这会让 root 列表请求随所有冷日志增长，并破坏列表零正文 I/O 的保证。Fallback 只读取被悬停的会话，列表仍只读取 cache。

**在每条会话摘要中发送完整首问。** 首问可能包含粘贴的长文档；无界字段会放大列表响应和浏览器内存。2,000 个 code point 能覆盖普通问题，同时保持 root 列表有界。

**从当前主界面已加载的对话窗口推导。** 第一条消息可能位于当前历史页之前，而且这不能解决侧边栏场景。一个 Host projection 可让两处界面使用同一值。

## Consequences

每个非空会话的列表元数据和 projection cache row 最多增加 2,000 个 Unicode code point。当前 projection row 可立即提供预览；未触碰的冷会话只会在用户悬停其标题后发生一次受限且缓存的正文扫描，两处标题界面共享该结果。特别长的首问显示为预览而非完整逐字内容；仅含图片或附件的首问不会打开空悬浮卡。
