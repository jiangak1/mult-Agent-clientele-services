# LangGraph 差距分析报告

> 分析日期：2026-06-04  
> 当前版本：自建 WorkflowGraph (graph.ts, ~120 行)  
> 对比基准：LangGraph v0.2 (StateGraph API)  

---

## 0. 核心发现

```
package.json 声明了 @langchain/langgraph: ^0.2.0
package.json 声明了 @langchain/core:    ^0.3.0

但 src/ 目录下 40 个 .ts/.tsx 文件中：
  import from "@langchain/*" → 0 次
  LangGraph StateGraph      → 0 次
  LangGraph Annotation      → 0 次
  LangGraph Command         → 0 次

当前工作流引擎：100% 自建 (WorkflowGraph class)
LangGraph 依赖：仅存在于 package.json，从未使用
```

---

## 1. 当前工作流结构

### 1.1 自建引擎核心代码（完整）

```typescript
// graph.ts:15-65 — 整个工作流引擎
class WorkflowGraph {
  private nodes = new Map<string, NodeFn>();       // (state) => Partial<state>
  private edges = new Map<string, EdgeFn>();       // (state) => nextNodeName
  private entryPoint: string | null = null;

  addNode(name, fn)        → this
  addEdge(from, to)        → this
  addConditionalEdge(from, router) → this
  setEntryPoint(name)      → this

  async invoke(initialState): Promise<GraphState> {
    let state = { ...initialState };              // shallow copy
    let currentNode = this.entryPoint;
    const maxSteps = 10;                           // safety cap

    while (currentNode && currentNode !== "__end__" && steps < maxSteps) {
      const update = await nodeFn(state);
      state = { ...state, ...update };             // spread merge
      currentNode = edgeFn(state);
      steps++;
    }
    return state;
  }
}
```

**总计：~60 行代码实现了一个图执行引擎。** 设计简洁，但在生产级 Agent 系统中缺乏关键能力。

### 1.2 当前 DAG 拓扑

```
         ┌──────────────┐
         │classify_intent│  Entry
         └──────┬───────┘
                │ intentRouter(state.intent.category)
         ┌──────┴──────┐
         ▼              ▼
   ┌──────────┐  ┌──────────┐
   │ presale  │  │aftersale │
   └────┬─────┘  └─────┬────┘
        │ presaleRouter │ aftersaleRouter
        │ (shouldEscalate)│ (shouldEscalate)
        │       ┌────────┘
        ▼       ▼
   ┌──────────────┐
   │  supervisor  │
   └──────┬───────┘
          │ supervisorRouter → __end__
          ▼
       __end__
```

**4 节点、5 边、1 条件分支层。** 线性拓扑，无并行、无循环（意图修正场景缺）、无子图。

---

## 2. 逐维度对比

### 2.1 State 管理

| 维度 | 当前自建 | LangGraph |
|------|---------|-----------|
| State 定义 | `interface GraphState` (TypeScript type, 无运行时约束) | `Annotation.Root()` 或 `TypedDict`，运行时 Schema |
| 字段合并 | `{ ...state, ...update }` 浅合并 | Reducer 策略：`add_messages` / `override` / 自定义 |
| 消息列表 | 手动 `[...state.messages, newMsg]` | `MessagesState` 自动追加，支持 `RemoveMessage` |
| 类型安全 | 编译时常量，无运行时校验 | Zod/Pydantic，运行时校验 + 序列化 |
| 历史状态 | 不保留 | Checkpointer 自动保存每次 node 执行前后的 snapshot |
| 状态大小上限 | 无限制（内存） | 可配置 truncation / summarization |

**关键差距：**

```typescript
// 当前：无类型保护，无 merge 策略
async function presaleNode(state: GraphState): Promise<Partial<GraphState>> {
  // state 可以是任何形状，无运行时保证
  return {
    messages: [...state.messages, { ... }],  // 手动合并，容易遗漏
    currentAgent: "presale",
  };
}

// LangGraph 等价：
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => [...left, ...right],  // 声明式 merge
  }),
  currentAgent: Annotation<string>(),
});

// Node 只需返回更新部分，merge 由框架处理
async function presaleNode(state: typeof GraphState.State) {
  return { messages: [new AIMessage(content)], currentAgent: "presale" };
}
```

### 2.2 Checkpoint 支持

