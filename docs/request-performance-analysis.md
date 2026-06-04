# 单次客服请求性能分析

> 分析日期：2026-06-04  
> 方法：逐行代码追踪三条完整路径（最快 / 平均 / 最慢）  
> 覆盖：Token 消耗、API 调用次数、DB 查询次数、延迟拆解

---

## 1. 完整执行链路

### 1.1 链路总览

```
                          POST /api/chat
                   或  socket.emit("chat:message")
                               │
                               ▼
                    ┌─────────────────────┐
                    │   processMessage()   │
                    │   (graph.ts:272)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ DB: message.findMany │ ← 加载历史 (最近 20 条)
                    │ DB: message.create   │ ← 持久化用户消息
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  graph.invoke()     │
                    │  (WorkflowGraph)    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                 ▼
   ┌──────────────────┐              ┌──────────────────┐
   │ classify_intent   │              │ classify_intent   │
   │ [关键词命中]       │              │ [LLM 分类]        │
   │ AFTERSALE_KEYWORDS │              │ LLM API ×1       │
   │ 0ms, 0 tokens     │              │ ~800ms, ~300 tok  │
   └────────┬─────────┘              └────────┬─────────┘
            │                                 │
   ┌────────▼────────┐              ┌────────▼────────┐
   │  intentRouter   │              │  intentRouter    │
   └────────┬────────┘              └────────┬────────┘
            │                                 │
     ┌──────┴──────┐                   ┌─────┴──────┐
     ▼             ▼                   ▼            ▼
┌─────────┐  ┌─────────┐         ┌─────────┐  ┌─────────┐
│presale  │  │aftersale│         │presale  │  │aftersale│
└────┬────┘  └────┬────┘         └────┬────┘  └────┬────┘
     │            │                   │            │
     │     ┌──────▼──────┐            │     ┌──────▼──────┐
     │     │shouldEscalate│            │     │shouldEscalate│
     │     │  = true?     │            │     │  = true?     │
     │     └──────┬──────┘            │     └──────┬──────┘
     │            │                   │            │
     │     ┌──────▼──────┐            │     ┌──────▼──────┐
     │     │ supervisor  │            │     │ supervisor  │
     │     │ LLM API ×1  │            │     │ LLM API ×1  │
     │     └──────┬──────┘            │     └──────┬──────┘
     │            │                   │            │
     └────────────┼───────────────────┘            │
                  │                                │
                  ▼                                ▼
              __end__                          __end__
                  │                                │
     ┌────────────▼────────────────────────────────▼──┐
     │  DB: message.create (assistant)                │
     │  DB: conversation.update (intent)              │
     │  ResponseGuard.sanitizeAgentResult()           │
     └───────────────────────────────────────────────┘
```

### 1.2 三种路径定义

| 路径 | 触发条件 | 节点序列 |
|------|---------|---------|
| **Path A 最快** | 售后关键词命中 + 无图片 + 无升级 | classify_intent(关键词) → aftersale → __end__ |
| **Path B 平均** | LLM 意图分类 + 售前 + 无图片 | classify_intent(LLM) → presale → __end__ |
| **Path C 最慢** | LLM 分类 + 售后 + 2 张图片 + 升级 | classify_intent(LLM) → aftersale → supervisor → __end__ |

---

## 2. Path A — 最快路径

**条件**: 用户发送 "退货"（命中 `AFTERSALE_KEYWORDS`），无图片，无升级

### 2.1 API 调用序列

