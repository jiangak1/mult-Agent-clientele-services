# 架构评审报告：Multi-Agent Customer Service Platform

> 评审日期：2026-06-04  
> 范围：全栈代码（58 个源文件）  
> 方法：逐文件通读 + 调用链追踪  

---

## 1. 目录结构分析

```
customer-service-platform/
├── docker-compose.yml              # 6 容器编排（PG + Redis + Milvus + etcd + MinIO + Ollama）
├── package.json                    # Next.js 15 + LangChain + Socket.IO + Prisma
├── tsconfig.json
├── next.config.js / tailwind / postcss
│
├── server/
│   └── index.ts                    # ★ 入口：启动 Next.js + Socket.IO 于同一 HTTP Server
│
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── page.tsx                # 主页面：Sidebar + ChatArea + AgentPanel + ProductPanel
│   │   ├── layout.tsx / globals.css / manifest.ts
│   │   └── api/
│   │       ├── chat/route.ts       # REST 兜底接口（POST 发送消息 / GET 拉取历史）
│   │       ├── agents/route.ts
│   │       ├── conversations/route.ts
│   │       ├── products/route.ts
│   │       └── upload/route.ts
│   │
│   ├── components/
│   │   ├── chat/                   # ChatArea, AgentPanel, ProductPanel
│   │   └── layout/                 # Sidebar, ThemeSwitcher, LanguageSwitcher, ConfirmDialog
│   │
│   ├── hooks/
│   │   └── use-socket.ts           # Socket.IO 客户端 Hook（动态 import，自动降级 REST）
│   │
│   ├── lib/
│   │   ├── agents/                 # ★ Agent 层：4 个 Agent + 注册中心
│   │   │   ├── base-agent.ts       # BaseAgent 抽象类 + AgentRegistry
│   │   │   ├── intent-agent.ts     # 意图分类（关键词预筛 + LLM）
│   │   │   ├── presale-agent.ts    # 售前：库存+RAG+CV+记忆
│   │   │   ├── aftersale-agent.ts  # 售后：缺陷分析+相似案例+升级判断
│   │   │   └── supervisor-agent.ts # 主管：最终决策 or 转人工
│   │   │
│   │   ├── workflows/
│   │   │   └── graph.ts            # ★ 自建工作流引擎（仿 LangGraph）
│   │   │
│   │   ├── services/
│   │   │   ├── llm-service.ts      # LLM 调用封装（OpenAI 兼容 API）
│   │   │   ├── inventory-service.ts # 产品库存查询（Redis 缓存，60s TTL）
│   │   │   └── complaint-service.ts # 投诉案例搜索+创建（Milvus → pg_trgm 降级）
│   │   │
│   │   ├── rag/
│   │   │   └── rag-engine.ts       # RAG 引擎（向量检索 + LLM 生成 + 推荐）
│   │   │
│   │   ├── vector-store/
│   │   │   └── milvus-client.ts    # Milvus 客户端（集合管理 + CRUD + embedding）
│   │   │
│   │   ├── memory/
│   │   │   └── long-term-memory.ts # 长期记忆（PG 持久化 + Redis 缓存层）
│   │   │
│   │   ├── adapters/
│   │   │   └── cv-adapter.ts       # CV 适配器工厂（Mimo / OpenAI / Local）
│   │   │
│   │   ├── socket/
│   │   │   └── socket-server.ts    # Socket.IO 服务端初始化
│   │   │
│   │   ├── auth/
│   │   │   ├── db-client.ts        # Prisma 客户端 + withTenant（RLS 上下文设置）
│   │   │   └── tenant-middleware.ts # 租户提取（Header / JWT / API Key）
│   │   │
│   │   ├── utils/
│   │   │   ├── config.ts           # 环境变量集中管理
│   │   │   └── redis.ts            # Redis 连接 + cacheGet/Set/Del
│   │   │
│   │   ├── i18n/                   # 国际化（中/英）
│   │   └── theme/                  # 主题切换（亮/暗）
│   │
│   └── types/index.ts              # 全局 TypeScript 类型定义
│
├── prisma/
│   ├── schema.prisma               # ★ 9 个数据模型（租户→用户→会话→消息→知识库→投诉→产品→记忆→审计）
│   ├── seed.ts                     # 种子数据
│   ├── init.sql                    # RLS 初始化 SQL
│   └── post-migrate.sql
│
├── mcp/server.ts                   # MCP Server（Model Context Protocol）
├── docs/api-design.md
└── public/                         # PWA Service Worker + 静态资源
```

