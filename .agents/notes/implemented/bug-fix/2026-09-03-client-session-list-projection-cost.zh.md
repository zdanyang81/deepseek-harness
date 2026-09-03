# Agent Note: 约束会话列表传输与 Client 投影成本

Status: implemented

[English](2026-09-03-client-session-list-projection-cost.md) | 中文

## 问题

只要组合列表快照中的任一字段发生变化，Client Session manager 就会重建所有扁平行。因此，打开或清除一个 Session 时，即使只有 `current` 变化，也会对完整目录重复执行标题查询、谱系扁平化、身份协调以及 `ids`/`byId` 投影。缓存清理还会针对每个缓存 id 搜索一次完整输出，使结构性重建相对于 Session 数量呈平方复杂度。

仅需元数据的 consumer 也会接收每一个可见行和每一个缓存 projection 值，因此少量近期 Session 窗口仍要承担完整目录的序列化、传输与解析成本。

## 决策

Session manager 将行失效状态与组合快照分开管理。摘要、projection、待处理交互和完成提醒变化会重建行；选择项、subagent 目录、任务与请求状态变化复用现有行数组。身份协调会构建一个 live-id `Set`，并通过带索引的成员检查清理缓存行。

`SessionRuntime` 以 manager 行数组身份作为基础 `ids`/`byId` 投影的键。普通选择变化会复用这两个值。选中的 subagent 路由仍从浅拷贝派生带地址的面包屑行，因此仅路由可见的条目不会进入可复用的基础目录。

`session.list` 默认保留携带完整 projection 的响应。仅需有界元数据的 consumer 可通过 `limit` 请求按活跃度排序的 1 到 1,000 行，并以 `includeProjections: false` 省略 projection block。

## 考虑过的替代方案

**把选择项拆成第二个公开 observable。** 不予采用，因为标准 sessions feed 有意把列表行与 `current` 作为原子快照发布。内部失效域无需改变该约定即可消除重复工作。

**每次重建后只依赖稳定行身份。** 不予采用，因为即使没有任何行可能变化，扁平化、字段比较和缓存清理仍会遍历完整目录。

**使用耗时断言。** 不予采用，因为机器速度不是正确性约定。聚焦的 2,500 行测试改为固定以下行为：仅选择变化时行重建次数为零、`ids`/`byId` 身份稳定，以及行 id 读取次数保持线性上限。

## 后果

验证完成后，打开和清除普通 Session 只产生常量级目录投影工作；真实行变化仍保持线性复杂度并保留现有身份。实现需要显式行脏状态和保留的基础投影。

## 相关内容

现有的[会话行身份决策](2026-08-10-session-row-identity-covers-the-preset.zh.md)负责规定哪些行字段参与身份复用。本决策保留该判定，只改变协调运行的时机以及缓存清理方式。