```
Step │ Component              │ API Call          │ Latency  │ Tokens In/Out
─────┼────────────────────────┼───────────────────┼──────────┼──────────────
  1  │ processMessage         │ DB: findMany      │   ~5ms   │ —
  2  │ processMessage         │ DB: create        │   ~5ms   │ —
  3  │ intent-agent (keyword) │ 无（本地匹配）     │   ~0ms   │ —
  4  │ aftersale-agent        │ Redis: cacheGet   │   ~1ms   │ —
     │   InventoryService     │ (库存缓存命中)     │          │
  5  │ aftersale-agent        │ Embedding API ×1  │ ~200ms   │ in: ~50 tok
     │   ComplaintService     │ (createEmbedding) │          │
  6  │ aftersale-agent        │ Milvus search ×1  │  ~50ms   │ —
     │   ComplaintService     │                   │          │
  7  │ aftersale-agent        │ DB: findMany      │   ~5ms   │ —
     │   ComplaintService     │ (complaint cases) │          │
  8  │ aftersale-agent        │ Embedding API ×1  │ ~200ms   │ in: ~50 tok ← 与 Step 5 重复!
     │   RAGEngine            │ (createEmbedding) │          │
  9  │ aftersale-agent        │ Milvus search ×1  │  ~50ms   │ —
     │   RAGEngine            │                   │          │
 10  │ aftersale-agent        │ LLM API ×1        │~1500ms   │ in: ~1200 out: ~400
     │   RAGEngine            │ (generateResponse)│          │
 11  │ aftersale-agent        │ DB: upsert        │   ~5ms   │ —
     │   LongTermMemory       │ Redis: cacheSet   │   ~1ms   │
 12  │ processMessage         │ DB: create        │   ~5ms   │ —
 13  │ processMessage         │ DB: update        │   ~5ms   │ —
─────┴────────────────────────┴───────────────────┴──────────┴──────────────
 合计                         6 DB + 2 Redis      ~2032ms   LLM: ~1600 tok
                              2 Embedding                    Embed: ~100 tok
                              2 Milvus                       ────────────────
                              1 LLM                          Total: ~1700 tok
                              0 CV
```

### 2.2 Path A 汇总

| 指标 | 数值 |
|------|:----:|
| **LLM 调用** | 1 次 |
| **Embedding 调用** | 2 次（重复！） |
| **Milvus 查询** | 2 次 |
| **CV 调用** | 0 次 |
| **DB 查询** | 6 次 |
| **Redis 操作** | 2 次 |
| **Token 消耗** | ~1,700 |
| **端到端延迟** | **~2.0 秒** |

---

## 3. Path B — 平均路径

**条件**: 用户发送 "推荐一款编程笔记本 预算15000"（非关键词），无图片，无升级

### 3.1 API 调用序列

```
Step │ Component              │ API Call          │ Latency  │ Tokens In/Out
─────┼────────────────────────┼───────────────────┼──────────┼──────────────
  1  │ processMessage         │ DB: findMany      │   ~5ms   │ —
  2  │ processMessage         │ DB: create        │   ~5ms   │ —
  3  │ intent-agent (LLM)     │ LLM API ×1        │ ~800ms   │ in: ~550 out: ~60
     │   LLMService.complete  │ temp=0.1          │          │ (sys ~500 + user)
  4  │ presale-agent          │ Redis: cacheGet   │   ~1ms   │ —
     │   InventoryService     │ (keyword查询)     │          │
  5  │ presale-agent          │ DB: findMany+count│  ~10ms   │ —
     │   InventoryService     │ (keyword miss→DB) │          │
  6  │ presale-agent          │ DB: findMany+count│  ~10ms   │ —
     │   InventoryService     │ (isBrowseQuery)   │          │
  7  │ presale-agent          │ Embedding API ×1  │ ~200ms   │ in: ~80 tok
     │   RAGEngine            │ (createEmbedding) │          │
  8  │ presale-agent          │ Milvus search ×1  │  ~50ms   │ —
     │   RAGEngine            │                   │          │
  9  │ presale-agent          │ LLM API ×1        │~1500ms   │ in: ~2000 out: ~400
     │   RAGEngine.generate   │ ⚠️ 浪费的调用!     │          │
 10  │ presale-agent          │ LLM API ×1        │~1800ms   │ in: ~3500 out: ~500
     │   LLMService.complete  │ temp=0.6          │          │ (sys ~1500 + prompt ~2000)
     │                        │ maxTokens=1536    │          │
 11  │ presale-agent          │ DB: upsert        │   ~5ms   │ —
     │   LongTermMemory       │ Redis: cacheSet   │   ~1ms   │
 12  │ processMessage         │ DB: create        │   ~5ms   │ —
 13  │ processMessage         │ DB: update        │   ~5ms   │ —
─────┴────────────────────────┴───────────────────┴──────────┴──────────────
 合计                         7 DB + 2 Redis      ~4392ms   LLM: ~6460 tok
                              1 Embedding                    Embed: ~80 tok
                              1 Milvus                       ────────────────
                              3 LLM ← 其中 1 次浪费!          Total: ~6540 tok
                              0 CV
```

### 3.2 ⚠️ 浪费的 LLM 调用