**结构评价：**

- 模块划分清晰，关注点分离良好：Agent / Workflow / Service / Adapter 各司其职
- `src/lib/` 承载了几乎全部核心逻辑，需要关注其膨胀趋势
- `server/index.ts`（21 行）与 `src/lib/socket/socket-server.ts`（155 行）分层合理
- 类型定义集中在 `src/types/index.ts`（177 行），目前规模可控

---

## 2. LangGraph 工作流分析

### 2.1 当前实现

```
                     ┌──────────────────┐
                     │  classify_intent  │  ← Entry Point
                     │  (关键词预筛/LLM)   │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │   intentRouter    │
                     └───┬──────────┬───┘
                         │          │
              presale ───┘          └─── aftersale
                 │                        │
          ┌──────▼──────┐         ┌──────▼──────┐
          │   presale    │         │  aftersale   │
          │ RAG+库存+CV+记忆│       │ CV+案例+升级判断│
          └──────┬──────┘         └──────┬──────┘
                 │                       │
          ┌──────▼──────┐         ┌──────▼──────┐
          │ presaleRouter│        │aftersaleRouter│
          └───┬──────┬───┘       └───┬──────┬───┘
              │      │               │      │
           __end__   │            __end__   │
                     │                      │
              ┌──────▼──────┐               │
              │  supervisor  │◄──────────────┘
              │  (转人工/解决) │
              └──────┬──────┘
                     │
                  __end__
```

### 2.2 关键发现

**这不是真正的 LangGraph**。项目 `package.json` 中声明了 `@langchain/langgraph` 依赖，但 `graph.ts` 实现了一个自建的 `WorkflowGraph` 类（约 60 行），与 LangGraph 的 `StateGraph` 无关。

```typescript
// graph.ts:15 — 自建引擎
class WorkflowGraph {
  private nodes = new Map<string, NodeFn>();
  private edges = new Map<string, EdgeFn>();
  // ...仅支持顺序执行 + 条件路由
}
```

**自建引擎缺失的 LangGraph 能力：**

| 能力 | LangGraph StateGraph | 当前自建引擎 |
|------|---------------------|-------------|
| 状态 Schema 定义 | TypedDict / Pydantic | 无约束 plain object |
| Checkpointing（断点恢复） | 内置 | **无** |
| 流式输出 | stream() / astream() | **无** |
| 人机交互中断 | interrupt() | **无** |
| 子图/并行节点 | Send API | **无** |
| 持久化状态 | SqliteSaver / PostgresSaver | **无**（仅 processMessage 开头从 DB 加载，结束写回） |
| 时间旅行 | getState() / updateState() | **无** |

**当前工作流执行流程（processMessage, graph.ts:271-365）：**

```
1. 从 DB 加载最近 20 条历史消息
2. 保存用户消息到 DB
3. 构建 GraphState，执行 invoke()
4. 最大 10 步保护
5. 工作流结束后，保存 assistant 消息到 DB
6. 更新 conversation.intent
```

---

## 3. Agent 职责分析

### 3.1 AgentRegistry 注册机制

```
AgentRegistry (静态 Map)
├── intent_classifier → IntentClassifierAgent  (graph.ts:6 触发 import 注册)
├── presale           → PresaleAgent
├── aftersale         → AfterSaleAgent
└── supervisor        → SupervisorAgent
```

注册方式是文件底部的副作用执行：`AgentRegistry.register(new XxxAgent())`。通过 `import "@/lib/agents"` 批量触发。**优点**：简单、零配置。**缺点**：无法按租户开关 Agent。

### 3.2 各 Agent 详细分析

#### IntentClassifierAgent（intent-agent.ts）

```
输入: ctx.message
  │
  ├─ 关键词命中（26 个售后关键词）→ 直接返回 aftersale（confidence 0.95，绕过 LLM）
  │
  └─ 关键词未命中 → LLM 分类（temperature 0.1, JSON mode）
       │
       └─ 输出: { category, subIntent, confidence, entities }
            │
            └─ routeToAgent() 路由规则:
                 presale        → "presale"
                 aftersale      → "aftersale"
                 complaint      → "aftersale"
                 technical      → "aftersale"
                 default        → "presale"
```

