# Agent Note: 释放空闲的 Web Agent

Status: proposed

[English](2026-11-22-release-idle-web-agents.md) | 中文

## 问题

`ApiSessionAgentController` 只保留 `ctx.agents.resume()` 和 `ctx.agents.create()` 返回值中的 `.agent`，丢弃返回的 disposer。`SessionController.promote` 会恢复 Web 客户端 follow 的每个 Session。因此，Web Host 会一直保留它打开过的每个 Agent，以及其 Session 事件数组、projection、监听器和插件状态，直到 Host 上下文被释放。

在一台长时间运行的生产 Web Host 上，进程运行 21 小时后持有 69 个 Session 锁。这些日志解压后约为 150 MB JSON。进程以 `--max-old-space-size=1024` 运行，常驻内存约 900 MB，另有约 535 MB 被换出。页面请求卡在 major GC 和 swap-in 缺页上。调高堆上限只是推迟这一状态，定期重启会中断正在运行的 turn，两者都不能限制常驻数量。

释放 Agent 不只是缓存淘汰。多个插件把工作绑定在 live Agent 上：`schedule` 在 `agent.ctx` 下注册唤醒，`goal-round-driver` 在 `agent/disposed` 之前保留每个 Agent 的轮次状态，subagent continuation 和后台子 Agent 归父 Agent 所有，`jobs` 在所有者 Agent 被释放时执行所有者清理。释放持有这类工作的 Agent 会停止定时任务、放弃 goal，并取消 job。

## 提议

session controller 为它创建或恢复的每个 Agent 保留 disposer，并在以下条件持续满足一个配置的空闲时长后释放该 Agent：

- `agent.status` 为 `idle`，且 inbox 和队列为空；
- 没有 `follow` 流或 `control` 订阅者引用该 Session；
- 没有插件对该 Agent 持有 residency lease。

### Residency lease

`AgentRegistry` 新增 `retain(agent, reason): () => void`。lease 是通过 effect 注册的 disposer，因此插件卸载时会同时放弃其 lease。registry 提供 `isRetained(agent)`，并在 lease 计数跨过零时发出 `agent/residency`。以下插件持有 lease：

- `schedule`：Agent 有待触发的 schedule 条目时；
- `goal-round-driver`：goal 处于活动状态时；
- subagent continuation：子 Activation 或 Task 尚未终止时；
- `jobs`：Agent 拥有尚未终止的 job 时。

拥有 Agent 范围后台工作但不持有 lease 的插件会在释放时丢失这些工作，因此加载此类插件的部署保持释放关闭。本提议不为未知插件添加默认 lease，因为那样只要加载任何插件，释放就不会发生。

### 配置

`SessionController.Config` 新增 `idleReleaseMs`，这是一个没有默认值的时长。Web profile 在 `cordis.yml` 中设置它，例如 `idleReleaseMs: 900000`。未设置时，controller 与现在一样保留每个 Agent。释放会调用保留的 disposer，它停止 loop、等待其退出并注销 Agent。下一次 `follow` 或命令通过现有路径冷恢复该 Session。

## 考虑过的替代方案

**调高堆上限并定期重启 Host。** 这是运维层面的临时措施。它会中断正在运行的 turn，并且两次重启之间常驻数量仍会无限增长。

**用 LRU 限制 live Agent 数量并释放最久未使用的。** 数量上限忽略了所有权：最久未查看的 Agent 可能正在运行定时任务或后台 job。lease 仍然必需，而有了 lease 之后，空闲计时器可以释放同样的 Agent，无需选择一个任意的数量。

**保持 Agent 常驻并缩减其内存中的 Session。** 从 live Session 中丢弃事件历史会破坏 projection、compaction、fork 和 inspection，它们读取完整日志。释放后冷恢复保持唯一的权威来源。

**把任何注册在 `agent.ctx` 上的 effect 视为 lease。** 每个 Agent 组合都会在 `agent.ctx` 下注册工具和监听器，因此没有 Agent 会被释放。

## 验收标准

- 设置 `idleReleaseMs` 后，没有订阅者且没有 lease 的空闲 Agent 在该时长后发出 `agent/disposed`，并释放其 Session 锁。
- 待触发的 schedule、活动的 goal、未终止的 subagent 子 Agent 和未终止的 job 各自都会阻止释放；这些工作结束后，Agent 在下一个空闲时长后被释放。
- 释放后到达的 `follow` 或 prompt 会冷恢复该 Session，恢复后的历史与释放前一致。
- 在释放排空期间到达的 `follow` 或 prompt 会等待排空完成再恢复，绝不附着到正在释放的 Agent。
- 未设置 `idleReleaseMs` 时行为不变。
- 一个 REAL-composition Web profile 测试通过 Loader 启动，并通过 Remote API 断言释放和恢复。

## 风险

拥有 Agent 范围工作但不持有 lease 的插件会在释放触发时丢失这些工作。因此，在 profile 中启用释放需要审查该 profile 的插件，包括由 patch 层加载的外部插件。

释放后的冷恢复需要一次完整 observation。[suffix 打开](../../implemented/architecture/2026-11-22-cold-follow-opens-from-a-stored-suffix.zh.md)能快速给出首个快照，但完整 observation 仍会在 promotion 之前运行。

释放计时器新增了一条与 `resolveAgent`、`ensureSession` 和 `promote` 竞争的释放路径。controller 必须按 Session id 将释放与恢复串行化，沿用现有去重并发恢复的规则。