```typescript
// presale-agent.ts:148 — RAGEngine.query() 内部调用 LLM 生成完整回复
const { content } = await RAGEngine.query(ctx.tenantId, ctx.message, "presale");
// ↑ content = RAG + LLM 生成的完整客服回复 (~400 tokens)

// presale-agent.ts:203 — 但只用其中 800 字符作为参考资料
knowledgeContext ? `\n【参考资料】\n${knowledgeContext.slice(0, 800)}` : "",

// presale-agent.ts:209 — 又调用一次 LLM 生成真正的回复
const content = await LLMService.complete(this.systemPrompt, userPrompt, { ... });
// ↑ 这次才是最终发给用户的回复
```

**浪费量**: 每次售前请求浪费 1 次 LLM 调用（~2000 input + ~400 output = ~2400 tokens），占 Path B 总 token 消耗的 **37%**。

**注**: AfterSaleAgent 没有此浪费，因为 RAGEngine.generateResponse() 的输出直接作为最终回复（仅拼接 productContext）。

### 3.3 Path B 汇总

| 指标 | 数值 |
|------|:----:|
| **LLM 调用** | 3 次（1 次浪费） |
| **Embedding 调用** | 1 次 |
| **Milvus 查询** | 1 次 |
| **CV 调用** | 0 次 |
| **DB 查询** | 7 次 |
| **Redis 操作** | 2 次 |
| **Token 消耗** | ~6,540 |
| **端到端延迟** | **~4.4 秒** |

---

## 4. Path C — 最慢路径

**条件**: 用户发送 "屏幕坏了 有坏点 用了才一周" + 2 张图片，命中 critical 案例触发升级

### 4.1 API 调用序列

```
Step │ Component              │ API Call          │ Latency  │ Tokens In/Out
─────┼────────────────────────┼───────────────────┼──────────┼──────────────
  1  │ processMessage         │ DB: findMany      │   ~5ms   │ —
  2  │ processMessage         │ DB: create        │   ~5ms   │ —
  3  │ intent-agent (LLM)     │ LLM API ×1        │ ~800ms   │ in: ~550 out: ~60
  4  │ aftersale-agent        │ CV API ×2         │~4000ms   │ in: 2 images
     │   cvAdapter.analyze    │ (每张 2s)         │          │ out: description
  5  │ aftersale-agent        │ Redis: cacheGet   │   ~1ms   │ —
     │   InventoryService     │                   │          │
  6  │ aftersale-agent        │ Embedding API ×1  │ ~200ms   │ in: ~100 tok
     │   ComplaintService     │ (createEmbedding) │          │
  7  │ aftersale-agent        │ Milvus search ×1  │  ~50ms   │ —
     │   ComplaintService     │                   │          │
  8  │ aftersale-agent        │ DB: findMany      │   ~5ms   │ —
     │   ComplaintService     │ (complaint cases) │          │
  9  │ aftersale-agent        │ Embedding API ×1  │ ~200ms   │ in: ~100 tok ← 重复!
     │   RAGEngine            │ (createEmbedding) │          │
 10  │ aftersale-agent        │ Milvus search ×1  │  ~50ms   │ —
     │   RAGEngine            │                   │          │
 11  │ aftersale-agent        │ LLM API ×1        │~1500ms   │ in: ~1500 out: ~400
     │   RAGEngine            │ (generateResponse)│          │
 12  │ aftersale-agent        │ DB: upsert        │   ~5ms   │ —
     │   LongTermMemory       │ Redis: cacheSet   │   ~1ms   │
 13  │ aftersale-agent        │ shouldEscalate=   │   ~0ms   │ —
     │                        │ true → supervisor │          │
 14  │ supervisor-agent       │ LLM API ×1        │~1000ms   │ in: ~500 out: ~100
     │   LLMService.complete  │ temp=0.2          │          │
 15  │ processMessage         │ DB: create        │   ~5ms   │ —
 16  │ processMessage         │ DB: update        │   ~5ms   │ —
─────┴────────────────────────┴───────────────────┴──────────┴──────────────
 合计                         7 DB + 2 Redis      ~7827ms   LLM: ~4610 tok
                              2 Embedding                    Embed: ~200 tok
                              2 Milvus                       CV: 2 images
                              3 LLM                          ────────────────
                              2 CV                           Total: ~4810 tok
```

### 4.2 升级触发条件

```typescript
// aftersale-agent.ts:166-181
shouldEscalate → true 当满足任一:
  1. similarCases 中有 severity === "critical" 的案例
  2. 所有匹配案例都无 resolution（全未解决）
  3. intent.confidence < 0.4
```

### 4.3 Path C 汇总