**评价：**
- 关键词预筛是好设计：售后关键词（"退货""退款""坏了"）置信度高，节省 LLM 调用
- 路由规则把 `technical_support` 和 `general_inquiry` 硬编码到特定 Agent，缺乏灵活性
- 关键词列表硬编码，租户无法自定义

#### PresaleAgent（presale-agent.ts）

6 步执行管道：

```
Step 1: 关键词搜索产品（InventoryService, Redis 缓存）
   ↓
Step 2: 若结果少 → 拉取全部产品（兜底展示）
   ↓
Step 3: 若有图片 → CV 分析 + 图片匹配产品
   ↓
Step 4: RAG 查询知识库（FAQ / 政策）
   ↓
Step 5: 构建丰富 Prompt（产品数据 + 图片分析 + 参考资料 + 对话状态）
   ↓
Step 6: LLM 生成回复 → 存储产品偏好到长期记忆
```

**行为规则（System Prompt 核心要点）：**
- 人格：名叫"小C"，温暖、耐心，像朋友
- 首条消息：自我介绍；后续消息：直接进入主题
- **库存规则**：绝对禁止告知客户具体库存数量，仅标注状态（有货/紧张/缺货）
- 产品推荐时说明理由

**Bug 发现**（presale-agent.ts:227，第 223 行）：
```typescript
description: `¥${p.price} | ${p.stock > 0 ? `库存${p.stock}件` : "缺货"}`,
```
System Prompt 明确要求"绝对不能告诉客户具体库存数量"，但 `recommendations` 构造中泄露了具体库存数字。这个数据虽然不直接展示在 LLM 回复中（被 System Prompt 抑制），但作为 metadata 传递给前端，存在泄露风险。

#### AfterSaleAgent（aftersale-agent.ts）

5 步执行管道：

```
Step 1: CV 缺陷分析（每张图片独立分析）
   ↓
Step 2: 产品库存查询（关联产品）
   ↓
Step 3: 相似投诉案例搜索（Milvus 向量 → pg_trgm 降级）
   ↓
Step 4: RAG 查询 + LLM 生成
   ↓
Step 5: 长期记忆存储 + 升级判断
```

**升级逻辑（shouldEscalate，第 162-177 行）：**
```
if (匹配到 critical 案例) → escalate
if (所有匹配案例都 unresolved) → escalate
if (意图置信度 < 0.4) → escalate
otherwise → 自己处理
```

**评价：**
- 升级逻辑保守且合理：critical 和完全未解决的情况必须升级
- 注意：升级发生时，`presaleAgent` 的 `nextAgent` 设为 `"supervisor"`，但 `aftersaleAgent` 没有设置 `nextAgent`（返回 `Result` 时 `nextAgent` 为 undefined）
- 这导致 aftersale → supervisor 的路径实际上不会被图引擎走（因为图中 aftersaleRouter 根据 `state.shouldEscalate` 路由，而 `shouldEscalate` 来自 agent 返回结果）

#### SupervisorAgent（supervisor-agent.ts）

```
输入: 最近 10 条对话 + 当前问题 + 意图分类 + 置信度
   ↓
LLM 判断（JSON mode）:
   ├─ decision: "resolve"       → 给出最终方案
   └─ decision: "escalate_to_human" → 标记需人工介入
```

**评价：**
- Supervisor 本身也是 LLM，本质上是用一个更强的 prompt 做二次判断，没有引入额外的决策逻辑
- 没有真正连接人工客服系统（只有标记位 `shouldEscalate`）
- 转人工后缺少回调闭环

---

## 4. 数据流分析

### 4.1 完整数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  useSocket Hook → Socket.IO (WebSocket) 或 REST fallback        │
└──────────────────────┬──────────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Socket Server   │  ← 提取 tenantId/userId
              │  chat:message    │  ← 无 token 鉴权，仅 header 传参
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  processMessage  │  ← graph.ts (统一入口)
              │  创建/加载会话    │
              │  保存用户消息     │
              │  执行工作流       │
              │  保存助手消息     │
              │  更新会话意图     │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌──────────┐
    │ PostgreSQL │  │  Redis   │  │  Milvus  │
    │ (主存储)   │  │ (缓存层) │  │ (向量搜索)│
    └─────────┘  └──────────┘  └──────────┘
         │                           │
         └───────────┬───────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐ ┌─────────┐ ┌──────────┐
   │ DeepSeek│ │  BGE-M3 │ │ Mimo CV  │
   │ (LLM)   │ │(Embed)  │ │ (Vision) │
   └─────────┘ └─────────┘ └──────────┘
