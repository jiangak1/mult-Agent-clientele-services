# Case Engine 设计文档

> 版本: v1.0
> 日期: 2026-06-04
> 目标: 沉淀历史售后经验，实现案例全生命周期管理 + 智能检索 + 效果度量

---

## 1. 数据库设计

### 1.1 ER 图

```
┌──────────┐         ┌──────────────────┐
│  Tenant  │ 1───N  │   SupportCase    │  ← 主案例表（重命名自 ComplaintCase）
└──────────┘         └────────┬─────────┘
                              │
               ┌──────────────┼──────────────┐
               │              │              │
         1───N │        1───N │        1───N │
               ▼              ▼              ▼
     ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
     │ CaseMessage │  │ CaseFeedback │  │ CaseOutcome  │
     │ (聊天记录)   │  │ (客户评价)    │  │ (处理结果)    │
     └─────────────┘  └──────────────┘  └──────────────┘
                               │
                         1───N │
                               ▼
                      ┌────────────────┐
                      │ CaseTemplate   │  ← 可复用解决方案模板
                      └────────────────┘
                               │
                         1───N │
                               ▼
                      ┌────────────────┐
                      │ CaseTag        │  ← 多标签分类
                      └────────────────┘
```

### 1.2 表说明

| 表 | 行数估算 | 用途 |
|----|:------:|------|
| **SupportCase** | 万级/租户 | 核心案例记录 |
| **CaseOutcome** | 1:1 | 处理结果 + 用时 + 成本 |
| **CaseFeedback** | 1:N | 客户满意度 + NPS |
| **CaseMessage** | ~10/案例 | 案例关联的对话片段 |
| **CaseTemplate** | 百级/租户 | 提炼的标准解决方案模板 |
| **CaseTag** | N:M | 多标签分类（缺陷/物流/退款/换货/投诉...） |
| **CaseMetric** | 1:N (时序) | 案例效果指标快照 |

### 1.3 状态机

```
                    ┌─────────┐
                    │  open   │  ← 创建（Agent 自动或人工创建）
                    └────┬────┘
                         │ triage
                    ┌────▼────┐
                    │investigating│ ← 人工或 Agent 正在处理
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌─────────┐ ┌────────┐ ┌──────────┐
        │resolved │ │pending │ │duplicate │ ← 关闭原因
        │         │ │(等待客户)│ │(重复案例) │
        └────┬────┘ └───┬────┘ └──────────┘
             │          │
             │    ┌─────▼─────┐
             │    │ resolved  │ ← 客户回应后
             │    └─────┬─────┘
             │          │
        ┌────▼──────────▼────┐
        │     verified       │ ← 客户确认解决 / 反馈收集完成
        └────────┬───────────┘
                 │
        ┌────────▼───────────┐
        │     archived       │ ← 超过 N 天 / 手动归档
        └────────────────────┘

非法转换: archived → open (需通过 clone)
```

---

## 2. Prisma Schema

### 2.1 完整 Schema

