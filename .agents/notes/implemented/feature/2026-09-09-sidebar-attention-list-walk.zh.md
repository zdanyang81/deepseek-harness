# Agent Note: 侧栏关注分界线列表内跟手

Status: implemented

[English](2026-09-09-sidebar-attention-list-walk.md) | 中文

## 问题

现网灰线停在已保存的 grid 轨道上，只有固定定位的 ghost 和插入标记跟着指针走。办公室用户拿来和更早的按下即拖预览对比后，要求把 32px 预留行放回列表里，让会话在线移动时让位。

## 决策

恢复[侧栏关注分界线按下即拖](2026-09-09-sidebar-attention-immediate-drag.zh.md)的 live grid 预览：pointermove 把预览截止点或手动计数写进 `--attention-gap-row` 和 `--attention-row`，32px 预留行在会话之间挪。按下即拖、3px 保存阈值、短按、Escape、失焦、分页、overlay 定位和两种排序保持不变。这撤销了[侧栏关注分界线流畅拖动](2026-09-09-sidebar-attention-smooth-drag.zh.md)里目录不动的展示。

## 备选方案

**继续用 ghost 和插入标记，会话轨道不动。** 未采用：用户要求线在列表里走。

**把手柄改成原生 HTML5 拖放。** 未采用：分界线是缝，不是会话行，仍要自定义落点。

**用 `transform` 平移预留轨道，会话轨道不动。** 未采用：overlay 仍按当前缝重写 `--attention-row`，平移会和这套映射打架。

## 后果

拖动手柄时，真正的灰线在目录里走，线上线下的会话让位。已保存截止点仍只在列表内移动后松手才提交。键盘移动仍立即提交。手势按住时 overlay 置顶/隐藏跟 live 缝走。

## 测试

分界线测试覆盖按下后拖动再保存和取消路径，并断言 `--attention-gap-row` 与会话 `--attention-row` 在提交或恢复前跟随预览。工作区浏览器测试沿用同一条按下即拖路径，不再等待 450ms。