| 指标 | 数值 |
|------|:----:|
| **LLM 调用** | 3 次 |
| **Embedding 调用** | 2 次（重复！） |
| **Milvus 查询** | 2 次 |
| **CV 调用** | 2 次 |
| **DB 查询** | 7 次 |
| **Redis 操作** | 2 次 |
| **Token 消耗** | ~4,810 |
| **端到端延迟** | **~7.8 秒** |

---

## 5. 三条路径对比矩阵

```
指标              Path A (最快)    Path B (平均)    Path C (最慢)
────────────────  ────────────    ────────────    ────────────
LLM 调用          1 次            3 次 (1浪费)    3 次
Embedding 调用    2 次 ⚠️重复     1 次            2 次 ⚠️重复
Milvus 查询       2 次            1 次            2 次
CV 调用           0 次            0 次            2 次
DB 查询           6 次            7 次            7 次
Redis 操作        2 次            2 次            2 次
────────────────  ────────────    ────────────    ────────────
Token 消耗        ~1,700          ~6,540          ~4,810
Token 浪费        0               ~2,400 (37%)   ~1,200 (25%)
────────────────  ────────────    ────────────    ────────────
端到端延迟         ~2.0s           ~4.4s           ~7.8s
LLM 延迟占比      75%             75%             42%
CV 延迟占比       0%              0%              51%
Embed 延迟占比    20%             5%              5%
DB/Redis/其他     5%              20%             2%
────────────────  ────────────    ────────────    ────────────
```

### 5.1 延迟构成（Path B 详细拆解）

```
Path B: ~4.4s 总延迟

LLM (Intent)      ████████░░░░░░░░  800ms  18%
LLM (RAG-浪费)    ██████████████░░ 1500ms  34%  ← 最大浪费
LLM (Presale)     █████████████████ 1800ms  41%
Embedding         ██░░░░░░░░░░░░░░  200ms   5%
DB + Redis + 其他 █░░░░░░░░░░░░░░░  100ms   2%
                  ─────────────────
                  4400ms
```

---

## 6. Token 消耗详细拆解

### 6.1 System Prompt 固定开销

| Agent | Prompt | 估算 Token 数 |
|-------|--------|:------------:|
| Intent Classifier | `INTENT_SYSTEM_PROMPT` (40 行中文) | ~500 |
| Presale | `PRESALE_SYSTEM_PROMPT` (68 行中文) | ~1,500 |
| AfterSale | `AFTERSALE_SYSTEM_PROMPT` (54 行中文) | ~800 |
| Supervisor | `SUPERVISOR_SYSTEM_PROMPT` (18 行中文) | ~200 |

### 6.2 动态 Prompt Token

| 组件 | Path A | Path B | Path C |
|------|:------:|:------:|:------:|
| Intent user message | — | ~50 | ~50 |
| Intent history (5 turns) | — | ~100 | ~100 |
| Product lines (每产品 ~40 tok) | — | ~800 (20 products) | ~200 (5 products) |
| Product context text | — | ~200 | ~100 |
| Image analysis text | — | — | ~300 |
| RAG knowledge context | — | ~400 (800 chars) | ~400 |
| Conversation history (10 turns) | ~500 | — | ~500 |
| Supervisor context | — | — | ~300 |
| **User prompt 合计** | **~500** | **~2,000** | **~1,950** |

### 6.3 每次 LLM 调用的 Token 细账

```
Path A (1 LLM call):

  Call #1 — RAGEngine.generateResponse (aftersale):
    System: ~1,000 (RAG system prompt + similar cases)
    User:   ~200 (enriched query)
    Output: ~400 (response)
    Total:  ~1,600

Path B (3 LLM calls):

  Call #1 — Intent (LLMService.complete):
    System: ~500
    User:   ~50
    Output: ~60 (JSON)
    Total:  ~610

  Call #2 — RAGEngine.generateResponse (presale) ⚠️浪费:
    System: ~1,500 (RAG system prompt + knowledge)
    User:   ~500
    Output: ~400 (仅用前 800 chars 作参考)
    Total:  ~2,400 → 浪费!

  Call #3 — Presale (LLMService.complete):
    System: ~1,500 (PRESALE_SYSTEM_PROMPT)
    User:   ~2,000 (product context + image + knowledge + intro)
    Output: ~500 (maxTokens=1536)
    Total:  ~4,000

  Path B Total: ~7,010 → 含 ~2,400 浪费

Path C (3 LLM calls + 2 CV calls):

  Call #1 — Intent:       ~610
  Call #2 — RAG (aftersale): ~1,900 (system + enriched query + output)
  Call #3 — Supervisor:     ~800
  CV Call ×2:               images ×2 (不计 tokens，按图片计费)
  Path C Total: ~3,310 tokens + 2 images
```