```prisma
// ============================================
// SupportCase — 核心案例表
// ============================================
model SupportCase {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @db.Uuid
  conversationId  String?  @db.Uuid           // 来源会话（可空，支持人工录入）

  // 案例内容
  title           String   @db.VarChar(500)
  description     String   @db.Text            // 客户问题原始描述
  category        String?  @db.VarChar(200)    // 主分类: defect|return|refund|logistics|complaint|tech_support
  subCategory     String?  @db.VarChar(200)    // 子分类: screen_defect|battery|wrong_color|...

  // 严重度 & 优先级
  severity        CaseSeverity @default(medium)
  priority        CasePriority @default(normal)

  // 状态
  status          CaseStatus @default(open)

  // 向量 embedding (pgvector, 1024-dim)
  embedding       Unsupported("vector(1024)")?

  // 富媒体
  imageUrls       String[] @default([])

  // 关联
  assignedTo      String?  @db.VarChar(255)    // 受理人 ID
  duplicateOf     String?  @db.Uuid            // 指向重复案例

  // 时间线
  triagedAt       DateTime?
  resolvedAt      DateTime?
  verifiedAt      DateTime?
  archivedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  tags            CaseTagOnCase[]
  outcomes        CaseOutcome[]
  feedbacks       CaseFeedback[]
  messages        CaseMessage[]
  template        CaseTemplate? @relation(fields: [templateId], references: [id])
  templateId      String?       @db.Uuid

  @@index([tenantId, status])
  @@index([tenantId, category])
  @@index([tenantId, severity])
  @@index([tenantId, createdAt])
  @@index([tenantId, resolvedAt])
}

// ============================================
// CaseOutcome — 处理结果
// ============================================
model CaseOutcome {
  id             String   @id @default(uuid()) @db.Uuid
  caseId         String   @db.Uuid
  resolution     String   @db.Text             // 解决方案描述
  resolutionType ResolutionType                 // refund|replacement|repair|compensation|apology|no_action
  effortMinutes  Int?                          // 处理耗时（分钟）
  costAmount     Decimal? @db.Decimal(10, 2)   // 处理成本（退款金额/补偿金额）
  isAutomated    Boolean  @default(false)      // 是否自动解决
  agentType      String?  @db.VarChar(100)     // 哪个 Agent 解决的
  metadata       Json     @default("{}")
  createdAt      DateTime @default(now())

  case SupportCase @relation(fields: [caseId], references: [id])

  @@index([caseId])
}

// ============================================
// CaseFeedback — 客户满意度
// ============================================
model CaseFeedback {
  id             String   @id @default(uuid()) @db.Uuid
  caseId         String   @db.Uuid
  userId         String?  @db.Uuid             // 评价人 ID
  rating         Int                           // 1-5 星
  nps            Int?                          // NPS 评分 0-10
  comment        String?  @db.Text             // 文字评价
  tags           String[] @default([])         // 评价标签: friendly|fast|unsatisfactory|confusing...
  isResolved     Boolean?                      // 客户是否认为已解决
  createdAt      DateTime @default(now())

  case SupportCase @relation(fields: [caseId], references: [id])

  @@index([caseId])
  @@index([caseId, rating])
}

// ============================================
// CaseTemplate — 可复用解决方案模板
// ============================================
model CaseTemplate {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @db.Uuid
  title           String   @db.VarChar(500)
  description     String   @db.Text             // 适用问题描述
  solution        String   @db.Text             // 标准解决方案
  category        String?  @db.VarChar(200)
  embedding       Unsupported("vector(1024)")?

  // 效果统计（冗余字段，定期从 CaseMetric 聚合更新）
  useCount        Int      @default(0)         // 被引用次数
  successRate     Float?                       // 成功率 (0.0-1.0)
  avgRating       Float?                       // 平均满意度 (1.0-5.0)
  avgEffortMin    Int?                         // 平均处理耗时

  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant          Tenant          @relation(fields: [tenantId], references: [id])
  cases           SupportCase[]

  @@index([tenantId, category])
  @@index([tenantId, useCount])
}

// ============================================
// CaseTag — 多标签
// ============================================
model CaseTag {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @db.Uuid
  name      String   @db.VarChar(100)
  color     String?  @db.VarChar(20)         // UI 展示颜色
  createdAt DateTime @default(now())

  cases CaseTagOnCase[]

  @@unique([tenantId, name])
}

model CaseTagOnCase {
  caseId String
  tagId  String
  case   SupportCase @relation(fields: [caseId], references: [id])
  tag    CaseTag     @relation(fields: [tagId], references: [id])

  @@id([caseId, tagId])
}

// ============================================
// CaseMessage — 案例关联对话片段
// ============================================
model CaseMessage {
  id        String   @id @default(uuid()) @db.Uuid
  caseId    String   @db.Uuid
  role      String   @db.VarChar(50)         // user | assistant
  content   String   @db.Text
  index     Int                              // 在案例中的顺序
  createdAt DateTime @default(now())

  case SupportCase @relation(fields: [caseId], references: [id])

  @@index([caseId, index])
}

// ============================================
// CaseMetric — 效果指标（时序快照）
// ============================================
model CaseMetric {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @db.Uuid

  // 聚合维度
  period            String   @db.VarChar(20)     // daily|weekly|monthly
  periodStart       DateTime
  periodEnd         DateTime

  // 案例统计
  totalCases        Int
  resolvedCases     Int
  automatedCases    Int
  escalatedCases    Int
  avgResolutionMin  Float?
  avgRating         Float?
  avgNps            Float?

  // 按分类拆分 (JSON)
  byCategory        Json

  createdAt         DateTime @default(now())

  @@unique([tenantId, period, periodStart])
  @@index([tenantId, periodStart])
}

// ============================================
// Enums
// ============================================
enum CaseStatus {
  open
  investigating
  resolved
  pending          // 等待客户确认/回复
  duplicate
  verified
  archived
}

enum CaseSeverity {
  low
  medium
  high
  critical
}

enum CasePriority {
  low
  normal
  high
  urgent
}

enum ResolutionType {
  refund
  replacement
  repair
  compensation
  apology
  no_action
  information_only
  escalated_external
}
```

