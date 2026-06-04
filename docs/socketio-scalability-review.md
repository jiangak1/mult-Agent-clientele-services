# Socket.IO 可扩展性评估报告

> 评估日期：2026-06-04  
> 范围：Socket.IO 服务端 + 客户端 Hook + Workflow Engine + LLM 调用链  
> 目标：评估当前架构是否支持多实例/K8s 部署，给出改造方案和工作量

---

## 1. 消息流转全链路

### 1.1 完整调用图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (Client)                                │
│                                                                          │
│  chat-area.tsx                                                           │
│  ├─ handleSend()                                                         │
│  │   ├─ 1. 乐观更新：setMessages([...prev, userMessage])                  │
│  │   ├─ 2. setIsProcessing(true)                                         │
│  │   ├─ 3. 如有图片 → POST /api/upload → uploadedUrls                    │
│  │   └─ 4. useSocket.sendMessage(input, uploadedUrls)                    │
│  │         │                                                             │
│  │         ├─ WebSocket 已连接 → socket.emit("chat:message")              │
│  │         └─ WebSocket 断开 → REST fallback POST /api/chat              │
│  │                                                                       │
│  └─ handleStreamEvent(event)                                             │
│      ├─ "agent_switch" → setCurrentAgent(data.to)                        │
│      ├─ "message"      → setMessages([...prev, assistantMsg])            │
│      │                   setIsProcessing(false)                          │
│      ├─ "error"        → setIsProcessing(false)                          │
│      └─ "done"         → setIsProcessing(false), setCurrentAgent(null)   │
│                                                                          │
│  useSocket Hook                                                          │
│  ├─ dynamic import("socket.io-client") → io(url, { auth, query })        │
│  ├─ transports: ["websocket", "polling"]                                  │
│  └─ 失败 → isConnected = false → 触发 REST fallback                       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴──────────────────────────┐
          │  WebSocket (首选)           REST (降级)             │
          │  ws://localhost:3000       POST /api/chat           │
          └─────────────────────────┬──────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                    SERVER (Single Process, Port 3000)                    │
│                                                                          │
│  server/index.ts                                                         │
│  └─ httpServer = createServer(Next.js)                                   │
│     └─ initSocketServer(httpServer)  ← 同一 HTTP Server 挂载 Socket.IO    │
│                                                                          │
│  socket-server.ts                                                        │
│  ├─ Middleware: auth { tenantId, userId }                                │
│  ├─ socket.join(`tenant:${tenantId}`)                                    │
│  │                                                                       │
│  └─ socket.on("chat:message", async (payload) => {                       │
│       │                                                                  │
│       ├─ 1. 自动创建 Conversation（如需要）                               │
│       │     └─ createConversation(tenantId, userId)                      │
│       │                                                                  │
│       ├─ 2. emit("stream:event", { agent_switch → intent_classifier })   │
│       │                                                                  │
│       ├─ 3. await processMessage(config, message, imageUrls)             │
│       │     │                                                            │
│       │     │  ┌─────────────────────────────────────────┐              │
│       │     │  │         WorkflowGraph.invoke()           │              │
│       │     │  │                                         │              │
│       │     │  │  classify_intent                        │              │
│       │     │  │  ├─ 关键词命中 → 0ms                     │              │
│       │     │  │  └─ LLM 调用 → ~800ms (DeepSeek)        │              │
│       │     │  │           │                              │              │
│       │     │  │    ┌──────┴──────┐                      │              │
│       │     │  │    ▼             ▼                       │              │
│       │     │  │  presale      aftersale                  │              │
│       │     │  │  ├─ RAG embed ~200ms                     │              │
│       │     │  │  ├─ Milvus ~50ms                        │              │
│       │     │  │  ├─ CV ~2000ms (optional)                │              │
│       │     │  │  └─ LLM ~1500ms                          │              │
│       │     │  │           │                              │              │
│       │     │  │  (if escalate)                           │              │
│       │     │  │    └─ supervisor LLM ~1000ms             │              │
│       │     │  └─────────────────────────────────────────┘              │
│       │                                                                  │
│       ├─ 4. emit("stream:event", { agent_switch × N })                  │
│       ├─ 5. emit("stream:event", { message })                            │
│       └─ 6. emit("stream:event", { done })                               │
│     })                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 延迟预算（单次消息）

