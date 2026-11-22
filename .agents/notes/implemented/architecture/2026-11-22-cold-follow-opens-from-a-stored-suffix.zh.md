# Agent Note：从已存储后缀打开冷 follow

Status: implemented

[English](2026-11-22-cold-follow-opens-from-a-stored-suffix.md) | 中文

## 问题

在 Web UI 中打开冷 Session 要等待整个已存储日志。`SessionHistoryController.follow` 调用 `observeSession`，后者解码每个 Zstandard 帧、克隆事件、预备一个未发布的 Session 并水合 projection，然后第一个 snapshot 帧才离开 Host。opening 页只显示最新的 50 条消息，但其延迟随整个日志增长：在 3,000 回合、18,000 个事件的日志上，opening 观察约需 270 ms，且大部分是 Host 事件循环上的同步工作，其他客户端的请求排在其后。

## 决策

opening 页由已存储后缀提供，完整观察在其后运行。

`SessionPersistence` 新增可选的 `readTail(id, { sufficient })`。JSONL 后端先解码 header 帧，再解码最新的完整事件帧，向前按帧数翻倍加宽直到谓词接受该后缀，并检查已解码的 seq 是否连续。同一修订号下已 memo 的完整读取直接提供后缀而无需解码。凡无法精确提供的情况（未压缩的根、待实体化的会话、历史 generation、分叉日志、撕裂的最终帧或解码失败）都返回 `undefined`。

`SessionProjectionCache` 新增 `suffixFloor`（最低的可用检查点行水位）与 `restoreSuffix`，后者通过 registry 现有的 `restore`，在该地板或更低处开始的后缀上折叠缓存行。`SessionObservationReader.readTail`（以 `SessionQueryEngine.observeSessionTail` 暴露）组合二者。它要求后缀到达地板并包含一个回合边界，拒绝需要中断回合闭合事件的日志，并拒绝 live、已预备与分叉的 Session，以及地板位于日志起点的情况。

普通 Session 的 `follow` 请求一个包含完整 opening 页的后缀。拿到后缀时，它由该后缀产出 snapshot，再运行现有的完整观察。两次读取之间提交的事件排在任何缓冲的 live 事件之前，现有的连续性循环会丢弃重复项。完整观察仍负责提升该 Session。任何后缀失败都回退到完整观察，由它报告权威错误。

同一持久化实例与修订上的并发冷读共享一次进行中的加载，因此后缀 opening 之后同一 Session 的其他读取方不会再解码一次日志。

## 考虑过的替代方案

**在持久化层内分页。** 在后端做感知消息的读取会重复 history controller 拥有的消息组与 surface 规则。谓词让后端无需了解分页语义。

**opening 不带 projection。** 模型选择、列表元数据等 projection 值是 snapshot 帧的一部分。省略它们会让 opening 在完整观察到达前明显不完整，因此只有当 projection cache 能在后缀末尾恢复精确值时才接受后缀。

**后缀 opening 之后跳过完整观察。** 提升、header 兼容性与全日志验证都依赖完整观察，因此它仍会运行；改变的只是它相对第一帧的位置。

## 影响

在 3,000 回合的日志上，第一个 snapshot 在请求后约 7 ms 就绪，而不是约 270 ms；在 300 回合的日志上约 5 ms，而不是约 40 ms。一次 opening 的 Host 总工作量不变或略高，因为后缀解码先于完整观察。

后缀 opening 不验证后缀之前的已提交区域。其后的完整观察执行该验证，并在不一致时使 follow 失败，例如日志结束于后缀游标之下。没有可用 projection-cache 记录的 Session、分叉 Session、中断日志与未压缩的根仍使用完整读取 opening。

验证：`packages/session/session-persistence-jsonl/tests/tail.spec.ts`、`packages/session/session-projection-cache/tests/cache.spec.ts` 中的后缀用例、`packages/session-query/session-query/tests/observation.spec.ts` 中的后缀与进行中加载用例，以及 `packages/api/session-controller/tests/transport.host.spec.ts` 中的 `SessionHistoryController cold suffix opening`。