```

### 4.2 存储职责矩阵

| 数据类型 | PostgreSQL | Redis | Milvus |
|---------|-----------|-------|--------|
| 租户/用户/产品 | **主存储** | — | — |
| 会话/消息 | **主存储** | — | — |
| 知识库（FAQ） | 文本 + pgvector embedding | — | **向量索引**（1024-dim） |
| 投诉案例 | 文本 + pgvector embedding | — | **向量索引**（1024-dim） |
| 产品库存查询 | — | **缓存**（60s TTL） | — |
| 用户长期记忆 | **主存储** | **热缓存** | — |
| 会话状态 | — | — | — |

**注意：会话状态（GraphState）不走 Redis，纯内存**。这意味着：如果服务重启，正在进行的 Agent Pipeline 全部丢失。

### 4.3 LLM 调用链路（单次用户消息的完整调用）

```
用户消息: "我的手机屏幕坏了"
  │
  ├─ [LLM Call 1] IntentAgent → DeepSeek（temperature 0.1）
  │   输入: system + history + message
  │   输出: { category: "aftersale", subIntent: "screen_defect", ... }
  │
  ├─ [Embedding Call] createEmbedding → BGE-M3 / DeepSeek
  │   输入: enrichedQuery
  │   输出: vector(1024)
  │
  ├─ [Milvus Search] searchSimilar(complaints) + searchSimilar(knowledge)
  │
  ├─ [如果含图片] CV Call 1..N → Mimo Vision
  │
  └─ [LLM Call 2] AfterSaleAgent → DeepSeek（temperature 默认 0.3）
      输入: system + enriched context + 产品 + case + RAG
      输出: 回复文本
```

**单次消息可能产生的 API 调用：2 次 LLM + 1-2 次 Embedding + 1-2 次 Milvus + 可选 N 次 CV**

### 4.4 数据一致性风险

1. **消息写入时机**：`processMessage` 先保存用户消息（第 299-315 行），工作流执行后在 finally 外部保存助手消息（第 342-351 行）—— 如果工作流抛异常，会留下孤立的用户消息
2. **Embedding 失败降级**：所有 embedding API 调用失败时返回空数组 `[]`，向量搜索自动跳过，但不会通知上游
3. **Milvus 不可用**：全局开关 `milvusAvailable = false`，一旦失败就永久关闭，直到服务重启

---

## 5. Socket.IO 通信链路分析

### 5.1 架构

```
                     ┌──────────────────────┐
  Browser            │   Next.js + Socket.IO │
  ┌──────────┐       │   (同一进程，同一端口)  │
  │socket.io │◄──────►       port 3000      │
  │ client   │       └──────────────────────┘
  │ (动态导入) │
  └──────────┘
     │
     ├─ 连接失败 → 自动降级 REST（/api/chat POST）
     │
     ├─ transports: ["websocket", "polling"]
     │
     └─ auth: { tenantId, userId }  ← 无 token，明文传递
```

### 5.2 事件流

```
Client                          Server
  │                               │
  │──── chat:message ────────────►│ ① 用户发送消息
  │                               │    - 自动创建 Conversation
  │                               │    - 执行 processMessage
  │◄─── stream:event ─────────────│ ② agent_switch: intent_classifier
  │◄─── stream:event ─────────────│ ③ agent_switch: presale (含 metadata)
  │◄─── stream:event ─────────────│ ④ message: 最终回复
  │◄─── stream:event ─────────────│ ⑤ done: { intent, shouldEscalate }
  │                               │
  │──── chat:typing ─────────────►│ ⑥ 打字状态（广播给同租户）
  │◄─── chat:typing ─────────────│