```
最短路径（关键词命中、无CV、无升级）：
  关键词(0ms) + Embedding(200ms) + Milvus(50ms) + LLM(1500ms) + overhead(50ms)
  = ~1.8 秒

常规路径（LLM分类、含RAG）：
  Intent LLM(800ms) + Embedding(200ms) + Milvus(50ms) + Agent LLM(2000ms) + overhead(50ms)
  = ~3.1 秒

最长路径（含CV+升级）：
  CV(2000ms) + Intent(800ms) + Embedding(200ms) + Milvus(50ms) + LLM(2000ms) + Supervisor(1000ms)
  = ~5.1 秒  (or more)
```

### 1.3 事件时序

```
Client                    Server                    External APIs
  │                         │                           │
  │── chat:message ────────►│                           │
  │                         │── stream:event ──────────►│ (agent_switch)
  │◄── stream:event ────────│                           │
  │                         │──── LLM call ────────────►│ DeepSeek
  │     [1.5-3s 静默]       │     [等待...]             │
  │                         │◄─── response ─────────────│
  │                         │                           │
  │                         │──── LLM call ────────────►│ DeepSeek
  │     [1.5-3s 静默]       │     [等待...]             │
  │                         │◄─── response ─────────────│
  │                         │                           │
  │◄── stream:event ────────│ (agent_switch)            │
  │◄── stream:event ────────│ (message + content)       │
  │◄── stream:event ────────│ (done)                    │
  │                         │                           │

  关键问题：1.5-3秒的静默期内，客户端无任何反馈。
  虽然有 typing indicator + agent_switch 事件，
  但 LLM 生成阶段完全是黑盒体验。
```

---

## 2. 阻塞分析

### 2.1 阻塞点全景

```
┌─────────────────────────────────────────┐
│  阻塞等级              链路位置          │
├─────────────────────────────────────────┤
│  🔴 长阻塞 (1-3s)    LLM complete()      │
│  🔴 长阻塞 (2-5s)    CV analyze()        │
│  🟡 中阻塞 (200ms)   Embedding API       │
│  🟡 中阻塞 (50ms)    Milvus search       │
│  🟢 短阻塞 (<10ms)   Prisma DB 读写      │
│  🟢 短阻塞 (<1ms)    Redis 缓存读写      │
└─────────────────────────────────────────┘
```

### 2.2 关键阻塞代码

```typescript
// socket-server.ts:76 — 整个消息处理在 async handler 内
socket.on("chat:message", async (payload) => {
  // ...
  const result = await processMessage(config, payload.message, payload.imageUrls);
  // ↑ 阻塞直到整个 Agent Pipeline 完成 (1.8-5.1s)
  // 在此期间：
  //   - 该 socket 的其他 chat:message 事件会排队
  //   - 同一用户无法发送第二条消息（前端 isProcessing 锁）
  //   - 但不同用户的消息可以并发处理
});

// llm-service.ts:41 — LLM 调用完全同步等待
const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
  method: "POST",
  headers: { ... },
  body: JSON.stringify({ /* ... */ }),
});
// ↑ 无 stream: true，无 AbortController，无超时控制
// connection hang 会导致整个 pipeline 卡死
```

### 2.3 Socket.IO 事件循环分析

```
单客户端：
  chat:message #1  [──── 3.1s processMessage ────]
                      ↑ 在此期间客户端 isProcessing=true
                      ↑ 第二条消息被前端拦截，不会发送

多客户端（同一进程）：
  Client A:  [──── processMessage 3.1s ────]
  Client B:    [──── processMessage 2.8s ────]
  Client C:        [──── processMessage 1.8s ────]
  ↑ Node.js event loop 可以并发处理多个 socket 事件
  ↑ 瓶颈在 LLM API 并发数（取决于 API provider 的 rate limit）

单进程最大并发估算：
  假设 LLM API 允许 60 req/min = 1 req/s
  每个请求 2s → 最大并发 2 个客户端
  但 DeepSeek 等 provider 可能允许更高并发
```