| 维度 | 当前自建 | LangGraph |
|------|---------|-----------|
| 断点持久化 | ❌ 无 | ✅ `SqliteSaver` / `PostgresSaver` / `MemorySaver` |
| 自动保存 | ❌ | ✅ 每个 super-step 后自动写入 |
| 断点恢复 | ❌ | ✅ `graph.getState(config)` → 从 checkpoint 继续 |
| 时间旅行 | ❌ | ✅ `graph.getStateHistory(config)` 列出所有 checkpoint |
| 状态分支 | ❌ | ✅ 从历史 checkpoint fork 出新的执行路径 |
| 数据一致性 | ❌ 手动（用户消息先于 agent 回复保存） | ✅ Checkpointer 事务包裹 |

**当前的数据不一致风险：**

```typescript
// graph.ts — processMessage()
// ❌ Step 1: 保存用户消息（提前持久化）
await prisma.message.create({ data: { role: "user", content: message } });

// ❌ Step 2: 执行图（如果进程被杀，assistant 回复永久丢失）
let result = await graph.invoke(initialState);

// ❌ Step 3: 保存 assistant 消息（可能不执行）
await prisma.message.create({ data: { role: "assistant", content: ... } });
```

**LangGraph 方案：**

```typescript
// Checkpointer 在每个 node 执行后自动保存 state snapshot
// messages state 包含 user + assistant 消息的完整历史
// 进程重启后：graph.getState({ configurable: { thread_id } }) → 从断点继续
// → 不会出现 "孤立的 user 消息"
```

### 2.3 Human-in-the-Loop

| 维度 | 当前自建 | LangGraph |
|------|---------|-----------|
| 中断机制 | ❌ | ✅ `interrupt()` → 图暂停，等待外部输入 |
| 人工审批 | ❌ Supervisor 也是 LLM 决策 | ✅ 图暂停 → 人工审核 → `Command(resume=...)` |
| 编辑状态 | ❌ | ✅ `graph.updateState()` 修改任意 checkpoint |
| 多轮人机交互 | ❌ | ✅ 多次 interrupt/resume 循环 |
| 动态路由 | ❌ 硬编码 switch/case | ✅ `Command(goto=...)` 跳转到任意节点 |

**当前"升级"的实现：**

```typescript
// graph.ts — 当前：Supervisor 是另一个 LLM node
async function supervisorNode(state) {
  const result = await supervisorAgent.execute(ctx);
  return {
    shouldEscalate: result.metadata.supervisorDecision === "escalate_to_human",
    // ↑ 仅标记，不暂停图
  };
}
// 图继续执行到 __end__ → 前端收到 done 事件
// "转人工" = 前端显示一条消息，没有真正连接到人工系统
```

**LangGraph 等价：**

```typescript
// 真正的人机交互
function supervisorNode(state) {
  const decision = llm.decide(state);
  if (decision === "escalate_to_human") {
    return interrupt({
      message: "此案例需要人工审核",
      caseData: { conversationId: state.context.conversationId },
    });
  }
  return { resolution: decision.resolution };
}

// 图暂停 → 人工审核 → 通过 API 恢复
// POST /api/resume { thread_id, decision: "approved", resolution: "..." }
// → 图从 interrupt 点继续，携带人工决策
```

### 2.4 Interrupt / Resume

```typescript
// ==========================================
// 当前实现：无
// ==========================================
// 图执行后不可暂停、不可恢复
// graph.invoke() 要么完整执行，要么抛异常

// ==========================================
// LangGraph 实现：
// ==========================================

// 1. Interrupt — 在 node 内部暂停
function approvalNode(state) {
  const score = evaluateRisk(state);
  if (score > 0.8) {
    return interrupt({ reason: "high_risk_approval_required" });
  }
  return { approved: true };
}

// 2. Resume — 外部恢复
await graph.invoke(initialState, {
  configurable: { thread_id: "conv_123" },
});
// → throws GraphInterrupt { value: { reason: "..." } }

// 3. 人工处理
await graph.invoke(
  new Command({ resume: { approved: true, note: "手动审批通过" } }),
  { configurable: { thread_id: "conv_123" } },
);
// → 图从 interrupt 点继续执行
```

### 2.5 Streaming 支持

| 维度 | 当前自建 | LangGraph |
|------|---------|-----------|
| Token 流式 | ❌ LLM 调用 `stream: false` | ✅ `astream_events()` / `stream_mode="messages"` |
| Node 事件 | ❌ Socket.IO 手动 emit | ✅ `astream_events()` 自动发 node start/end |
| 自定义事件 | ✅ Socket.IO `stream:event` | ✅ `dispatchCustomEvent()` |
| 中断事件 | ❌ | ✅ `GraphInterrupt` event 自动抛出 |
| 前端集成 | 手动处理 StreamEvent 类型 | `useStream()` / `useStreamEvents()` hook |

