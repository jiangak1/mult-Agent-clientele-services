# Case Engine Implementation Report

> 日期: 2026-06-04
> 类型: 领域实现
> 状态: 编译通过 (0 errors), 测试 13/13 通过

---

## 1. 概述

实现了完整的 Case Engine，基于 PostgreSQL + pgvector（无 Milvus 依赖）。

### 1.1 核心架构

```
┌────────────────────────────────────────────────┐
│                  CaseService                    │
│  (编排: CRUD + Search + Feedback)              │
└──────┬──────────┬──────────┬──────────────────┘
       │          │          │
       ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│CaseMatcher│ │CaseRanker│ │Embedding │
│(hybrid)  │ │(quality) │ │Provider  │
└────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │
     └────────────┼────────────┘
                  │
           ┌──────▼──────┐
           │CaseRepository│
           │(pgvector)   │
           └──────┬──────┘
                  │
           ┌──────▼──────┐
           │ PostgreSQL   │
           │ + pgvector   │
           │ + pg_trgm    │
           └─────────────┘
```

### 1.2 数据模型

```
Case {
  id                UUID        PK
  tenantId          UUID        FK → Tenant
  productId         UUID?       关联产品
  issue             TEXT        客户问题描述
  solution          TEXT        解决方案
  category          VARCHAR(200)
  severity          VARCHAR(50)
  status            VARCHAR(50)
  successRate       FLOAT       成功率 (0.0-1.0)
  satisfactionScore FLOAT       满意度 (1.0-5.0)
  resolutionCount   INT         解决次数
  feedbackCount     INT         评价次数
  embedding         vector(1024) pgvector
  ticketId          VARCHAR(100)
  tags              TEXT[]
  metadata          JSONB
  createdAt         TIMESTAMP
  updatedAt         TIMESTAMP
}
```

---

## 2. 文件清单

```
新增 (7):
  src/domains/case/types/index.ts                   重写 — 简化 CaseRecord
  src/domains/case/repositories/case-repository.ts  重写 — pgvector (无Milvus)
  src/domains/case/services/case-matcher.ts         新增 — hybrid matcher
  src/domains/case/services/case-ranker.ts          新增 — quality ranker
  src/domains/case/services/case-service.ts         重写 — orchestrator
  src/app/api/cases/route.ts                        新增 — REST API
  src/app/api/cases/[id]/route.ts                   新增 — GET/PATCH
  src/app/api/cases/[id]/feedback/route.ts          新增 — POST feedback

修改 (3):
  prisma/schema.prisma                              +Case model, +extensions
  src/domains/case/index.ts                         +CaseMatcher, +CaseRanker export
  vitest.config.ts                                  新增 — path alias

测试 (1):
  src/domains/case/__tests__/case-engine.test.ts    13 tests, all passing
```

---

## 3. CaseMatcher — 多策略匹配

### 3.1 策略矩阵

```
matchMode    vector     keyword    fusion
────────     ──────     ───────    ──────
vector       ✅ 单独    ❌         —
keyword      ❌         ✅ 单独    —
hybrid       ✅         ✅         α×0.6 + β×0.4
```

### 3.2 Vector Match (pgvector)

```sql
SELECT *, 1 - (embedding <=> $1::vector) AS "vectorScore"
FROM "Case"
WHERE "tenantId" = $2
  AND embedding IS NOT NULL
  AND 1 - (embedding <=> $1::vector) >= $3   -- minScore filter
ORDER BY embedding <=> $1::vector
LIMIT $4
```

### 3.3 Keyword Match (pg_trgm)

```sql
SELECT *,
  GREATEST(similarity("issue", $2), similarity("solution", $2)) AS "keywordScore"
FROM "Case"
WHERE "tenantId" = $1
  AND (similarity("issue", $2) > 0.1 OR similarity("solution", $2) > 0.1)
ORDER BY "keywordScore" DESC
LIMIT $3
```

### 3.4 Embedding Text

```
embeddingText = `${issue} ${issue} ${solution}`
                  ↑  issue 重复 2 次增加语义权重
```

---

## 4. CaseRanker — 质量感知排序

### 4.1 公式