### 2.4 隐藏阻塞

```typescript
// llm-service.ts — 无超时控制
await fetch(url, { body: ... });
// 如果 LLM API 响应超过 30s，handler 会一直等待
// Socket.IO 默认 heartbeat 是 60s，但用户感知是永久卡死

// socket-server.ts — 无 try-catch 超时
// processMessage 失败时仅 catch + emit error
// 没有 AbortSignal 传递机制
```

---

## 3. 内存状态依赖分析

### 3.1 全局可变状态

| 位置 | 变量 | 类型 | 影响 |
|------|------|------|------|
| `socket-server.ts:7` | `let io` | 模块级单例 | 多实例间 `io` 不共享 |
| `milvus-client.ts:6` | `let _milvusClient` | 懒加载单例 | 单进程内 OK，多进程各自创建 |
| `milvus-client.ts:22` | `let milvusAvailable` | 全局开关 | ❌ 一次失败永久关闭，无恢复 |
| `redis.ts:4` | `globalForRedis.redis` | dev 模式缓存 | ✅ 单例，多实例各自连接 |
| `db-client.ts:5` | `globalForPrisma.prisma` | dev 模式缓存 | ✅ 单例，多实例各自连接 |
| `agents/base-agent.ts:35` | `AgentRegistry.agents` | 静态 Map | ✅ 只读注册，多实例相同 |

### 3.2 Socket 实例状态

```typescript
// socket-server.ts — 每个连接持有的状态
socket.data = {
  tenantId: string,       // 连接时设置，断开即丢失
  userId: string,         // 同上
  conversationId: string, // 运行时更新，断开即丢失
};

// socket.join(`tenant:${tenantId}`) — room 成员关系
// 存储在 Socket.IO adapter 内存中
// 多实例下 room 不跨进程
```

### 3.3 前端状态

```typescript
// chat-area.tsx — React component state (Client-side only)
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [isProcessing, setIsProcessing] = useState(false);
const [currentAgent, setCurrentAgent] = useState<string | null>(null);

// conversationId 存储在父组件 page.tsx
// 刷新页面 → 通过 REST API 从 DB 重新加载历史消息
// ✅ 服务端重启不丢对话（已持久化到 PostgreSQL）
```

### 3.4 状态丢失影响评估

| 场景 | 影响 | 恢复方式 |
|------|------|---------|
| Node 进程重启 | 进行中的 Socket.IO 连接全部断开 | 客户端自动重连（socket.io 内置） |
| Pod 被 OOMKilled | 同上 + 进行中的 Agent Pipeline 中断 | 客户端自动重连 → 消息已丢失（未保存到 DB） |
| 滚动更新 | 旧 Pod 的 WebSocket 连接断开 | 客户端重连到新 Pod → 新 conversation |
| in-flight LLM 调用中断 | 用户消息已写入 DB，但 assistant 回复未写入 | 对话历史中出现孤立的 user 消息 |

**关键发现**：`processMessage` 的执行顺序导致数据不一致风险——

```typescript
// graph.ts:299 — 先保存用户消息
await prisma.message.create({ data: { role: "user", content: message } });

// graph.ts:338 — 执行 Agent Pipeline（可能被中断）
let result = await graph.invoke(initialState);

// graph.ts:359 — 后保存 assistant 消息
await prisma.message.create({ data: { role: "assistant", content: ... } });
```

如果进程在 Agent Pipeline 执行期间被杀（OOM / 滚动更新 / 崩溃），用户消息已持久化但回复永远丢失。

---

## 4. 多实例部署可行性

### 4.1 当前状态：不支持