```

### 5.3 关键发现

**优点：**
- 前后端共享类型定义（StreamEvent），事件结构清晰
- 客户端自动降级 REST 的设计保证了可用性
- `pingTimeout: 60000` + `pingInterval: 25000` 的心跳配置合理

**局限：**
- **无水平扩展能力**：Socket.IO 没有使用 Redis Adapter，无法跨进程广播
- **同步阻塞**：`chat:message` handler 内 `await processMessage(...)`，整个消息处理是同步的
- **无消息队列**：高并发下 Socket.IO 事件可能堆积
- **无流式 LLM**：LLM 回复是一次性完成的，没有 token-by-token 流式推送（尽管 Socket.IO 天然支持 streaming）
- **无重连去重**：客户端重连后没有消息去重或补发机制

### 5.4 REST vs Socket 路径对比

| 特性 | REST (/api/chat) | Socket.IO |
|------|-----------------|-----------|
| Agent 切换通知 | 无（一次返回最终结果） | 每次 Agent 切换都 push 事件 |
| 打字指示器 | 不支持 | 支持（chat:typing） |
| 并发处理 | HTTP 并发 | 单 Socket 事件队列 |
| 鉴权方式 | x-tenant-id / x-user-id Header | handshake auth/query |
| 适用场景 | 降级兜底 / 非实时场景 | 主要交互通道 |

---

## 6. Prisma 数据库设计分析

### 6.1 ER 图（简化）

```
Tenant (1) ──────< (N) CustomerUser
  │                     │
  │                     ├──< UserMemory
  │                     │
  │                     └──< Conversation ──< Message
  │
  ├──< KnowledgeBase (vector)
  ├──< ComplaintCase (vector)
  ├──< Product
  ├──< AgentConfig
  └──< AuditLog
```

### 6.2 模型评价

| 模型 | 设计亮点 | 存在问题 |
|------|---------|---------|
| **Tenant** | JSON settings 灵活扩展 | slug 唯一但无域名/品牌字段 |
| **CustomerUser** | tenantId+externalId 联合唯一 | email/phone 无加密，GDPR 风险 |
| **Conversation** | intent+subIntent 便于分类统计 | closedAt 无自动设置逻辑 |
| **Message** | agentType 标记可追踪 Agent 归属 | content 无全文搜索索引 |
| **KnowledgeBase** | embedding 支持 pgvector | 同时维护 PG vector 和 Milvus，双写一致性问题 |
| **ComplaintCase** | 同类双索引（PG+Milvus） | imageUrls 存 String[]，无 CDN 支持 |
| **Product** | 标准 SKU 模型 | keyword 搜索用 contains（ILIKE），无 pg_trgm 加速 |
| **UserMemory** | TTL 字段支持过期 | **无 tenantId 关联！**跨租户数据隔离仅靠 userId |
| **AgentConfig** | 设计意图好（per-tenant 配置） | 实际代码中 Agent 硬编码，**未使用此表** |
| **AuditLog** | 字段完备 | 实际代码中**未写入任何审计日志** |

### 6.3 索引策略

**已有索引：**
- `CustomerUser`: `[tenantId, email]`, `[tenantId, phone]`
- `Conversation`: `[tenantId, userId]`, `[tenantId, status]`, `[tenantId, createdAt]`
- `Message`: `[conversationId, createdAt]`
- `KnowledgeBase`: `[tenantId, category]`
- `ComplaintCase`: `[tenantId, category]`, `[tenantId, severity]`
- `Product`: `[tenantId, sku]` (unique), `[tenantId, category]`

**缺失索引：**
- `Product`: 无 `[tenantId, name]` 全文搜索索引（keyword 查询走 ILIKE 全表扫描）
- `Message`: 无 `[tenantId]` 索引（跨会话查询困难）
- `AuditLog`: 只有 `[tenantId, createdAt]`, `[tenantId, action]` — 缺少 `[userId]`, `[resource]`

### 6.4 租户隔离

`withTenant()` 通过 `SET set_tenant_context($1::uuid)` 设置 PostgreSQL session 变量实现 RLS。但 **Prisma Schema 中没有定义 RLS Policy**。实际的 RLS 逻辑依赖 `prisma/init.sql` 中的 SQL 脚本，属于运行时设置而非迁移管理。

**关键问题：`UserMemory` 表无 `tenantId` 字段**——它通过 `userId` 间接关联租户（因为 `userId` 对应 `CustomerUser`，后者有 `tenantId`），但这破坏了 RLS 的一致性模式，也无法设置有效的租户级 RLS policy。

---

## 7. 当前架构瓶颈

### 7.1 按严重程度排序

| # | 瓶颈 | 严重度 | 影响 | 现状 |
|---|------|--------|------|------|
| 1 | **自建工作流引擎缺少核心能力** | **高** | 无断点恢复、无流式输出、无人机交互、无持久化 Checkpoint | 没有使用真实的 LangGraph StateGraph |
| 2 | **LLM 无流式输出** | **高** | 用户需等待完整生成，体验差 | complete() 使用标准 HTTP POST，非 streaming |
| 3 | **Socket.IO 无水平扩展** | **中高** | 无法多进程部署 | 未使用 Redis Adapter |
| 4 | **Embedding 无缓存** | **中** | 重复 query 产生的 API 费用浪费 | 每次 RAG 都调用 embedding API |
| 5 | **UserMemory 无租户隔离** | **中** | 安全风险 | 缺少 tenantId 字段 |
| 6 | **产品搜索全表扫描** | **中** | ILIKE contains 无索引 | 无 pg_trgm 或全文搜索 |
| 7 | **Milvus 故障后永久降级** | **中** | 一次 Milvus 错误后永久关闭 | `milvusAvailable = false` 全局变量无恢复 |
| 8 | **AgentConfig 表未使用** | **低** | DB Schema 有定义但代码从未读取 | Agent 行为全部硬编码 |
| 9 | **AuditLog 表未使用** | **低** | 有 Schema 无写入 | 无实际审计日志产出 |
| 10 | **CV 适配器复杂度浪费** | **低** | OpenAIVisionAdapter 内部委托给 MimoVisionAdapter | 3 个 Adapter，实际只用 Mimo |

### 7.2 性能瓶颈预估（单次消息延迟）

```
关键词命中路径（最优）:
  Intent 关键词(0ms) → Embedding(200ms) → Milvus(50ms) → LLM(1500ms) = ~1.8s

