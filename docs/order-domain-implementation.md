# Order Domain Implementation Report

> 日期: 2026-06-04  
> 类型: 领域实现  
> 状态: ✅ 编译通过 (0 errors)

---

## 1. 概述

实现了完整的 Order Domain，作为系统中**所有订单数据的唯一入口**。

### 1.1 核心保证

```
所有订单查询必须经过 OrderService。
  ↓
OrderService → OrderRepository → Prisma (OrderCache / OrderItemCache / AfterSaleCache)
  ↓
TicketService.linkOrder() / getLinkedOrders()  ← 对话-订单关联
```

**其他模块 (Agent / API / Socket.IO) 禁止直接访问 OrderCache 表。**

### 1.2 当前范围

| 特性 | 状态 |
|------|:----:|
| 统一订单模型 (UnifiedOrder) | ✅ |
| OrderRepository (CRUD + Search + Aggregate) | ✅ |
| OrderService (单入口) | ✅ |
| 平台 Adapter | ❌ (未来) |
| 淘宝/PDD API 集成 | ❌ (不在本次范围) |

---

## 2. 文件清单

```
修改: prisma/schema.prisma          +5 models (OrderCache, OrderItemCache, AfterSaleCache,
                                              ConversationOrder, PlatformSkuMapping)
                                    +3 reverse relations on existing models

修改: src/domains/order/types/index.ts          完全重写 (11 接口 + 2 枚举 + 2 常量)
修改: src/domains/order/repositories/order-repository.ts  完全重写 (20 方法)
修改: src/domains/order/services/order-service.ts        完全重写 (15 公共方法)
修改: src/domains/order/index.ts                         不变 (barrel)
修改: src/domains/ticket/services/ticket-service.ts      +2 方法 (linkOrder, getLinkedOrders)

总变更: 7 文件
```

---

## 3. Prisma Schema — 新增 5 个模型

```
OrderCache          — 统一订单缓存 (平台无关)
  ├── OrderItemCache    — 订单商品行
  ├── AfterSaleCache    — 售后记录
  └── ConversationOrder — 对话-订单关联 (join)
  
PlatformSkuMapping  — 平台 SKU → 本地 Product 映射
```

### 3.1 OrderCache

```prisma
model OrderCache {
  id                String   @id @default(uuid())
  tenantId          String
  platform          String              // taobao | pinduoduo | douyin | jd | manual
  platformOrderId   String
  parentOrderId     String?
  status            String              // UnifiedOrderStatus
  platformStatus    String              // 平台原始状态 (排障用)
  totalAmount       Decimal
  shippingFee       Decimal
  discountAmount    Decimal
  originalAmount    Decimal
  buyerNick         String?
  buyerNote         String?
  receiverName      String?
  receiverPhoneHash String?             // SHA256(phone)
  receiverPhoneLast4 String?            // 后 4 位 (客服核实用)
  receiverProvince  String?
  receiverCity      String?
  receiverDistrict  String?
  receiverAddress   String?
  orderCreatedAt    DateTime
  paidAt            DateTime?
  shippedAt         DateTime?
  deliveredAt       DateTime?
  completedAt       DateTime?
  cancelledAt       DateTime?
  customerUserId    String?             // FK → CustomerUser (可选)
  platformData      Json                // 平台原始 JSON
  lastSyncedAt      DateTime

  @@unique([tenantId, platform, platformOrderId])
  @@index([tenantId, status])
  @@index([tenantId, orderCreatedAt])
  @@index([tenantId, receiverPhoneHash, receiverPhoneLast4])
  @@index([tenantId, customerUserId])
}
```

### 3.2 关联图

```
Tenant 1──N OrderCache 1──N OrderItemCache
                    │   1──N AfterSaleCache
                    │   1──N ConversationOrder N──1 Conversation
                    │
CustomerUser ───────┘ (customerUserId, 非强制 FK)

Product 1──N PlatformSkuMapping (SKU 映射)
```

---

## 4. OrderRepository — 20 个方法

### 4.1 单订单查询

| 方法 | 说明 |
|------|------|
| `findById(tenantId, orderId)` | 按内部 ID 查（含 items + afterSales） |
| `findByPlatformId(tenantId, platform, platformOrderId)` | 按平台订单号查 |
| `findByIds(tenantId, orderIds)` | 批量查（含 items） |

### 4.2 批量查询

| 方法 | 说明 |
|------|------|
| `findByStatus(tenantId, status[], limit)` | 按状态筛选 |
| `findByCustomer(tenantId, customerUserId, limit)` | 按客户 ID 查 |
| `findByPhone(tenantId, phone, limit)` | 按收货电话查（SHA256 hash 匹配） |
| `search(params)` | 多条件搜索 + 排序 + 分页 |

### 4.3 写入

| 方法 | 说明 |
|------|------|
| `upsert(input)` | 创建或更新订单（幂等） |
| `updateStatus(...)` | 更新订单状态 + 时间戳 |
| `upsertAfterSale(input)` | 创建或更新售后记录 |

### 4.4 关联

| 方法 | 说明 |
|------|------|
| `linkToConversation(conversationId, orderId)` | 关联对话-订单 |
| `getConversationOrders(conversationId)` | 获取对话关联的所有订单 |
| `mapSku(tenantId, platform, platformSkuId, productId)` | 创建 SKU 映射 |
| `getSkuMapping(tenantId, platform, platformSkuId)` | 查询 SKU 映射 |

### 4.5 聚合

| 方法 | 说明 |
|------|------|
| `computeSummary(params)` | 计算订单汇总（byStatus / byPlatform / revenue / avg） |