```
┌──────────────────────────────────────────────────────┐
│                    单一部署模型                        │
│                                                      │
│  ┌─────────────────────────────┐                     │
│  │  Pod / 进程                  │                     │
│  │  ┌──────────┐ ┌───────────┐ │                     │
│  │  │ Next.js   │ │ Socket.IO │ │                     │
│  │  │ (HTTP)    │ │ (WS)      │ │                     │
│  │  └──────────┘ └───────────┘ │                     │
│  │  ┌────────────────────────┐ │                     │
│  │  │    Agent Pipeline       │ │                     │
│  │  │    (graph.ts)          │ │                     │
│  │  └────────────────────────┘ │                     │
│  │  ┌──────┐ ┌──────┐ ┌──────┐│                     │
│  │  │PG    │ │Redis │ │Milvus││  ← 外部服务，共享 OK │
│  │  └──────┘ └──────┘ └──────┘│                     │
│  └─────────────────────────────┘                     │
│                                                      │
│  限制：只能跑 1 个实例                                  │
└──────────────────────────────────────────────────────┘
```

### 4.2 多实例后的故障场景

如果直接启动 2 个 Pod（不改造）：

```
    ┌──────────────┐     ┌──────────────┐
    │   Pod A      │     │   Pod B      │
    │  Socket.IO   │     │  Socket.IO   │
    │  rooms: {    │     │  rooms: {    │
    │    tenant:X  │     │    tenant:X  │   ← 不同进程，互不可见！
    │  }           │     │  }           │
    └──────┬───────┘     └──────┬───────┘
           │                    │
    ┌──────▼──────────┐  ┌─────▼───────────┐
    │  Client A       │  │  Client B        │
    │  (sticky→Pod A) │  │  (sticky→Pod B)  │
    └─────────────────┘  └──────────────────┘

问题：
1. Client A 和 Client B 同属 tenant:X，但接在不同的 Pod
2. chat:typing 事件无法跨 Pod 传递
3. 广播到 `tenant:${tenantId}` room 只能到达同 Pod 的客户端
4. socket.data 状态无法跨 Pod 共享
```

### 4.3 当前依赖列表

| 组件 | 是否支持多实例 | 备注 |
|------|:----------:|------|
| PostgreSQL | ✅ | 天然多连接 |
| Redis | ✅ | ioredis 多客户端 OK |
| Milvus | ✅ | 多客户端连接 OK |
| DeepSeek API | ✅ | HTTP，无状态 |
| Next.js HTTP | ✅ | 无状态，LB 分发 OK |
| **Socket.IO** | **❌** | 需要 Redis Adapter |
| **upload 目录** | **❌** | 本地文件系统不共享 |
| **Agent Pipeline** | ⚠️ | 可并行，但无 checkpoint |

---

## 5. Kubernetes 部署评估

### 5.1 当前就绪度

| 需求 | 状态 | 说明 |
|------|:----:|------|
| 无状态 HTTP 服务 | ✅ | Next.js 无本地状态 |
| 外部化配置 | ✅ | 全部通过环境变量 |
| 外部数据库 | ✅ | PG + Redis + Milvus 已容器化 |
| 健康检查端点 | ❌ | 无 `/health` 或 `/ready` 端点 |
| 就绪探针 | ❌ | Socket.IO 无就绪信号 |
| 优雅关闭 | ❌ | 无 SIGTERM handler |
| 持久化存储 | ❌ | upload 目录在本地 |
| 资源限制 | ❌ | 无 K8s resources 定义 |
| HPA 指标 | ❌ | 无自定义 metrics |
| Pod 反亲和 | N/A | 单实例下不需要 |

### 5.2 缺失的 K8s Manifests

当前项目没有任何 Kubernetes 相关文件（无 Dockerfile、无 k8s yaml、无 Helm chart）。

### 5.3 健康检查实现概要

```typescript
// 需要在 server/index.ts 添加
httpServer.on("request", (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  if (req.url === "/ready") {
    const socketReady = io !== null;
    res.writeHead(socketReady ? 200 : 503);
    res.end(JSON.stringify({ socket: socketReady }));
    return;
  }
  // else → Next.js handler
});
```

### 5.4 优雅关闭实现概要