**当前名义上的 "streaming"：**

```typescript
// socket-server.ts — 这不是 LangGraph streaming，是 Socket.IO 事件
socket.emit("stream:event", { type: "agent_switch", ... }); // ← 只是通知
socket.emit("stream:event", { type: "message", ... });      // ← 完整的回复
// ↑ 回复是一次性完整发送的，不是 token-by-token
```

**LLM 层：**

```typescript
// llm-service.ts — 所有 LLM 调用都是非流式
await fetch(`${config.llm.baseUrl}/chat/completions`, {
  body: JSON.stringify({
    // ❌ 无 stream: true
    // ❌ 无 AbortController
  }),
});
// → 等待完整响应 → 整个 content 一次性返回
```

**LangGraph 流式方案：**

```typescript
// Token-level streaming
const stream = await graph.astream_events(initialState, {
  configurable: { thread_id },
  version: "v2",
});

for await (const event of stream) {
  switch (event.event) {
    case "on_chat_model_stream":  // ← LLM token chunk
      socket.emit("stream:chunk", { token: event.data.chunk.content });
      break;
    case "on_chain_start":        // ← Node 开始
      socket.emit("stream:event", { type: "agent_switch", to: event.name });
      break;
    case "on_chain_end":          // ← Node 结束
      socket.emit("stream:event", { type: "agent_done", node: event.name });
      break;
  }
}
```

### 2.6 Memory 支持

| 维度 | 当前自建 | LangGraph |
|------|---------|-----------|
| 短期（对话内） | ✅ messages 数组在 state 中 | ✅ MessagesState 自动管理 |
| 长期（跨会话） | ✅ LongTermMemory (self-built) | ✅ `BaseStore` API (PostgresStore) |
| 跨线程共享 | ❌ | ✅ `store.put(namespace, key, value)` |
| 记忆搜索 | ❌ 手动查询 PostgreSQL | ✅ `store.search(namespace, query)` |
| Agent 记忆 | ✅ `LongTermMemory.storeProductInterest()` | ✅ `InMemoryStore` / `PostgresStore` |

**当前长期记忆：**

```typescript
// long-term-memory.ts — 自建的 key-value 存储
LongTermMemory.storeProductInterest(userId, productIds, categories);
LongTermMemory.storeComplaintContext(userId, conversationId, context);

// 优点：自定义数据模型，灵活
// 缺点：与图状态隔离，需手动在 Agent 中调用
```

**LangGraph Store 方案：**

```typescript
// 在 node 内部直接访问共享 memory
function presaleNode(state, config, store) {
  // 跨会话搜索用户偏好
  const prefs = await store.search(
    ("user_profile", config.configurable.userId),
    { query: "product preferences" },
  );

  // 存储新的偏好
  await store.put(
    ("user_profile", config.configurable.userId),
    "prefs_v2",
    { products: [...], updatedAt: now },
  );
}
```

---

## 3. 差距汇总

```
能力成熟度对比：

                 当前自建      LangGraph
                 ────────      ────────
State Schema      ██░░░░ 3/10   ██████████ 10/10
State Reducer     █░░░░░ 1/10   ██████████ 10/10
Checkpoint        ░░░░░░ 0/10   ██████████ 10/10
Persistence       ░░░░░░ 0/10   ████████░░  8/10
HITL              ░░░░░░ 0/10   ██████████ 10/10
Interrupt/Resume  ░░░░░░ 0/10   ██████████ 10/10
Streaming         ██░░░░ 2/10   ██████████ 10/10
Token Streaming   ░░░░░░ 0/10   █████████░  9/10
Memory (短期)     ██████░░ 6/10   ██████████ 10/10
Memory (长期)     ███████░ 7/10   ████████░░  8/10
Time Travel       ░░░░░░ 0/10   ██████████ 10/10
Parallel Nodes    ░░░░░░ 0/10   █████████░  9/10

                    总计 19/120    总计 114/120
```

---

## 4. 方案对比

### 4.1 A 方案：保持当前架构

```
策略：继续自建引擎，按需逐步补齐缺失能力
```

