# Agent Note：冷会话 follow 从已存后缀打开

Status: implemented

[English](2026-11-22-cold-follow-opens-from-a-stored-suffix.md) | 中文

## 问题

在 `dsh web` 中打开冷 Session 时，第一个快照来自全量观察：JSONL 后端解码每一个 Zstandard 帧，Session 存储校验并准备整份日志，projection 缓存再把它折叠一遍，这些都发生在首屏分页发出之前。在一个生成的 3000 回合 Session（18005 个事件，压缩后 2 MB，明文 21 MB）上，Host 在第一帧之前花了约 360 ms CPU，Chat 首批行在点击后中位 588 ms 才出现，而 300 回合 Session 约为 300 ms。首屏分页本身只需要最新的几百条消息。

## 决策

冷的普通 Session 的 follow 从已存后缀打开，全量观察随后运行。

- `SessionPersistence.readTail?` 是可选的后端方法，返回以最后一条已存事件结尾、经过校验的后缀，向前加宽直到调用方的判定接受它。JSONL 后端服务当前代际的 Zstandard 日志：先解码 header 帧，再解码按倍数加宽的最新帧段，每一行用 `decodeReleasedV4Row` 解码，即不带跨行 seq 状态的已发布 V4 行接纳与分帧。尾部撕裂、seeded、历史代际、损坏或不连续的日志返回 `undefined`。
- `SessionProjectionCache.suffixFloor` 与 `restoreSuffix` 把该后缀叠加到缓存的检查点行上，得到日志末尾精确的 projection 值。
- `sessionQuery.observeSessionTail` 组合两者。它要求后缀到达缓存下限并包含回合边界，对在线、已准备、fork 出的或处于中断回合的 Session 返回 `undefined`。
- `WebController.follow` 以首屏分页作为判定请求后缀（`paginateSuffix` 返回与 `paginate` 在整份日志上相同的切点；该切点低于后缀起点时返回 `undefined`）。请求激活时，全量观察在首屏发出之前启动，并照旧激活；被激活的 Session 创建后，事件监听器补发后缀游标之后提交的事件。同一 revision 的并发冷读取共享一次进行中的加载，因此首屏之后立即请求的历史分页会并入激活的那次读取。

## 考虑过的替代方案

**在日志旁持久化一份分页缓存。** 单独的首屏分页产物能让第一帧与日志大小无关，但它是模型可见历史的第二个持久来源，每次追加、修复和迁移之后都必须与日志一致。后缀读取始终是日志本身的一个视图。

**加快全量读取。** 360 ms 中解码与 JSON 解析约占 100 ms；其余大部分是 Session 准备、projection 折叠和垃圾回收，并随整份日志增长。更快的全量读取仍会让第一帧等待它用不到的工作。

## 影响

在同一个 3000 回合 Session 上，三次冷启动服务后 Chat 首批行出现的中位时间为 409 ms（376–418 ms），之前为 588 ms（550–897 ms）。收益随日志增大而增长，因为后缀读取只解码首屏需要的帧。通过回合导轨跳转到尚未加载的历史，仍然落在所请求的回合。

首屏可能展示这样一份日志的后缀：全量读取会因其更早的区域或跨事件关系而拒绝它。激活的全量观察会在首屏之后报告该错误；日志缩短到后缀游标以下时，follow 以 `gateway/internal` 失败。被动 follow（省略 `activate`）从不运行全量读取。

验证：`packages/session/session-persistence-jsonl/tests/tail.spec.ts` 中的 `JSONL readTail`，`packages/session-query/session-query/tests/observation.spec.ts` 中的 `SessionObservationReader cold suffix` 与 `in-flight cold loads`，以及 `packages/api/session-controller/tests/history-controller.host.spec.ts` 中的后缀首屏用例。