### 2.2 与现有 ComplaintCase 的差异

```
现有 ComplaintCase          → 新 SupportCase
─────────────────────────    ────────────────────
title                        title (不变)
description                  description (不变)
category                     category + subCategory (拆分)
severity                     severity (枚举化) + priority (新增)
resolution                   CaseOutcome.resolution (外移)
imageUrls                    imageUrls (不变)
embedding                    embedding (不变) + CaseTemplate.embedding (新增)
resolvedAt                   resolvedAt + triagedAt + verifiedAt + archivedAt (完整时间线)
metadata                     — (拆分到具体字段)
—                            assignedTo (新增)
—                            duplicateOf (新增)
—                            templateId (新增)
```

---

## 3. API 设计

### 3.1 REST Endpoints

```
Base: /api/cases

POST   /api/cases                         创建案例
GET    /api/cases                         列表查询 (支持 status/category/severity/date 过滤 + 分页)
GET    /api/cases/:id                     案例详情
PATCH  /api/cases/:id                     更新案例（状态流转、分配、打标签）
DELETE /api/cases/:id                     软删除（仅 open/duplicate 状态）

POST   /api/cases/:id/outcomes            记录处理结果
GET    /api/cases/:id/outcomes            案例的所有处理记录

POST   /api/cases/:id/feedback            提交客户满意度评价
GET    /api/cases/:id/feedback            查看评价

POST   /api/cases/search                  相似案例搜索
POST   /api/cases/search-by-image         以图搜案例

GET    /api/cases/:id/related             相关案例 (同产品/同分类/同客户)
POST   /api/cases/:id/clone               克隆案例
POST   /api/cases/:id/escalate            升级案例
POST   /api/cases/:id/resolve             标记解决 (含 outcome)
POST   /api/cases/:id/verify              客户确认解决
POST   /api/cases/:id/archive             归档

POST   /api/cases/:id/link-messages       关联对话消息到案例

POST   /api/templates                     创建解决方案模板
GET    /api/templates                     模板列表
PATCH  /api/templates/:id                 更新模板
POST   /api/templates/:id/apply           应用模板到案例

GET    /api/tags                          租户标签列表
POST   /api/tags                          创建标签

GET    /api/case-metrics                  效果统计 (period + start/end)
```

### 3.2 关键接口规格

#### 3.2.1 相似案例搜索

```
POST /api/cases/search
Content-Type: application/json

Request:
{
  "query": "屏幕出现坏点，刚买一周",
  "category": "defect",              // 可选，限制分类范围
  "severity": ["medium", "high"],    // 可选，限制严重度
  "topK": 5,
  "minScore": 0.6,                   // 最低相似度
  "includeResolvedOnly": true,       // 只看已解决
  "matchMode": "hybrid"              // keyword | vector | hybrid | template
}

Response:
{
  "success": true,
  "data": {
    "matches": [
      {
        "case": {
          "id": "...",
          "title": "MacBook Pro 屏幕坏点 - 7天内",
          "severity": "high",
          "status": "verified",
          "category": "defect",
          "subCategory": "screen_defect"
        },
        "score": 0.89,
        "matchDetails": {
          "vectorScore": 0.92,
          "keywordScore": 0.78,
          "categoryBoost": 1.1
        },
        "resolution": {
          "type": "replacement",
          "summary": "7天内检测确认为出厂缺陷，已换新",
          "effortMinutes": 45,
          "successRate": 0.94
        },
        "template": {
          "id": "...",
          "title": "屏幕缺陷-7天内-快速换新",
          "useCount": 23,
          "avgRating": 4.8
        }
      }
    ],
    "total": 12,
    "searchMs": 85
  }
}
```