---

## 7. 重复调用分析

### 7.1 Embedding 重复（Path A / Path C）

```typescript
// 调用链: AfterSaleAgent.execute()

// 位置 1 — aftersale-agent.ts:108 (ComplaintService.searchSimilarCases)
const similarCases = await ComplaintService.searchSimilarCases(
  ctx.tenantId, enrichedQuery, 5
);
// → createEmbedding(enrichedQuery) → Milvus search(complaints, embedding)

// 位置 2 — aftersale-agent.ts:116 (RAGEngine.query)
const { content, sources } = await RAGEngine.query(
  ctx.tenantId, enrichedQuery, "aftersale"
);
// → createEmbedding(enrichedQuery) → Milvus search(complaints, embedding)
// ↑ 相同的 enrichedQuery，重复创建 embedding
```

**浪费量**: 每次售后请求多 1 次 Embedding API 调用（~200ms, ~50 tokens）

**根本原因**: `ComplaintService` 和 `RAGEngine` 各自独立调用 `createEmbedding()`，没有共享缓存层。

### 7.2 LLM 重复（Path B）

见第 3.2 节。本质是 `RAGEngine.query()` 设计为"检索+生成"一体，但 PresaleAgent 只想要它的检索结果，不需要它生成的回复。

### 7.3 重复调用汇总

| 重复项 | 影响路径 | 额外延迟 | 额外 Token | 修复难度 |
|--------|:------:|:------:|:--------:|:------:|
| Embedding 重复 | Path A, C | +200ms | +50 | 低（加缓存） |
| LLM 浪费 | Path B | +1500ms | +2,400 | 中（重构 RAG API） |

---

## 8. Top 10 性能优化建议

### 优化 1: Embedding 请求级缓存 🔴 P0

```
问题: ComplaintService 和 RAGEngine 对同一文本各调一次 createEmbedding()
预期收益: Path A 延迟 -200ms, Path C 延迟 -200ms
实现: 在 AgentContext 或请求级别加一层 Map<string, number[]>
      同一请求内相同文本的 embedding 仅计算一次
工作量: 2 小时
```

```typescript
// 概念代码 — 在 AfterSaleAgent.execute() 中
const embeddingCache = new Map<string, number[]>();
const getEmbedding = async (text: string) => {
  if (!embeddingCache.has(text)) {
    embeddingCache.set(text, await createEmbedding(text));
  }
  return embeddingCache.get(text)!;
};
```

### 2: RAG 检索与 LLM 生成解耦 🔴 P0

```
问题: RAGEngine.query() 强制 "检索 + 生成" 一体化
      PresaleAgent 只需检索结果，不需要 LLM 生成
预期收益: Path B 延迟 -1500ms, Token 减少 ~2,400 (37%)
实现: 拆分 RAGEngine.query() 为:
      RAGEngine.retrieve(tenantId, query, type) → { sources, systemPrompt }
      RAGEngine.generate(sources, query) → string
      让 PresaleAgent 只调用 retrieve(), AfterSaleAgent 调用 query()
工作量: 4 小时
```

### 3: Embedding 全局缓存 🟡 P1

```
问题: 频繁出现的 FAQ 查询（如"退货政策"）每次都重新计算 embedding
预期收益: 热门查询 embedding 延迟 200ms → 1ms, 降低 API 费用
实现: Redis 缓存 embedding 结果，key = md5(text), TTL = 1 小时
      注意: 不同 embedding 模型产生不同向量，需区分模型版本
工作量: 3 小时
```

### 4: LLM 调用超时与重试 🟡 P1

```
问题: LLMService.complete() 无超时控制，API 挂死会导致整个请求永久卡住
预期收益: 避免 P99 延迟不可控
实现: AbortController + fetch signal, 默认超时 15s
      首次超时后自动重试 1 次（不同 model 或降级 prompt）
工作量: 3 小时
```

### 5: Token 流式输出（LLM Streaming） 🟡 P1

```
问题: 当前所有 LLM 调用都是非流式，用户等 2-8 秒才看到完整回复
预期收益: 首 token 延迟从 2-8s 降至 ~0.5s，用户感知提升显著
实现: LLMService.stream() 方法 + Socket.IO chunk push
      前端逐 token 追加渲染
工作量: 8 小时（含前后端）
```

### 6: Presale 产品查询减少 🟢 P2