LLM 意图分类路径（常规）:
  Intent LLM(800ms) → Embedding(200ms) → Milvus(50ms) → LLM(2000ms) = ~3.1s

含 CV 图片分析路径（最慢）:
  CV(2000ms) + Intent(800ms) + Embedding(200ms) + Milvus(50ms) + LLM(2000ms) = ~5.1s

含升级路径:
  常规路径 + 第三次 LLM(1000ms) = +1s
```

**核心结论：延迟主要来自 LLM API 调用的串行等待**，每次消息至少 1 次（关键词路径）到 3 次（升级路径）LLM 调用。

---

## 8. 面向电商 AI 客服 SaaS 的优化建议

### 8.1 架构层（P0 — 影响系统可用性）

#### 8.1.1 迁移到真实 LangGraph

当前自建引擎应替换为 `@langchain/langgraph` 的 `StateGraph`：

```
收益:
  - Checkpointing → 服务重启不丢会话状态
  - 流式输出 → astream_events() 支持 token-by-token 推送
  - 人机交互 → interrupt() 在升级时暂停等人工
  - 持久化 → PostgresSaver 将会话状态写入 PG
```

#### 8.1.2 LLM 响应流式化

```
现状: complete() → await 完整 response → 一次性返回
优化: 使用 SSE / fetch() stream → Socket.IO chunk push

实现路径:
  1. LLMService 添加 stream() 方法（stream: true）
  2. Graph 引擎支持 yield 中间状态
  3. Socket.IO 逐 chunk 推送 "stream:chunk" 事件
  4. 前端逐 token 渲染
```

#### 8.1.3 Socket.IO 支持水平扩展

```typescript
// socket-server.ts 添加 Redis Adapter
import { createAdapter } from "@socket.io/redis-adapter";
const pubClient = new Redis(config.redis.url);
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

### 8.2 数据层（P1 — 影响数据可靠性和安全性）

#### 8.2.1 Embedding 缓存

```typescript
// 对相同文本的 Embedding 结果做 Redis 缓存
const hash = createHash("md5").update(text).digest("hex");
const cached = await cacheGet(`emb:${hash}`);
if (cached) return cached;
const embedding = await fetchEmbedding(text);
await cacheSet(`emb:${hash}`, embedding, 3600);
return embedding;
```

#### 8.2.2 UserMemory 补齐 tenantId

```
ALTER TABLE "UserMemory" ADD COLUMN "tenantId" UUID NOT NULL;
-- 回填: UPDATE "UserMemory" SET "tenantId" = u."tenantId" FROM "CustomerUser" u WHERE u.id = "userId";
```

