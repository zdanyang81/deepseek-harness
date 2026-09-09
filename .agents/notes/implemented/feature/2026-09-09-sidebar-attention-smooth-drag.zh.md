# Agent Note: 侧栏关注分界线流畅拖动

Status: implemented

[English](2026-09-09-sidebar-attention-smooth-drag.md) | 中文

## 问题

按下手柄拖灰线仍不像手动排序拖会话。会话行走原生 HTML 拖放：指针移动时列表不重排，只有 ghost 和插入标记跟着走。灰线却在每次 pointermove 把预览截止点写进 grid，`--attention-row` 和 `--attention-gap-row` 连续变化，整列回流。

## 决策

分界线在松手之前保持已保存的 grid 轨道。移动超过 3px 后，用固定定位的 ghost 跟随指针，并用与会话拖动相同的插入标记。overlay 定位属性（`data-attention-cutoff`、`data-attention-index`）仍指向已保存位置；瞬时 `data-attention-preview-gap` 只记录当前目标，不移动会话轨道。提交、取消、Escape、失焦、分页和两种排序仍按[侧栏关注分界线按下即拖](2026-09-09-sidebar-attention-immediate-drag.zh.md)。

## 备选方案

**继续用 live grid 预览，让预留的 32px 轨道自己当插入预览。** 未采用：这正是用户拿来和手动排序对比的卡顿。

**把手柄改成原生 HTML5 拖放。** 未采用：分界线是缝，不是会话行，仍要自定义落点。

**用 `transform` 平移预留轨道，会话轨道不动。** 未采用：overlay 仍按当前缝重写 `--attention-row`，平移会和这套映射打架。

## 后果

拖灰线现在和手动排序拖会话一样：目录不动，ghost 跟手，只有成功松手才改已保存位置。键盘移动仍立即提交，因为它不是指针拖动。overlay 置顶/隐藏仍读已保存轨道。

## 测试

分界线测试覆盖按下后拖动再保存和取消路径，并断言 `--attention-row` / `--attention-gap-row` 停在已保存缝，而 `data-attention-preview-gap`、ghost 和插入标记跟随指针。工作区浏览器测试沿用同一条按下即拖路径，提交前不改会话轨道。