```
问题: isBrowseQuery 触发的全量产品查询（limit 20）每次都走 DB
      产品数据变更频率低，全量缓存更合适
预期收益: -2 DB queries, -10ms
实现: InventoryService 增加 getAllProducts() 方法，Redis 缓存 TTL 300s
      注意: stock 字段变化时需主动失效缓存
工作量: 2 小时
```

### 7: 关键词意图分类前置 🟢 P2

```
问题: Intent classification 在 processMessage() 内、graph.invoke() 之后
      实际可前置到 Socket.IO handler 中
预期收益: Path B + Path C 的第一次 LLM 调用可与消息持久化并行
          且命中关键词时完全跳过 graph 中的 classify_intent 节点
实现: socket-server.ts 中先用关键词匹配 → 命中则直接路由
工作量: 3 小时
```

### 8: System Prompt 压缩 🟢 P2

```
问题: PRESALE_SYSTEM_PROMPT ~1500 tokens，占每次调用的 37%
      其中大量是示例性、解释性文本，可用更简洁的指令替代
预期收益: 每次售前 LLM 调用 input token 减少 ~500 (33%)
实现: Prompt 工程优化，移除冗余示例，保留核心规则
      使用 few-shot 替换长规则描述
工作量: 4 小时（需 A/B 测试验证回复质量不下降）
```

### 9: 历史消息截断策略优化 🟢 P3

```
问题: processMessage() 加载最近 20 条消息，Supervisor 取最近 10 条
      长对话中 token 消耗线性增长
预期收益: 长对话 (>10 轮) 的 token 消耗减少 30-50%
实现: 使用滑动窗口 + 摘要:
      保留最近 5 条完整消息 + 更早消息的 LLM 摘要
      摘要可存储在 conversation.metadata 中
工作量: 6 小时
```

### 10: CV 调用并行化 🟢 P3

```
问题: AfterSaleAgent 中多张图片串行分析 (for...of await)
      PresaleAgent 用 Promise.all (analyzeBatch) 但内部也是串行? 不，analyzeBatch 是 Promise.all
      
      // aftersale-agent.ts:86 — 串行!
      for (const imageUrl of ctx.imageUrls) {
        const result = await cvAdapter.analyze(imageUrl, prompt);  // 每次 await
      }
      
      // presale-agent.ts:126 — 并行 ✅
      const results = await cvAdapter.analyzeBatch(
        ctx.imageUrls!.map((url) => ({ imageUrl: url, prompt }))
      );
      
预期收益: N 张图片延迟从 N×2s → ~2s（并行）
实现: AfterSaleAgent 改用 cvAdapter.analyzeBatch()
工作量: 1 小时
```

---

## 9. 优化收益估算

### 9.1 累计收益

```
                    当前        优化后      节省
                    ─────      ─────      ────
Path A 延迟         2.0s       1.8s       -10%
Path B 延迟         4.4s       2.4s       -45%
Path C 延迟         7.8s       5.2s       -33%

Path B Token       6,540      4,000       -39%
Path C Token       4,810      4,560        -5%

每月 Token (估)    ~50M       ~35M        -30%
每月 API 费用(估)  ~$150      ~$105       -$45/月
```

### 9.2 优化优先级矩阵

```
                    收益/      实现      ROI
                    延迟       工作量
                    ────       ────     ────
1. Embedding 缓存    中         2h       ⭐⭐⭐⭐⭐
2. RAG 解耦          高         4h       ⭐⭐⭐⭐⭐
3. Embedding 全局缓存 中        3h       ⭐⭐⭐⭐
4. LLM 超时          高(稳定性) 3h       ⭐⭐⭐⭐
5. LLM Streaming     高(体验)   8h       ⭐⭐⭐
6. 产品查询缓存      低         2h       ⭐⭐⭐
7. 关键词前置        低         3h       ⭐⭐
8. Prompt 压缩       中         4h       ⭐⭐⭐
9. 历史摘要          中         6h       ⭐⭐
10. CV 并行化        中         1h       ⭐⭐⭐⭐
```

---

> **结论：单次客服请求在最慢路径 (Path C) 消耗 7.8 秒、~4,800 tokens。最大性能瓶颈是 PresaleAgent 中 RAG 生成结果的浪费（每请求 +1,500ms, +2,400 tokens）和 AfterSaleAgent 中 embedding 重复计算（每请求 +200ms）。Top 2 优化的 ROI 最高，合计 6 小时工时可将平均路径延迟降低 45%。**