#### 3.2.2 效果统计

```
GET /api/case-metrics?period=weekly&start=2026-05-01&end=2026-06-01

Response:
{
  "success": true,
  "data": [
    {
      "period": "weekly",
      "periodStart": "2026-05-25",
      "periodEnd": "2026-06-01",
      "totalCases": 342,
      "resolvedCases": 298,
      "automatedCases": 201,
      "escalatedCases": 15,
      "avgResolutionMin": 28.5,
      "avgRating": 4.3,
      "avgNps": 7.8,
      "resolutionRate": 0.87,
      "automationRate": 0.59,
      "byCategory": {
        "defect":     { "total": 120, "resolved": 105, "avgRating": 4.1 },
        "return":     { "total": 85,  "resolved": 78,  "avgRating": 4.5 },
        "logistics":  { "total": 45,  "resolved": 38,  "avgRating": 3.9 },
        "complaint":  { "total": 30,  "resolved": 25,  "avgRating": 4.0 },
        "tech_support": { "total": 62, "resolved": 52, "avgRating": 4.6 }
      }
    }
  ]
}
```

---

## 4. Matcher 设计

### 4.1 多策略匹配架构

```
                        POST /api/cases/search
                               │
                    ┌──────────▼──────────┐
                    │   MatcherRouter     │  ← 根据 matchMode 选择策略
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ KeywordMatcher   │  │ VectorMatcher    │  │ TemplateMatcher  │
│ (pg_trgm + FTS)  │  │ (Milvus/pgvector)│  │ (向量 + 分类匹配) │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    HybridMatcher    │  ← 融合 + 重排序
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │      Ranker         │  ← 最终排序
                    └─────────────────────┘
```

### 4.2 各 Matcher 详解

#### KeywordMatcher

```
算法: PostgreSQL full-text search (pg_trgm) + zhparser (中文分词)
索引: GIN index on title + description (to_tsvector)
适用: 精确关键词匹配，产品名/SKU/故障现象关键词
参数:
  - similarity_threshold: 0.15 (pg_trgm word_similarity)
  - tsquery_weight: title:A | description:B

SQL 概念:
  SELECT *, 
    ts_rank(to_tsvector('zh', title || ' ' || description), plainto_tsquery('zh', :query)) as rank
  FROM "SupportCase"
  WHERE to_tsvector('zh', title || ' ' || description) @@ plainto_tsquery('zh', :query)
    AND "tenantId" = :tenantId
    AND status IN ('resolved', 'verified')
  ORDER BY rank DESC
  LIMIT :limit;
```

#### VectorMatcher

```
算法: Milvus ANN (Approximate Nearest Neighbor) + pgvector (fallback)
索引: IVF_FLAT (当前) → 建议升级 HNSW
维度: 1024-dim (BGE-M3)
相似度: COSINE
过滤: tenant_id == "{tenantId}" AND status NOT IN ('archived')
参数:
  - topK: 10 (候选集，给 Ranker 二次排序留空间)
  - nprobe: 16 (IVF_FLAT 搜索范围)
  - min_score: 0.6 (cosine threshold)

Milvus query 概念:
  {
    collection_name: "support_cases",
    vectors: [query_embedding],
    topk: topK,
    metric_type: "COSINE",
    filter: 'tenant_id == "{tenantId}" && status in ["resolved", "verified"]',
    output_fields: ["id", "title", "category", "severity", "resolution_type"],
    search_params: { nprobe: 16 }
  }
```

#### TemplateMatcher

```
算法: 先按 category + subCategory 缩小范围，再向量匹配
候选集: CaseTemplate where tenantId + category + isActive
排序: COSINE similarity + useCount boost + successRate boost
适用: 标准问题（已提炼为模板的高频案例）
参数:
  - category_boost: 1.5 (同分类加权)
  - min_use_count: 3 (至少被引用 3 次的模板才推荐)
```

#### HybridMatcher

```
融合公式:
  finalScore = α * vectorScore + β * keywordScore + γ * templateScore + boost

其中:
  α = 0.5  向量权重（语义相似度）
  β = 0.3  关键词权重（术语匹配）
  γ = 0.2  模板权重（标准化方案）

boost = categoryBoost * resolutionBoost * timeDecay

  categoryBoost    = 1.0 + (sameCategory ? 0.2 : 0.0)
  resolutionBoost  = 1.0 + (hasVerifiedResolution ? 0.15 : 0.0)
  timeDecay        = e^(-λ * daysSinceResolved)
                   = e^(-0.01 * daysSinceResolved)
                   30天 → 0.74
                   90天 → 0.41
                   365天 → 0.03
```