```typescript
// 需要在 server/index.ts 添加
process.on("SIGTERM", async () => {
  console.log("[Server] SIGTERM received, draining connections...");
  
  // 1. 停止接受新连接
  httpServer.close();
  
  // 2. 断开所有 WebSocket（触发客户端重连）
  io?.disconnectSockets(true);
  
  // 3. 等待 in-flight 请求完成（最多 30s）
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // 4. 断开数据库连接
  await prisma.$disconnect();
  await redis.quit();
  
  process.exit(0);
});
```

---

## 6. Redis Adapter 集成方案

### 6.1 现状

```
package.json:
  ✅ ioredis: ^5.4.0          (已安装)
  ✅ socket.io: ^4.8.0        (已安装)
  ❌ @socket.io/redis-adapter  (未安装)

docker-compose.yml:
  ✅ Redis 7-alpine (端口 6379，密码认证)

当前 Redis 用途:
  ✅ 库存缓存 (InventoryService, 60s TTL)
  ✅ 用户记忆缓存 (LongTermMemory)
  ❌ Socket.IO 多播 (未使用)
  ❌ 会话状态共享 (未使用)
  ❌ 消息队列 (未使用)
```

### 6.2 集成步骤

#### Step 1: 安装依赖

```bash
npm install @socket.io/redis-adapter@^9.0.0
```

#### Step 2: 创建 Redis 连接对

```typescript
// src/lib/socket/redis-adapter.ts (新文件)
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { config } from "@/lib/utils/config";

// Pub/Sub 需要两个独立连接
const pubClient = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,  // Redis Adapter 要求
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

const subClient = pubClient.duplicate();

pubClient.on("error", (err) => {
  console.error("[Socket] Redis pub error:", err.message);
});

subClient.on("error", (err) => {
  console.error("[Socket] Redis sub error:", err.message);
});

export function createRedisAdapter() {
  return createAdapter(pubClient, subClient);
}

export async function closeRedisAdapter() {
  await Promise.all([pubClient.quit(), subClient.quit()]);
}
```

#### Step 3: 修改 Socket.IO 初始化

```typescript
// socket-server.ts — 修改后
import { createRedisAdapter } from "./redis-adapter";

export function initSocketServer(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    adapter: createRedisAdapter(),  // ← 新增
    cors: { ... },
    pingTimeout: 60000,
    pingInterval: 25000,
  });
  // ... rest unchanged
}
```

#### Step 4: 连接验证

```typescript
// 添加健康检查
pubClient.on("connect", () => {
  console.log("[Socket] Redis adapter pub connected");
});

// 验证多播：在 Pod A emit，确认 Pod B 的客户端能收到
```

### 6.3 集成后的架构

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Pod A      │   │   Pod B      │   │   Pod C      │
│  Socket.IO   │   │  Socket.IO   │   │  Socket.IO   │
│  redis-adapter│  │  redis-adapter│  │  redis-adapter│
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   ┌──────▼──────┐
                   │    Redis    │
                   │  Pub/Sub    │
                   │  (消息广播)  │
                   └─────────────┘

工作原理：
1. Pod A 的 io.to("tenant:X").emit(...)
   → adapter 通过 Redis pub 发布消息
2. Pod B 和 Pod C 的 adapter 通过 Redis sub 接收
   → 转发给各自进程内的 socket 连接
