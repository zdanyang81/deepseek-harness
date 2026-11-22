# Agent Note：Chat 行跳过渲染而非卸载

Status: implemented

[English](2026-11-22-chat-rows-skip-rendering-instead-of-unmounting.md) | 中文

## 问题

分页加载了数百行的 Chat 视图，在列宽变化、主题或字体变化、或样式重算波及该列时，会对每一行做布局。在含 300 行长 Markdown 回答的窗口上，Chrome 中一次强制重排该列的中位耗时约 16 ms，相当于每个缩放步骤或样式变化占满一整帧。

## 决策

所有已加载行保持挂载；远处的行跳过渲染。

`ui-chat` 中的 `OffscreenRows` 维护一个 `IntersectionObserver`，观察各 Chat Node Seat 包装元素，root 为 Chat 滚动区，上下各留两个滚动区高度的边距。处于该边距之外的行获得 `data-chat-offscreen` 和一个内联 `contain-intrinsic-size`，其值为 observer 测得的尺寸，`ChatView.module.css` 把该属性映射为 `content-visibility: auto`。重新进入边距的行会去掉这两项。高度为零的行从不被标记，`hidden="until-found"` 的行保留用户代理样式，不支持 `IntersectionObserver` 的环境渲染所有行。

## 考虑过的替代方案

**用 `@tanstack/react-virtual` 对列表做窗口化。** 卸载行会让文本脱离浏览器查找，破坏折叠的 Turn-process 成员的 `beforematch` 展开，并移除分页锚点、已保存位置、轮次导航落点和阅读线命中测试按属性查找的 DOM 行。这些路径都需要先有基于索引的实体化路径。

**对每一行应用 `content-visibility: auto`。** `auto` 即使在行被渲染时也施加布局与绘制 containment。containment 使该行成为未经 portal 渲染的 `position: fixed` 后代（例如 `Tooltip` 气泡和 JSON 树复制锚点）的包含块，并把它们裁剪在行内。把该属性限制在距离两个滚动区高度以外的行上，就不会出现在读者可以悬停或聚焦的任何行上。

## 影响

在同一个 300 行窗口上，强制重排该列的中位耗时降至约 1.4 ms；扫过整个窗口时滚动高度保持不变；加载更早历史时锚点保持在相同的视口偏移；轮次导航跳入未加载历史后落在对应行上；`window.find` 能选中被跳过渲染的行内的文本。

React 挂载与协调成本仍随已加载窗口增长，因为行保持挂载。内容发生变化的被跳过行会保持固定尺寸，直到重新进入边距，因此读者下方远处正在增长的行只有在读者接近时才会增加滚动高度。

验证：`packages/client/ui-chat/tests/chat-view.client.spec.tsx` 中的 `ChatView distant-row render skipping`。