#### 8.2.3 产品搜索性能优化

```sql
-- 启用 pg_trgm 扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- 添加 GIN 索引
CREATE INDEX idx_product_name_trgm ON "Product" USING gin ("name" gin_trgm_ops);
-- 替换 contains 查询为 similarity 查询
```

### 8.3 Agent 层（P2 — 影响业务灵活性）

#### 8.3.1 激活 AgentConfig 表

```typescript
// 启动时从 DB 加载租户 Agent 配置
const configs = await prisma.agentConfig.findMany({
  where: { tenantId, isActive: true }
});
// 按配置决定启用/禁用、System Prompt 覆盖、temperature 调整等
```

#### 8.3.2 意图路由可配置化

将硬编码的 `routeToAgent()` 规则迁移到 AgentConfig 的 JSON 字段中，允许租户自定义："将 technical_support 路由到 presale 而非 aftersale"。

#### 8.3.3 修复 PresaleAgent 库存泄露

```typescript
// presale-agent.ts:227
// 修改前：
description: `¥${p.price} | ${p.stock > 0 ? `库存${p.stock}件` : "缺货"}`,
// 修改后：
description: `¥${p.price} | ${p.stock > 0 ? "有货" : "缺货"}`,
```

### 8.4 可观测性（P2 — SaaS 必备）

#### 8.4.1 激活 AuditLog

在关键操作点写入审计日志：消息发送、Agent 决策、升级事件、人工介入。

#### 8.4.2 Agent 执行追踪

每个 Agent 的 execute() 添加计时埋点，输出到 LangSmith / OpenTelemetry，构建租户级 Dashboard：
- 各 Agent 调用量/延迟 P50/P99
- 升级率（按意图类别）
- LLM Token 消耗（按租户）
- CV 分析量/成本

### 8.5 SaaS 化专项（P2 — 面向商业化）

#### 8.5.1 租户入驻流程

当前缺省：无注册页面、无租户管理后台、无配额控制。建议增加：
- 租户注册 → 自动创建 Tenant + AgentConfig 默认配置
- 产品导入工具（CSV / API）
- 知识库批量导入（FAQ.md → embedding → Milvus/ PG）

#### 8.5.2 用量计费基础

在 Message 和 AuditLog 基础上增加：
- `UsageRecord` 表（每月 LLM Token / Embedding 调用次数 / CV 分析次数）
- 租户 `plan` 字段与配额限制挂钩（已有 `plan` 字段但无代码使用）

#### 8.5.3 Milvus 故障自愈

```typescript
// 替换永久降级为定期重试
let milvusAvailable = true;
let lastMilvusCheck = 0;
const MILVUS_RETRY_INTERVAL = 60000; // 每分钟重试一次

function checkMilvus(): boolean {
  if (!milvusAvailable && Date.now() - lastMilvusCheck > MILVUS_RETRY_INTERVAL) {
    // 尝试 ping
    lastMilvusCheck = Date.now();
  }
  return milvusAvailable;
}
```

### 8.6 总结：优化优先级路线图

```
第一阶段（2 周） — 稳定性 + 安全性
  ├─ Embedding 缓存
  ├─ UserMemory 补齐 tenantId
  ├─ Milvus 故障自愈
  └─ 修复库存泄露 Bug

第二阶段（4 周） — 用户体验 + 性能
  ├─ LLM 流式输出
  ├─ 产品搜索 pg_trgm 索引
  └─ Socket.IO Redis Adapter

第三阶段（6 周） — 架构升级
  ├─ 迁移到真实 LangGraph StateGraph
  ├─ AgentConfig 激活
  └─ 审计日志落地

第四阶段（8 周） — SaaS 商业化
  ├─ 租户入驻 + 管理后台
  ├─ 用量计费
  └─ 可观测性 Dashboard
```

---

> **评审结论：** 项目整体架构清晰，Agent 管道设计合理，中文电商场景的 System Prompt 工程精细。核心短板在于自建工作流引擎缺失 LangGraph 标准能力、LLM 无流式输出、以及部分数据安全细节（UserMemory 缺 tenantId、库存数字泄露）。建议优先完成第一阶段的安全/稳定性修复，再逐步推进架构升级。