3. 所有 Pod 的客户端都能收到广播 ← room 跨进程同步
```

### 6.4 兼容性验证

| 现有代码 | 兼容性 | 说明 |
|---------|:------:|------|
| `socket.join(\`tenant:${tenantId}\`)` | ✅ 直接兼容 | room 成员关系通过 Redis 共享 |
| `socket.emit("stream:event", ...)` | ✅ 直接兼容 | 单播不受影响 |
| `io.to("room").emit(...)` | ✅ 直接兼容 | 广播跨 Pod 生效 |
| `socket.data.*` | ✅ 无影响 | 仅本进程使用，不跨 Pod |
| `chat:typing` 广播 | ✅ 修复 | 之前跨 Pod 不可见，集成后可见 |

---

## 7. 改造工作量估算

### 7.1 Phase 1: 基础多实例支持（2-3 天）

| 任务 | 工作量 | 产出 |
|------|:------:|------|
| 安装 + 配置 `@socket.io/redis-adapter` | 2h | 新文件 + 修改 1 处 |
| 添加 `/health` + `/ready` 端点 | 2h | 修改 `server/index.ts` |
| 添加 SIGTERM 优雅关闭 | 3h | 修改 `server/index.ts` |
| 本地 docker compose 验证 | 2h | 手动测试 |
| `upload` 目录改用 MinIO / S3 | 8h | 替换 `upload/route.ts` |
| **小计** | **~2 天** | |

### 7.2 Phase 2: 可靠性加固（3-4 天）

| 任务 | 工作量 | 产出 |
|------|:------:|------|
| LLM 调用添加超时控制 (AbortController) | 4h | 修改 `llm-service.ts` |
| 消息持久化顺序修复（先 Pipeline 后保存） | 4h | 修改 `graph.ts` |
| 添加消息去重（客户端重连时） | 3h | 修改 `use-socket.ts` |
| processMessage 错误恢复（retry + dead letter） | 6h | 修改 `graph.ts` |
| 连接断开时客户端自动重连 + 状态同步 | 4h | 修改 `use-socket.ts` |
| **小计** | **~3 天** | |

### 7.3 Phase 3: K8s 生产化（3-5 天）

| 任务 | 工作量 | 产出 |
|------|:------:|------|
| Dockerfile (multi-stage, Node.js 20) | 4h | Dockerfile |
| K8s Deployment + Service + HPA | 6h | k8s manifests |
| Ingress (nginx + WebSocket 支持) | 2h | ingress yaml |
| ConfigMap + Secret 管理 | 3h | 配置迁移 |
| livenessProbe + readinessProbe | 1h | manifest 字段 |
| PodDisruptionBudget | 1h | manifest 字段 |
| 负载测试 (k6 / Artillery) | 4h | 测试脚本 + 报告 |
| CI/CD pipeline (GitHub Actions) | 4h | workflow yaml |
| **小计** | **~4 天** | |

### 7.4 Phase 4: 性能优化（4-6 天，可选）

| 任务 | 工作量 | 产出 |
|------|:------:|------|
| LLM 响应 streaming (SSE / chunked transfer) | 8h | 修改 `llm-service.ts` + `socket-server.ts` |
| Graph checkpoint 持久化（PostgresSaver） | 8h | 修改 `graph.ts` |
| 消息队列解耦（BullMQ） | 8h | 异步 Pipeline |
| Embedding 缓存 | 3h | 修改 `milvus-client.ts` |
| **小计** | **~5 天** | |

### 7.5 总工时

| Phase | 内容 | 工时 | 优先级 |
|-------|------|:----:|:------:|
| 1 | 基础多实例支持 | 2-3 天 | 🔴 P0 |
| 2 | 可靠性加固 | 3-4 天 | 🟡 P1 |
| 3 | K8s 生产化 | 3-5 天 | 🟡 P1 |
| 4 | 性能优化 | 4-6 天 | 🟢 P2 |
| **合计** | | **12-18 天** | |

---

## 8. 改造前后对比

| 维度 | 改造前 | 改造后 (Phase 1-3) |
|------|--------|-------------------|
| 实例数 | 1 | 2-10+ |
| 滚动更新 | 有损（断开所有连接） | 无损（优雅关闭） |
| 跨 Pod 广播 | ❌ | ✅ Redis Pub/Sub |
| 健康检查 | ❌ | ✅ /health + /ready |
| 文件存储 | 本地磁盘 | MinIO / S3 |
| 故障恢复 | 手动 | 自动重连 + 状态同步 |
| 资源利用率 | 单 Pod 承载全部 | HPA 按 CPU/Memory 扩缩 |
| 最大并发用户 | ~50 (单进程) | ~500+ (多 Pod) |

---

> **评估结论：** 当前 Socket.IO 架构为单进程设计，不能直接多实例部署。核心改造是添加 Redis Adapter（已有 Redis 基础设施，仅需安装 npm 包）和文件存储外迁（MinIO/S3）。Phase 1 工作量约 2-3 天即可实现基本多实例支持。后续 K8s 生产化和流式 LLM 可独立迭代。