| 维度 | 评估 |
|------|------|
| **工作量** | 低（无需迁移现有代码） |
| **短期成本** | 低（不引入新依赖，不学习新 API） |
| **长期成本** | 高（每加一个能力需自研：checkpoint ~3天, streaming ~3天, HITL ~5天, time travel ~5天） |
| **维护负担** | 自研引擎需长期维护，社区无贡献 |
| **团队学习** | 团队成员无法复用 LangGraph 社区知识 |
| **生态兼容** | 无法使用 LangGraph 生态工具（LangSmith tracing, LangGraph Studio, Cloud deployment） |
| **最大风险** | 随着需求增长，自建引擎代码膨胀为无法维护的内部框架 |

```
适合场景：
  - 团队规模 < 3 人
  - 4 节点 DAG 拓扑稳定（未来 6 个月不增加复杂度）
  - 不需要 HITL / token streaming / checkpoint
  - 不需要 LangSmith 可观测性
  - 不需要 LangGraph Cloud 托管
```

### 4.2 B 方案：逐步迁移 LangGraph

```
策略：分 3 个阶段渐进迁移，保持服务在线
```

#### Phase B1: 引入 StateGraph（1 周）

```
最小迁移 — 用 LangGraph 替换自建 WorkflowGraph

保留：
  ✅ Agent 类（BaseAgent, PresaleAgent, ...）完全不变
  ✅ Agent.execute() 接口不变
  ✅ LLMService 不变
  ✅ RAG / CV / Inventory 所有 service 不变

替换：
  ❌ WorkflowGraph class → StateGraph
  ❌ 手动 state merge → Annotation reducer
  ❌ graph.invoke() 调用方式

新增：
  + MemorySaver (开发环境) 或 PostgresSaver (生产环境)
  + thread_id 机制
  + 自动 checkpoint
```

