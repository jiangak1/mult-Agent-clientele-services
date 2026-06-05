# Conversation Learning Pipeline — Architecture

> 日期: 2026-06-04
> 实现: src/domains/case/services/learning-pipeline.ts
> 测试: 17/17 通过

---

## 1. 流程

```
                    ┌─────────────────────┐
                    │  closed / resolved  │
                    │       Tickets       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Stage 1: Fetch    │
                    │ (msgCount ≥ 3,      │
                    │  not yet processed) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Stage 2: Extract  │
                    │  LLM analyzes       │
                    │  conversation →     │
                    │  issue + solution   │
                    │  + confidence       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Stage 3: Evaluate │
                    │                     │
                    │  isComplete?        │
                    │  confidence ≥ 0.5?  │
                    │  qualityScore ≥ ?   │
                    └──┬──────┬──────┬────┘
                       │      │      │
              auto_approve needs_review reject
                   │      │      │
                   │  ┌───▼───┐  │
                   │  │ Human │  │
                   │  │Review │  │
                   │  │(API)  │  │
                   │  └───┬───┘  │
                   │      │      │
                   ▼      ▼      ▼
              ┌────────────────────┐
              │  Stage 4: Create   │
              │  CaseService       │
              │  .createCase()     │
              └────────┬───────────┘
                       │
              ┌────────▼───────────┐
              │  Stage 5: Index    │
              │  pgvector          │
              │  embedding         │
              └────────┬───────────┘
                       │
              ┌────────▼───────────┐
              │    Case Engine     │
              │  (searchable)      │
              └────────────────────┘
```

## 2. 决策矩阵

```
reviewDecision(result):

  isComplete=false              → reject
  confidence < 0.5              → reject
  qualityScore ≥ 0.8            }
    && confidence ≥ 0.85        } → auto_approve
  其他                          → needs_review
```

### 边界条件

| confidence | qualityScore | isComplete | 决策 |
|:----------:|:----------:|:----------:|:----:|
| 0.90 | 0.85 | true | auto_approve |
| 0.84 | 0.80 | true | needs_review |
| 0.85 | 0.79 | true | needs_review |
| 0.70 | 0.70 | true | needs_review |
| 0.30 | 0.50 | true | reject |
| 0.90 | 0.90 | false | reject |

## 3. 组件

### 3.1 ExtractionEvaluator

```
extract(input) → ExtractionResult
  ├─ 构建对话摘要 (最近20条消息, 每条≤300字符)
  ├─ LLM 调用 (temperature 0.2, JSON mode)
  ├─ 解析 + 校验
  └─ 失败时 fallback: 取最后用户消息作为 issue, resolution 作为 solution

reviewDecision(result) → auto_approve | needs_review | reject
```

### 3.2 LearningPipeline

```
run(options) → LearningBatch
  ├─ fetchClosableTickets()  → 筛选已关闭/已解决工单
  ├─ ExtractionEvaluator.extract() × N
  ├─ reviewDecision() × N
  └─ createCaseFromExtraction() × auto_approve

approveReview(tenantId, ticketId, extraction, reviewerId, modifications?)
  → 人工审核通过 → 创建 Case
```

### 3.3 ExtractionResult

```typescript
{
  issue: string;           // 客户核心问题 (≤500 chars)
  solution: string;        // 解决方案 (≤1000 chars)
  category: string | null; // defect/return/refund/...
  severity: "low"|"medium"|"high"|"critical";
  confidence: number;      // 提取置信度 0-1
  isComplete: boolean;     // issue+skill 都清晰
  qualityScore: number;    // 综合质量 0-1
  resolutionType: string | null; // refund/replacement/repair/...
  tags: string[];
  reasoning: string;       // LLM 判断理由
}
```

## 4. API

```
POST /api/cases/learn          触发学习管道
  { limit?: 20, minConfidence?: 0.85, autoCreate?: true, since?: ISO }
  → { total, autoApproved, needsReview, rejected, created, items[] }

POST /api/cases/review         人工审核
  { ticketId, extraction, action: "approve"|"reject",
    modifications?: { issue?, solution?, category?, severity? },
    reviewerId }
  → { caseId } (if approved)
```

## 5. 人工审核流程

```
1. /api/cases/learn 返回 items[].decision === "needs_review" 的项
2. 人工查看 extraction.issue / extraction.solution / extraction.reasoning
3. 可选修改 issue/solution/category/severity
4. POST /api/cases/review { action: "approve", ...modifications }
5. → pipeline 创建 Case，进入 Case Engine
```

## 6. 测试覆盖

```
17 tests, all passing

ExtractionEvaluator — reviewDecision (6):
  ✓ auto_approve: conf≥0.85 && qual≥0.8 && complete
  ✓ needs_review: medium confidence
  ✓ reject: incomplete
  ✓ reject: low confidence
  ✓ needs_review: borderline conf=0.84
  ✓ needs_review: borderline qual=0.79

acceptanceCriteria (3):
  ✓ auto-create, no review
  ✓ needs human review
  ✓ should reject

buildConversationText (3):
  ✓ role labels
  ✓ truncation at 300 chars
  ✓ last 20 messages

parseExtractionJSON (4):
  ✓ valid JSON
  ✓ confidence clamping [0,1]
  ✓ severity enum validation
  ✓ bad JSON fallback

batch summary (1):
  ✓ 2 auto + 1 review + 1 reject
```

---

> **设计总结: 6 阶段管道（Fetch→Extract→Evaluate→Create→Index→Engine），LLM 提取 + 置信度评估，人工审核 API 可修改后批准，LLM 失败时 rule-based 兜底。17 个单元测试覆盖全部决策路径和边界条件。**