### 4.3 Milvus Collection Schema（案例专用）

```typescript
// 独立于现有 knowledge_base / complaint_cases 的第三个 collection
const SUPPORT_CASE_COLLECTION = {
  name: "support_cases",
  fields: [
    { name: "id",              data_type: "VarChar", max_length: 64, is_primary_key: true },
    { name: "tenant_id",       data_type: "VarChar", max_length: 64 },
    { name: "title",           data_type: "VarChar", max_length: 500 },
    { name: "description",     data_type: "VarChar", max_length: 65535 },
    { name: "category",        data_type: "VarChar", max_length: 200 },
    { name: "sub_category",    data_type: "VarChar", max_length: 200 },
    { name: "severity",        data_type: "VarChar", max_length: 20 },
    { name: "status",          data_type: "VarChar", max_length: 20 },
    { name: "resolution_type", data_type: "VarChar", max_length: 30 },
    { name: "embedding",       data_type: "FloatVector", dim: 1024 },
    { name: "resolution_text", data_type: "VarChar", max_length: 65535 },
    { name: "success_rate",    data_type: "Float" },
  ],
  index: {
    field_name: "embedding",
    index_type: "HNSW",     // 升级 IVF_FLAT → HNSW（更高召回率）
    metric_type: "COSINE",
    params: { M: 16, efConstruction: 200 },
  },
  partition_key: "tenant_id",   // Milvus 2.4+ 物理租户隔离
  search_params: { ef: 64 },
};
```

---

## 5. Ranker 设计

### 5.1 排序管道

```
候选集 (topK=10 from Matcher)
  │
  ▼
Step 1: 相似度归一化 (MinMaxScaler)
  │
  ▼
Step 2: 质量信号注入
  ├─ resolutionQuality  = hasVerifiedResolution ? (avgRating / 5.0) : 0.3
  ├─ templateQuality    = templateSuccessRate ?? 0.5
  └─ freshness          = e^(-λ * daysSinceResolved)
  │
  ▼
Step 3: 业务信号注入
  ├─ severityBoost      = { critical: 1.3, high: 1.2, medium: 1.0, low: 0.8 }
  ├─ categoryMatch      = sameCategory ? 1.15 : 1.0
  └─ resolutionTypePref = 客户偏好分辨率类型加权（如客户要求退款 → refund weight +0.1）
  │
  ▼
Step 4: 去重 & 多样性
  ├─ 同 template 的案例只保留最高分一个
  └─ 至少保留 1 个不同 resolutionType 的案例（多样性）
  │
  ▼
Step 5: 最终排序 → TopK
```

### 5.2 排序公式

```
RankScore(i) = w1 * normalizedSimilarity(i)
             + w2 * resolutionQuality(i)
             + w3 * freshness(i)
             + w4 * severityBoost(i)
             * categoryMatch(i)

权重:
  w1 = 0.45  相似度（核心）
  w2 = 0.25  解决质量（成功率+满意度）
  w3 = 0.15  时效性
  w4 = 0.15  严重度匹配

范围: 0.0 - 1.0
```

### 5.3 Ranker 配置（可程序化调整）

```typescript
interface RankerConfig {
  weights: {
    similarity: number;      // default: 0.45
    quality: number;         // default: 0.25
    freshness: number;       // default: 0.15
    severity: number;        // default: 0.15
  };
  timeDecay: {
    lambda: number;          // default: 0.01
    halfLife: number;        // default: 69 (days)
  };
  severityBoost: Record<string, number>;  // { critical: 1.3, ... }
  minResults: number;        // default: 3
  diversity: {
    enabled: boolean;
    minUniqueResolutions: number;  // default: 2
  };
}

// 可通过 AgentConfig 按租户自定义
```

---

## 6. Embedding 策略

### 6.1 文本拼接策略