**迁移后的 graph.ts（概念代码）：**

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// 1. Schema（替代 interface GraphState）
const GraphState = Annotation.Root({
  messages: Annotation<ChatMessage[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  intent: Annotation<IntentResult | null>({
    reducer: (_, right) => right,  // override
    default: () => null,
  }),
  currentAgent: Annotation<AgentType>(),
  shouldEscalate: Annotation<boolean>(),
  context: Annotation<AgentContext>(),
});

// 2. Nodes（Agent.execute() 逻辑保持不变）
async function classifyIntentNode(state: typeof GraphState.State) {
  const agent = AgentRegistry.get("intent_classifier");
  const result = await agent.execute(state.context);
  // ...same logic as before...
  return { intent, currentAgent: "intent_classifier" };
}

// 3. Graph
const checkpointer = await PostgresSaver.fromConnString(process.env.DATABASE_URL!);

const graph = new StateGraph(GraphState)
  .addNode("classify_intent", classifyIntentNode)
  .addNode("presale", presaleNode)
  .addNode("aftersale", aftersaleNode)
  .addNode("supervisor", supervisorNode)
  .addConditionalEdges("classify_intent", intentRouter)
  .addConditionalEdges("presale", presaleRouter)
  .addConditionalEdges("aftersale", aftersaleRouter)
  .addEdge("supervisor", "__end__")
  .compile({ checkpointer });

// 4. Invoke
export async function processMessage(config, message, imageUrls) {
  const result = await graph.invoke(initialState, {
    configurable: { thread_id: config.conversationId },
  });
  // ↑ state 自动持久化到 PostgreSQL
  return result;
}
```

| 收益 | 说明 |
|------|------|
| 自动 checkpoint | 每次 node 执行后 state 持久化 |
| thread_id | 用 conversationId 作为 thread_id，天然隔离 |
| PostgresSaver | 利用已有 PostgreSQL，无需新增基础设施 |
| 零 Agent 改动 | BaseAgent 接口完全不变 |

#### Phase B2: 引入 Streaming（1-2 周）

```typescript
// 用 astream_events 替换手动 emit
const stream = await graph.astream_events(initialState, {
  configurable: { thread_id },
  version: "v2",
});

for await (const event of stream) {
  switch (event.event) {
    case "on_chat_model_stream":
      socket.emit("stream:chunk", { token: event.data.chunk.content });
      break;
    case "on_chain_start":
      socket.emit("stream:event", { type: "agent_switch", to: event.name });
      break;
    case "on_chain_end":
      socket.emit("stream:event", { type: "agent_done" });
      break;
  }
}
```

**前提：LLMService 需要支持 streaming。** 当前 `complete()` 用 `fetch()` 非流式，需增加 `stream()` 方法。

#### Phase B3: 引入 HITL（1 周）

```typescript
// Supervisor 节点中使用真正的 interrupt
function supervisorNode(state) {
  const decision = llm.decide(state);
  if (decision === "escalate_to_human") {
    return interrupt({
      type: "human_review_required",
      conversationId: state.context.conversationId,
    });
  }
  return { resolution: decision.resolution };
}

// 外部 API 用于恢复
// POST /api/conversations/{id}/resolve
export async function resolveEscalation(conversationId, humanDecision) {
  await graph.invoke(
    new Command({ resume: humanDecision }),
    { configurable: { thread_id: conversationId } },
  );
}
```

---

## 5. 开发成本与风险评估

### 5.1 完整对比

| 维度 | A 方案（保持自建） | B 方案（迁移 LangGraph） |
|------|-------------------|------------------------|
| **Phase 1 工作量** | 0 天 | 3-5 天 |
| **Phase 2 工作量**（streaming） | 自研 5-7 天 | 集成 3-5 天 |
| **Phase 3 工作量**（HITL） | 自研 8-12 天 | 集成 3-5 天 |
| **累加工作量** | 13-19 天 | 9-15 天 |
| **长期维护** | 需持续投入 | 依赖社区更新 |
| **学习成本** | 无（已是自己代码） | 团队需学习 LangGraph API |
| **引入复杂度** | 逐渐增加（自研框架膨胀） | 一次性增加（框架标准化） |
| **DB 依赖** | 不变 | +1 张表（checkpoint store） |
| **Agent 代码改动** | 可能较大 | 几乎为零 |
| **Node 代码改动** | 无 | 低（仅 state 访问方式变化） |
| **回滚难度** | N/A（原地） | 低（可保留 graph.ts.bak，Phase B1 失败直接还原） |

### 5.2 B 方案风险清单

| 风险 | 概率 | 影响 | 缓解 |
|------|:----:|:----:|------|
| LangGraph API 不稳定 | 低 | 中 | 锁定 v0.2.x，不追 latest |
| PostgresSaver 性能问题 | 低 | 中 | 每个 super-step 一次 INSERT，delay < 10ms |
| Agent.execute() 兼容性 | 低 | 低 | 接口不变，仅 state 传递方式变 |
| 迁移期间服务中断 | 低 | 低 | 新建 graph-v2.ts，feature flag 切换 |
| 团队 LangGraph 学习曲线 | 中 | 低 | 概念已在自建引擎中实践（node/edge/state 都已有），API 学习只需 1-2 天 |

### 5.3 推荐决策矩阵

```
                    A 方案 (保持)        B 方案 (迁移)
                    ──────────          ──────────
当前（4 节点图）      ✅ 够用              ✅ 可以（过度工程化）

3 个月后需求：
  + token streaming   ❌ 需自研 5-7天     ✅ 集成 3-5天
  + HITL（转人工）    ❌ 需自研 8-12天    ✅ 集成 3-5天
  + 多 Agent 并行     ❌ 需自研引擎       ✅ 天然支持
  + LangSmith 可观测  ❌ 无法接入         ✅ 零配置接入

6 个月后需求：
  + 10+ Agent SaaS    ❌ 自研框架维护沉重 ✅ 标准化可招聘

结论：
  如果半年内需求仅限当前功能 → A 方案
  如果半年内需要 streaming / HITL / 多 Agent → B 方案
```

---

## 6. 推荐路径

```
建议：B 方案（逐步迁移）

理由：
1. LangGraph 依赖已在 package.json 中（安装成本为 0）
2. Agent 接口无需改动（迁移成本低）
3. 自研 13-19 天 > 迁移 9-15 天（总成本更低）
4. 长期维护成本低（社区维护 vs 自维护）
5. 解锁 LangSmith / LangGraph Studio / Cloud 生态

执行顺序：
  第 1 周：B1 — StateGraph + PostgresSaver（替换 WorkflowGraph）
  第 2 周：B2 — LLM streaming + astream_events
  第 3 周：B3 — HITL（interrupt / Command resume）

每个 Phase 独立可上线，无需等待全部完成。
```

---

> **结论：当前自建 WorkflowGraph 引擎（60 行）能满足简单的 4 节点线性 DAG，但在 Checkpoint/HITL/Streaming/Time Travel 四个核心能力上得分为 0。若团队计划在半年内增加 token 流式输出或真正的人机交互转人工，迁移到 LangGraph 的总成本（9-15 天）低于自研（13-19 天），且 Agent/Service 层代码改动为零。**
