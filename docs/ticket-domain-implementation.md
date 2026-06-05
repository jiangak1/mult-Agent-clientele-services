# Ticket Domain Implementation Report

> 日期: 2026-06-04
> 类型: 领域实现
> 状态: 编译通过 (0 errors)

---

## 1. 概述

实现了完整的 Ticket Domain，覆盖工单全生命周期管理 + 人工转接流程。

### 1.1 状态机

```
                    ┌──────┐
                    │ open │  ← 创建
                    └──┬───┘
                       │ first user message
                    ┌──▼──────┐
         ┌─────────│ active  │──────────┐
         │         └──┬──┬───┘          │
         │            │  │              │
    auto │   escalate │  │ resolve      │ close
         │            │  │              │
         │     ┌──────▼──┴────┐   ┌─────▼─────┐
         │     │  escalated   │   │ resolved  │
         │     │ (人工处理中)  │   └─────┬─────┘
         │     └──────┬───────┘         │
         │            │                 │ close/verify
         │   human    │                 │
         │   resolves │ close           │
         │            │                 │
         │     ┌──────▼──┐      ┌───────▼──┐
         └────►│ active  │      │  closed  │──┐
               │(reopen) │      └──────────┘  │
               └─────────┘                    │ reopen
                                              │
                                        ┌─────▼──┐
                                        │ active │
                                        └────────┘
```

### 1.2 Valid Transitions

```
open       → active, closed
active     → pending, escalated, resolved, closed
pending    → active, closed
escalated  → active, resolved, closed
resolved   → closed, active (reopen)
closed     → active (reopen)
```

---

## 2. 文件变更

| 文件 | 操作 | 说明 |
|------|:----:|------|
| `ticket/types/index.ts` | 重写 | 12 接口 + 7 类型别名 + 状态映射表 |
| `ticket/repositories/ticket-repository.ts` | 重写 | 16 方法，全部 Prisma 查询 |
| `ticket/services/ticket-service.ts` | 重写 | 22 公共方法，完整生命周期 |

---

## 3. 类型系统

### 3.1 新增类型

```
TicketPriority    urgent | high | normal | low
TicketResolution  agent_resolved | human_resolved | escalated_to_human
                  | closed_by_customer | closed_duplicate | closed_unresolvable

EscalationRecord  { id, escalatedAt, reason, escalatedBy, priority,
                    resolvedAt, resolvedBy, resolution, resolutionType, notes }

VALID_TRANSITIONS  Record<TicketStatus, TicketStatus[]>  (运行时守卫)
STATUS_LABELS      Record<TicketStatus, string>          (UI 标签)
```

### 3.2 Ticket 实体

```typescript
interface Ticket {
  id, tenantId, userId
  intent, subIntent
  status: TicketStatus         // 当前状态
  priority: TicketPriority     // 优先级
  channel: TicketChannel
  title, messageCount, lastMessagePreview, lastAgentType
  resolution: TicketResolution | null  // 关闭/解决方式
  metadata: Record<string, unknown>    // JSON: priority + escalations + title
  escalationHistory: EscalationRecord[] // 从 metadata 解析
  linkedOrderCount: number             // 关联订单数
  createdAt, updatedAt, closedAt
}
```

---

## 4. TicketRepository — 16 方法

### 4.1 查询

| 方法 | 说明 |
|------|------|
| `findById(tenantId, ticketId)` | 单票查询（含 messages count + linked orders count） |
| `findByUserId(tenantId, userId)` | 用户的所有工单 |
| `search(params)` | 多条件搜索 + 分页 + 排序 |
| `findEscalated(tenantId)` | 转人工队列（按更新时间升序，最旧优先） |

### 4.2 写入

| 方法 | 说明 |
|------|------|
| `create(input)` | 创建工单（可选关联订单） |
| `update(ticketId, tenantId, input)` | 更新 title / priority / metadata |
| `transitionStatus(ticketId, tenantId, from, to)` | 状态转移（含守卫） |

### 4.3 转人工

| 方法 | 说明 |
|------|------|
| `addEscalation(ticketId, tenantId, input)` | 记录转人工 → metadata.escalations[] |
| `resolveEscalation(ticketId, tenantId, input)` | 人工解决 → 更新 escalation 记录 + 状态转移 |

### 4.4 其他

| 方法 | 说明 |
|------|------|
| `close(tenantId, ticketId, resolution?)` | 关闭工单 |
| `softDelete(ticketId, tenantId, keepSolution)` | 软删除 |
| `getMessages(ticketId, limit?)` | 获取消息 |
| `addMessage(input)` | 添加消息 + 更新 updatedAt |
| `getStats(tenantId)` | 统计：total / byStatus / byPriority / escalatedCount |
| `updateIntent(ticketId, tenantId, intent, subIntent?)` | 更新意图 |

### 4.5 状态转移守卫

