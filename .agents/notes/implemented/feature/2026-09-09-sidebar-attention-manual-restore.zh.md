# Agent Note: 侧栏关注分界线的手动排序与独立灰线

Status: implemented

[English](2026-09-09-sidebar-attention-manual-restore.md) | 中文

## 问题

办公室单列表当时被写成只能按最近更新：视图菜单没有**手动排序**，`setOrderBy` 永远写入 `updated`，Session 行也不能拖。灰色关注分界线还在，但只表示时间截止点。用户随后要求恢复真正的手动顺序，并在手动排序下仍能拖灰线，同时不要带回 1aa 那种按活动自动置顶的混合策略。

## 决策

浏览器视图存储会写入用户选中的 `orderBy`。最近更新仍严格按 `updatedAt` 从新到旧、同一时间用 Session ID 并列，沿用 `{timestamp,id,side}` 截止点和新活动自动上线。手动排序使用 `sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]` 和 `setSessionOrder`；未见过的 id 追加在末尾；之后的活动不会把一行顶上去。只有单列表的手动排序会打开原生 HTML 行拖拽（`draggable=true`）。分组里的 Session 仍按时间排；Host 的 Workspace 拖拽不变。

同一条 32px 分界线、28×20 手柄、450ms 长按、键盘、取消和只追加分页的规则都保留。最近更新仍提交时间截止点。手动排序提交独立的整数 `attentionManualGap`（线上行数），并限制在 `[0, rows.length]`。把 Session 拖过灰线不会改这个计数。删掉线上的一行会减一。尾部分页不改计数。缺失的计数会按当时最近更新的可视位置初始化一次。切换模式时两条边界各自恢复。不用假的 SessionId 哨兵。两种模式都保留 `data-attention-cutoff` 和 `data-attention-index`，让现网侧栏 overlay 仍能定位灰线并改写 `--attention-row` / `--attention-gap-row`；手动模式下 cutoff 写非时间标记 `manual`，同时仍暴露整数 index。

这恢复了 [Workspace 侧边栏顺序与折叠](2026-08-11-workspace-sidebar-order-and-folding.zh.md) 里的手动排序菜单项，但不恢复该笔记的活动置顶策略。它保留 [侧栏关注分界线手柄对齐](2026-09-09-sidebar-attention-handle-alignment.zh.md) 的展示规则，并翻转之前「灰线只能按时间」的产品决定。

## 备选方案

**继续只保留最近更新，两种模式都把灰线当成时间截止点。** 未采用：用户已确认要真正的手动排序，以及手动模式下独立的灰线。

**把 1aa 的 `nextSessionOrderAccount` 置顶策略同时恢复到最近更新和手动排序。** 未采用：原来的 1aa 手动排序没有置顶；最近更新已经按新时间重新归类，不必再改一份成员名单。

**用手造 SessionId 或复用 `attentionCutoff` 表示手动灰线。** 未采用：拖动锚点行会把线带走，而且哨兵不是 Session。

**恢复分组模式的 Session 拖拽。** 未采用：已确认的界面是单列表及其灰线。分组 Session 仍按时间排；Host Workspace 顺序不变。

## 后果

用户可以在视图菜单里切换最近更新和手动排序。手动顺序和按行计数的灰线保存在 `dsh.workspace.view.v5`，重挂载和切模式后仍在。最近更新的自动上线和同一时间的身份边界保持原样。第一次进入手动排序会把当时最近更新的可视位置抄一次；之后再拖时间线不会改写这个计数。Goal 和暂缓置顶仍通过现网 overlay 的既有选择器找到手动灰线。

## 测试

存储测试会持久化 `orderBy` 和 `attentionManualGap`。关注线辅助函数固定夹紧、缺省、重排不改计数、删除线上行减一，以及分页不变。分界线测试保留时间截止点的长按/取消/分页覆盖，并新增计数模式提交（不写时间边界），同时仍暴露 `[data-attention-cutoff]=manual` 和 `data-attention-index`。工作区浏览器测试恢复手动排序菜单项、单列表原生拖拽且不走 Host `insertSessionBefore`、手动排序不置顶，以及切模式、重挂载、拖行、删除和分页下的独立计数，并核对 overlay 定位属性。

## 相关

仅展示规则仍在 [侧栏关注分界线手柄对齐](2026-09-09-sidebar-attention-handle-alignment.zh.md)。存储的 Session 顺序和恢复的手动排序菜单见 [Workspace 侧边栏顺序与折叠](2026-08-11-workspace-sidebar-order-and-folding.zh.md)。