### 4.6 数据安全

```
收货电话存储:
  原始: 13812345678
  存储: receiverPhoneHash = SHA256("13812345678")
        receiverPhoneLast4 = "5678"
  
  查询: findByPhone("13812345678") → hash + last4 → 精确匹配
  客户标识: 客服看到 last4 用于核实身份，完整号码不可见
```

---

## 5. OrderService — 15 个公共方法

```
OrderService
├── READ — Single
│   ├── getOrder(tenantId, orderId) → UnifiedOrder | null
│   ├── getOrderByPlatformId(tenantId, platform, orderId) → UnifiedOrder | null
│   └── getOrdersByIds(tenantId, orderIds) → UnifiedOrder[]
│
├── READ — Query
│   ├── searchOrders(params) → PaginatedResult<UnifiedOrder>
│   ├── getCustomerOrders(tenantId, customerUserId, limit?) → UnifiedOrder[]
│   ├── getOrdersByStatus(tenantId, status[], limit?) → UnifiedOrder[]
│   └── getOrdersForConversation(conversationId) → UnifiedOrder[]
│
├── WRITE
│   ├── upsertOrder(input) → string (orderId)
│   └── updateOrderStatus(tenantId, orderId, status, platformStatus, timestamps?) → void
│
├── After-Sale
│   ├── upsertAfterSale(input) → void
│   └── getAfterSales(tenantId, orderId) → UnifiedAfterSale[]
│
├── Linkage
│   └── linkToConversation(conversationId, orderId) → void
│
├── SKU Mapping
│   ├── mapPlatformSku(tenantId, platform, platformSkuId, productId) → void
│   └── resolvePlatformSku(tenantId, platform, platformSkuId) → entry | null
│
└── Aggregation
    └── computeSummary(params) → OrderSummary
```

---

## 6. 集成点

### 6.1 Ticket ↔ Order

```typescript
// TicketService.linkOrder() — 在对话中关联订单
await TicketService.linkOrder(ticketId, orderId);

// TicketService.getLinkedOrders() — 获取对话关联的所有订单
const orders = await TicketService.getLinkedOrders(ticketId);
// → [{ platform: "taobao", platformOrderId: "...", status: "paid", ... }]
```

### 6.2 未来 Agent 集成（示例，未实现）

```typescript
// 在 PresaleAgent / AfterSaleAgent 中:

import { OrderService } from "@/domains/order";

// 客户咨询时自动加载关联订单
const linkedOrders = await OrderService.getOrdersForConversation(conversationId);

// 按客户 ID 查找历史订单
const customerOrders = await OrderService.getCustomerOrders(tenantId, userId);

// 搜索跨平台订单
const result = await OrderService.searchOrders({
  tenantId,
  platforms: ["taobao", "jd"],
  status: [UnifiedOrderStatus.Paid, UnifiedOrderStatus.Shipped],
  page: 1,
  pageSize: 10,
});
```

---

## 7. 使用示例

### 7.1 手动录入订单（模拟或人工）

```typescript
import { OrderService, UnifiedOrderStatus } from "@/domains/order";

await OrderService.upsertOrder({
  tenantId: "xxx",
  platform: "manual",
  platformOrderId: "MANUAL-2026-001",
  status: UnifiedOrderStatus.Paid,
  platformStatus: "paid",
  totalAmount: 8999.00,
  buyerNick: "张三",
  receiver: {
    name: "张三",
    phoneLast4: "5678",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    address: "科技园路1号",
  },
  items: [{
    platformSkuId: "IP16-256-NT",
    platformItemId: "item-1",
    title: "iPhone 16 Pro 256GB",
    price: 8999.00,
    quantity: 1,
  }],
  customerUserId: "user-uuid-here",
});
```

### 7.2 查询

```typescript
// 按平台订单号查
const order = await OrderService.getOrderByPlatformId(
  tenantId, "taobao", "1234567890123456789"
);

// 全文搜索
const result = await OrderService.searchOrders({
  tenantId,
  status: [UnifiedOrderStatus.Paid, UnifiedOrderStatus.Shipped],
  startTime: new Date("2026-05-01"),
  endTime: new Date("2026-06-01"),
  page: 1,
  pageSize: 20,
});
// result.summary = { totalOrders, byStatus, byPlatform, totalRevenue, avgOrderValue }
```

---

## 8. 编译验证

```
$ npx tsc --noEmit
  0 errors (all files, excl. __tests__ and node_modules)

$ npx prisma generate
  ✔ Generated Prisma Client (v6.19.3)
```

---

## 9. 后续扩展路径

### Phase 2: 平台 Adapter（每个 2-3 天）

```
实现 OrderAdapter 接口 → 在 OrderService 方法内部按需调用平台 API
例如: OrderService.getOrder() {
  1. 先查 OrderCache
  2. 未命中或 TTL 过期 → 调用平台 Adapter.getOrder()
  3. 结果 upsert 回 OrderCache
  4. 返回 UnifiedOrder
}
```

### Phase 3: Agent 集成（1 天）

```
PresaleAgent  / AfterSaleAgent 通过 TicketService.getLinkedOrders() 获取上下文
↓
LLM Prompt 注入订单信息 → 更精准的客服回复
```

### Phase 4: Webhook 实时同步（2-3 天）

```
接收平台订单变更推送 → upsertOrder / updateOrderStatus / upsertAfterSale
```

---

> **实现总结: 5 个新 Prisma 模型、19 个 Repository 方法、15 个 Service 公共方法、Ticket 域种集成 2 个方法。无平台 API 集成，所有操作基于本地 OrderCache 表。编译通过。**