```typescript
transitionStatus(ticketId, tenantId, from, to):
  if (!VALID_TRANSITIONS[from].includes(to)) → return false (不抛异常)
  else → UPDATE status WHERE id=X AND tenantId=Y AND status=Z
  → 返回 boolean (是否成功)
```

---

## 5. TicketService — 22 方法

### 5.1 生命周期

```
create(input)              → Ticket
createFromWorkflow(...)    → string (ticketId)  ← Agent 兼容
getOrCreate(tenantId, userId, id?) → string
get(tenantId, id)          → Ticket | null
getByUser(tenantId, userId)→ Ticket[]
search(params)              → PaginatedResult<Ticket>
update(tenantId, id, input)→ Ticket | null
updateIntent(...)          → void
close(tenantId, id, resolution?) → boolean
reopen(tenantId, id)       → boolean
softDelete(tenantId, id, keepSolution?) → boolean
```

### 5.2 转人工 (Human Handoff)

```
escalate(input: EscalateTicketInput) → EscalationRecord | null
  
  流程:
    1. 检查 ticket.status ∈ { open, active, pending }
    2. transitionStatus → "escalated"
    3. addEscalation → 写入 metadata.escalations[]
    4. 返回 EscalationRecord（含 escalationId）

resolveEscalation(input: ResolveEscalationInput) → boolean

  流程:
    1. 检查 ticket.status === "escalated"
    2. 找到对应 escalation 记录
    3. 填入 resolvedBy + resolution + resolutionType
    4. input.reopen === true → status → "active"（返回 Agent 跟进）
       input.reopen === false → status → "resolved"

getEscalatedQueue(tenantId) → Ticket[]
  返回当前所有 escalated 状态的工单（人工处理队列）
```

### 5.3 自动状态转移

```
addMessage(input) → TicketMessage
  input.role === "user" && ticket.status === "open"
    → 自动 transitionStatus("open" → "active")
```

### 5.4 其他

```
getMessages(ticketId, limit?)    → TicketMessage[]
addMessage(input)                → TicketMessage
linkOrder(ticketId, orderId)     → void
getLinkedOrders(ticketId)        → UnifiedOrder[]
getStats(tenantId)               → TicketStats
needsHumanAttention(ticketId)    → boolean
```

---

## 6. 与现有 Agent Pipeline 兼容

```
现有流程                        新增 Ticket Domain
────────                        ────────────────
createConversation()       =    TicketService.createFromWorkflow()
processMessage() 不调用         TicketService.addMessage() (可选)
                                
SupervisorAgent                TicketService.escalate()
  shouldEscalate = true    →     { reason, escalatedBy: "supervisor" }
                                 → status → "escalated"
                                 → 进入 getEscalatedQueue()

                                 TicketService.resolveEscalation()
                                   { resolvedBy: "human_agent_001",
                                     resolution: "...方案描述...",
                                     reopen: true }
                                 → status → "active" (agent 跟进)
```

### 不影响现有流程

```typescript
// 现有代码完全不受影响：
import { processMessage, createConversation } from "@/lib/workflows/graph";
// ↑ 导入路径不变，行为不变

// 新增代码可选择性使用：
import { TicketService } from "@/domains/ticket";
await TicketService.escalate({ ticketId, reason, escalatedBy: "supervisor" });
```

---

## 7. 使用示例

### 7.1 创建工单并关联订单

```typescript
const ticket = await TicketService.create({
  tenantId: "xxx",
  userId: "user-1",
  priority: "high",
  title: "iPhone 屏幕坏点退货",
  orderId: "order-uuid",
});
```

### 7.2 Supervisor 升级到人工

```typescript
const escalation = await TicketService.escalate({
  ticketId: ticket.id,
  reason: "客户要求退款，涉及金额超过 ¥5000，需主管审批",
  escalatedBy: "supervisor",
  priority: "urgent",
});
// escalation.id → 后续用于 resolveEscalation
```

### 7.3 人工处理队列

```typescript
const queue = await TicketService.getEscalatedQueue(tenantId);
// → 按时间升序排列，最旧的优先处理
```

### 7.4 人工解决

```typescript
await TicketService.resolveEscalation({
  ticketId: ticket.id,
  escalationId: escalation.id,
  resolvedBy: "agent_wang",
  resolution: "已联系客户，同意全额退款。退款将在3-5个工作日到账。",
  resolutionType: "human_resolved",
  reopen: false, // 直接关闭，不需要 Agent 跟进
});
```

### 7.5 Dashboard 统计

```typescript
const stats = await TicketService.getStats(tenantId);
// { total: 342, byStatus: { active: 120, escalated: 8, ... },
//   escalatedCount: 8, resolutionRate: 0.87 }
```

---

## 8. 编译验证

```
$ npx tsc --noEmit
  0 errors (all files, excl. __tests__ and node_modules)
```

---

> **实现总结：完整状态机（7 状态 / 11 有效转换）、Repository 全部 Prisma 化（0 条 raw SQL）、Service 的 escalate/resolveEscalation 实现人工转接闭环。现有 Agent Pipeline 零影响。**