```
案例 embedding 输入文本构建:

  title_weight: ×2
  description_weight: ×1
  resolution_weight: ×1.5 (如果已解决)

  embeddingText = 
    (title + " ") * 2 +
    description +
    (resolution ? " " + resolution : "") * 1.5

  示例:
    title: "MacBook Pro 屏幕坏点 - 7天内"
    description: "客户于2026-05-20购买...发现屏幕有3个明显坏点..."
    resolution: "经检测确认为出厂缺陷，已办理换新，客户满意"

    embeddingText = 
      "MacBook Pro 屏幕坏点 - 7天内 MacBook Pro 屏幕坏点 - 7天内 " +
      "客户于2026-05-20购买...发现屏幕有3个明显坏点... " +
      "经检测确认为出厂缺陷，已办理换新，客户满意 经检测确认为出厂缺陷，已办理换新，客户满意"

  查询 embedding 输入文本:
    embeddingText = (query + " ") * 2 + (category ? category : "")
    // query 重复2次提升语义权重
```

### 6.2 Embedding 缓存策略

```
层级 1 — 请求级缓存 (Map<textHash, embedding>):
  - 同一请求内相同文本不重复计算
  - 生命周期: 单次 HTTP 请求

层级 2 — Redis 缓存:
  - Key: emb:{model}:{md5(text)}
  - TTL: 3600s (1小时)
  - 适用: 热门 FAQ / 模板的 embedding

层级 3 — DB 持久化:
  - SupportCase.embedding / CaseTemplate.embedding
  - 创建/更新时计算并存储
  - 定期 re-index (模型版本变更时)
```

### 6.3 模型版本管理

```
┌─────────────────────────────────────────┐
│         Embedding 模型版本控制            │
├─────────────────────────────────────────┤
│ 当前模型: BGE-M3 (1024-dim)             │
│ 模型版本: "bge-m3-v1"                   │
│                                         │
│ 版本存储在 config.llm.embeddingModel    │
│ DB 中不存版本（仅在 Redis key 中标明）   │
│                                         │
│ 模型升级流程:                            │
│  1. 新模型并行部署 (不改现有)            │
│  2. 写入时双写 (新旧模型各一份 embedding) │
│  3. 查询时用新模型                       │
│  4. 异步 backfill 旧数据                 │
│  5. 切换完成后删除旧 embedding            │
└─────────────────────────────────────────┘
```

### 6.4 Re-index 策略

```
触发条件:
  - case title/description/resolution 更新时 → 实时重算
  - 模型版本升级时 → 批量异步 re-index

批量 Re-index:
  1. 查询所有 isActive 的 SupportCase
  2. 分批 (batchSize=100) 调用 embedding API
  3. 更新 SupportCase.embedding
  4. 同步更新 Milvus (upsert)
  5. 更新 CaseTemplate.embedding

  预估: 10,000 个案例 × 200ms/批 ÷ 100/批 = 20s
        每月执行一次 (模型升级时)

增量 Re-index:
  - 监听 SupportCase.updatedAt > lastReindexAt
  - 每分钟执行一次 (cron)
  - 每次处理 ≤ 100 条
```

---

## 7. 数据生命周期

### 7.1 状态流转与自动操作

```
状态              自动操作                    手动操作
────              ────────                   ────────
open              -                          分配受理人、添加标签
  ↓
investigating     -                          填写调查备注
  ↓
resolved          创建 CaseOutcome            选择 resolutionType
  ↓                                            填写退款金额等
pending           等待客户确认                 -
  (3天未确认 → 自动 verified)
  ↓
verified          记录 CaseFeedback           -
  (无反馈 → rating=null)
  ↓
archived          计算 CaseMetric 聚合        -
  (90天后自动归档)
```

### 7.2 数据保留策略

```
阶段          期限        操作
────          ────        ────
活跃          0-90 天     正常查询、统计、匹配
温存          90-365 天   参与统计，降低搜索权重 (freshness decay)
冷存          365+ 天     仅统计聚合，不参与实时搜索 (status=cold)
删除          按合规要求    GDPR 删除请求 → 清空 PII，保留脱敏统计

自动清理:
  1. open 状态超过 30 天未更新 → 自动 close (标记为 stale)
  2. duplicate 状态超过 7 天 → 自动 archived
  3. archived 超过 365 天 → 标记为 cold（从 Milvus 移除）
```

### 7.3 统计指标更新