```
finalScore = w1 × matchScore + w2 × qualityScore + w3 × freshnessScore

qualityScore   = 0.4 × successRate + 0.6 × (satisfactionScore / 5.0)
freshnessScore = e^(-0.01 × daysSinceUpdate)

然后乘以 severityBoost:
  critical: ×1.3   high: ×1.2   medium: ×1.0   low: ×0.8

最后 diversified: 保证至少 2 个不同 category
```

### 4.2 权重

| 权重 | 值 | 说明 |
|------|:--:|------|
| match | 0.55 | 相似度主导 |
| quality | 0.30 | 成功率+满意度质量信号 |
| freshness | 0.15 | 时间衰减，半衰期 69 天 |

---

## 5. CaseRepository — pgvector 数据访问

### 5.1 方法清单

```
CRUD:
  findById(tenantId, caseId) → CaseRecord | null
  create(input, embedding)   → CaseRecord
  update(tenantId, caseId, input, embedding?) → boolean

Search:
  searchByVector(tenantId, embedding, topK, minScore, filters?) → CaseRecord[]
  searchByKeyword(tenantId, query, limit) → CaseRecord[]
  list(tenantId, options?) → { rows, total }

Feedback:
  recordFeedback(tenantId, caseId, rating, isResolved) → boolean

Embedding:
  getEmbedding(caseId) → number[] | null
  updateEmbedding(caseId, embedding) → void
```

---

## 6. REST API

```
POST   /api/cases                          创建案例 (issue + solution 必填)
GET    /api/cases                          列表 (分页, category/productId 过滤)
GET    /api/cases?search=...               搜索相似案例 (mode=hybrid|vector|keyword)
GET    /api/cases/:id                      案例详情
PATCH  /api/cases/:id                      更新案例 (solution/category/severity/status/...)
POST   /api/cases/:id/feedback             提交评价 (rating 1-5, isResolved)
```

### 6.1 搜索请求示例

```
GET /api/cases?search=屏幕出现坏点怎么处理&mode=hybrid&topK=5&category=defect

Response:
{
  "success": true,
  "data": [
    {
      "case": { "id": "..", "issue": "屏幕坏点", "solution": "7天内可换新", ... },
      "score": 0.89,
      "matchDetails": {
        "vectorScore": 0.92,
        "keywordScore": 0.78,
        "qualityBoost": 0.87,
        "finalScore": 0.91
      }
    }
  ]
}
```

### 6.2 评价请求示例

```
POST /api/cases/:id/feedback
{ "rating": 5, "isResolved": true, "comment": "方案有效" }

→ 更新 satisfactionScore: (4.5 × 15 + 5) / 16 = 4.53
→ 更新 successRate: (12 + 1) / 16 = 0.81
→ 更新 feedbackCount: 16
→ 更新 resolutionCount: 13
```

---

## 7. 测试覆盖

```
13 tests, all passing (vitest, 184ms)

CaseMatcher (2):
  ✓ buildEmbeddingText weights issue ×2 over solution
  ✓ issue appears twice in embedding text

CaseRanker — qualityScore (3):
  ✓ high quality            (0.9 SR + 4.8 sat → >0.8)
  ✓ low quality             (0.3 SR + 2.0 sat → <0.5)
  ✓ no feedback → neutral   (0 feedback → 0.5)

CaseRanker — freshnessScore (3):
  ✓ just now → near 1.0
  ✓ 1 year ago → near 0
  ✓ 69 days → ~0.5 (half-life)

CaseRanker — severityBoost (1):
  ✓ critical > high > medium > low

CaseRanker — rank() (3):
  ✓ quality beats raw match score
  ✓ preserves descending order
  ✓ matchDetails populated after ranking

CaseRanker — diversify() (1):
  ✓ mixed categories kept unique
```

---

## 8. 编译验证

```
$ npx tsc --noEmit     → 0 errors
$ npx vitest run       → 13/13 passed
$ npx prisma generate  → success
```

---

> **实现总结: PostgreSQL + pgvector 存储，no Milvus。CaseMatcher (hybrid: vector×0.6 + keyword×0.4)、CaseRanker (quality + freshness + diversity)。REST API 6 端点，13 个单元测试全部通过。**