```
CaseMetric 聚合频率:

  daily:   每天 00:00 计算前一天指标 → 写入 CaseMetric
  weekly:  每周一 00:00 计算上周指标
  monthly: 每月 1 日 00:00 计算上月指标

聚合维度:
  - 案例总量 / 解决量 / 升级量 / 自动解决量
  - 平均处理时间 / 平均满意度 / 平均 NPS
  - 按 category / severity / resolutionType 拆分
  - 按 Agent 拆分（各 Agent 的解决率）

CaseTemplate 效果更新:
  - 每次 feedback 提交后 → 重算关联模板的 successRate / avgRating
  - 每次 case resolved 后 → 更新模板的 useCount
```

### 7.4 Milvus 数据同步

```
写入同步:
  SupportCase 创建 → 同步计算 embedding → insert Milvus
  SupportCase 更新 → 同步重新计算 embedding → upsert Milvus
  SupportCase 归档 → 异步从 Milvus 删除 → 7天内可恢复

一致性保证:
  - 写入: 先写 PostgreSQL（主） → 再写 Milvus（从）
  - Milvus 写入失败 → 不阻断案例创建，异步重试
  - 定期对账: 每天比较 PG 和 Milvus 的 active 案例 ID 列表
    → 差异自动修复

异常处理:
  - Milvus 不可用 → 降级到 pgvector (SupportCase.embedding)
  - Embedding API 不可用 → 案例创建成功，embedding=null
    → 定时任务补齐缺失的 embedding
```

---

## 8. 与现有 Agent Pipeline 集成

### 8.1 AfterSaleAgent 升级

```
现有: AfterSaleAgent.execute()
  ├─ ComplaintService.searchSimilarCases() → 仅用 Milvus 搜索
  ├─ RAGEngine.query("aftersale") → 另一条搜索路径
  └─ shouldEscalate() → 简单规则

升级后: AfterSaleAgent.execute()
  ├─ CaseEngine.search()
  │    ├─ MatcherRouter → HybridMatcher
  │    └─ Ranker → 返回 TopK 案例 + 模板
  ├─ 基于匹配结果决策
  │    ├─ 高置信度匹配 (>0.85) → 直接推荐模板方案
  │    ├─ 中置信度 (0.6-0.85) → LLM 生成 + 模板参考
  │    └─ 低置信度 (<0.6) → LLM 自由生成
  └─ 自动生成 CaseOutcome
       ├─ 基于匹配模板 → resolutionType = template.type
       └─ 新问题 → resolutionType = null (需人工填)
```

### 8.2 闭环反馈

```
用户发送问题
  ↓
CaseEngine.search() → 匹配历史案例
  ↓
Agent 基于匹配结果回复
  ↓
用户确认解决 / 提交评价
  ↓
CaseEngine.recordFeedback() → 更新案例指标
  ↓
CaseTemplate.successRate 更新
  ↓
下次搜索时该模板权重变化 → 质量闭环
```

---

## 9. 实施路线图

```
Phase 1: Schema & Storage (1 周)
  ├─ Prisma Migration: ComplaintCase → SupportCase + 新表
  ├─ Milvus 新 collection: support_cases
  └─ 数据迁移脚本

Phase 2: Matcher & Ranker (1 周)
  ├─ KeywordMatcher (pg_trgm + zhparser)
  ├─ VectorMatcher (Milvus HNSW)
  ├─ HybridMatcher (融合逻辑)
  └─ Ranker (排序管道)

Phase 3: API & Integration (1 周)
  ├─ REST API 实现
  ├─ CaseEngine 核心类
  └─ AfterSaleAgent 集成

Phase 4: Feedback & Metrics (1 周)
  ├─ CaseFeedback 收集
  ├─ CaseMetric 定时聚合
  ├─ CaseTemplate 自动提取（高频相似案例 → 模板）
  └─ Dashboard 数据接口

Total: 4 周
```

---

> **设计总结：Case Engine 将当前散落在 ComplaintService / RAGEngine / AfterSaleAgent 中的案例搜索与管理逻辑收敛为统一引擎。核心创新点：(1) 多策略 Hybrid Matcher (2) 质量感知 Ranker 将成功率/满意度纳入排序 (3) CaseTemplate 将已验证方案模板化 (4) 闭环反馈让系统随使用持续进化。**
