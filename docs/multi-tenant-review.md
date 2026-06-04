# 多租户数据隔离审计报告

> 审计日期：2026-06-04  
> 范围：Prisma Schema (9 models) + 5 API Routes + 4 Services + Socket.IO + MCP Server + RLS Policy  
> 目标：面向电商 SaaS 的多商家数据隔离能力  

---

## 1. 执行摘要

当前项目在 **Schema 设计层面**具备多租户基础（9 张表中有 7 张含 `tenantId`），但在 **查询层**、**RLS 覆盖**、**文件存储** 和 **Message 表** 存在 8 个关键缺口。其中 **Message 表缺 tenantId** 和 **文件上传无租户隔离** 属于高级别风险，需在 SaaS 化之前修复。

```
整体评分： 6.5 / 10

Schema 设计  ████████░░  8/10  (7/9 表有 tenantId)
RLS 覆盖     ██████░░░░  6/10  (8/9 表启用，Message 缺失)
查询层安全   █████░░░░░  5/10  (部分查询绕过 tenantId)
API 鉴权     ██████░░░░  6/10  (Header 鉴权 + 无 token 验证)
文件存储     ███░░░░░░░  3/10  (无租户隔离)
审计追踪     █░░░░░░░░░  1/10  (AuditLog 表从未写入)
```

---

## 2. 逐表审计

### 2.1 表清单总览

| # | 表名 | 有 tenantId | RLS 已启用 | RLS Policy 已定义 | 代码使用 withTenant() |
|---|------|:----------:|:---------:|:---------------:|:-------------------:|
| 1 | Tenant | N/A (根实体) | — | — | N/A |
| 2 | CustomerUser | ✅ | ✅ | ✅ | ❌ 直接 prisma |
| 3 | Conversation | ✅ | ✅ | ✅ | ❌ 直接 prisma |
| 4 | **Message** | **❌** | **❌** | **❌** | ❌ 直接 prisma |
| 5 | KnowledgeBase | ✅ | ✅ | ✅ | — (未在代码中查询) |
| 6 | ComplaintCase | ✅ | ✅ | ✅ | ✅ |
| 7 | Product | ✅ | ✅ | ✅ | ✅ |
| 8 | **UserMemory** | **❌** | ✅ (子查询) | ✅ (子查询) | **❌ 直接 prisma** |
| 9 | AgentConfig | ✅ | ✅ | ✅ | ❌ 从未查询 |
| 10 | AuditLog | ✅ | ✅ | ✅ | ❌ 从未写入 |

### 2.2 高风险表的详细分析

#### 2.2.1 Message — 最高风险 ❌❌❌

```sql
-- 当前 Schema
model Message {
  id             String   @id
  conversationId String                        -- FK → Conversation
  role           String
  agentType      String?
  content        String   @db.Text
  metadata       Json
  createdAt      DateTime

  -- ❌ 无 tenantId 字段
  -- ❌ 无 RLS 启用
  -- ❌ 依赖 Conversation.tenantId 间接隔离
}
```

**问题链：**

```
Message 查询路径：
  API → prisma.message.findMany({ where: { conversationId } })
                                      ↑
                          仅 conversationId 过滤，无 tenantId 验证

如果攻击者获取了另一个租户的 conversationId：
  → 可以读取该会话的所有消息
  → 可以越权向该会话写入消息
  → 可以删除该会话的消息
```

**受影响的所有查询（共 6 处）：**

| 文件 | 行 | 查询 | tenantId 过滤 |
|------|----|------|:-----------:|
| graph.ts | 283-287 | `message.findMany({ conversationId })` | ❌ |
| graph.ts | 299-306 | `message.create({ conversationId })` | ❌ |
| graph.ts | 359-368 | `message.create({ conversationId })` | ❌ |
| chat/route.ts | 85-91 | `message.findMany({ conversationId })` | ❌ |
| conversations/route.ts | 81-85 | `message.findMany({ conversationId })` | ❌ |
| conversations/route.ts | 116, 123 | `message.deleteMany({ conversationId })` | ❌ |

**PoC 攻击场景：**
```bash
# 租户 A 的 conversationId 是已知的（如通过 URL 枚举）
curl -H "x-tenant-id: tenant_b" \
     "http://localhost:3000/api/chat?conversationId=<tenant_a_conversation_id>"
# → 成功返回租户 A 的消息内容（如果服务器未额外验证 conversation 归属）
```

**注意**：`chat/route.ts:85` 的 GET 接口仅用 `withTenant` 包裹了查询，而 `withTenant` 设置 `app.current_tenant_id` 但不修改 WHERE 条件。由于 Message 表无 RLS，`withTenant` 对 Message 查询无任何保护作用。

#### 2.2.2 UserMemory — 缺 tenantId ❌❌

```sql
model UserMemory {
  id     String   @id
  userId String                              -- FK → CustomerUser
  key    String
  value  Json
  ttl    Int?
  -- ❌ 无 tenantId 字段
}
```

**问题：**

1. **Schema 层面**：缺少 `tenantId`，只能通过 `userId → CustomerUser → tenantId` 间接关联
2. **RLS 层面**：`post-migrate.sql:33` 用子查询补救：
   ```sql
   CREATE POLICY tenant_isolation ON "UserMemory"
     FOR ALL USING (
       "userId" IN (SELECT id FROM "CustomerUser" WHERE "tenantId" = get_current_tenant_id())
     );
   ```
   但这依赖每次查询前调用 `set_tenant_context()`，而代码中的 `LongTermMemory` 类**从未调用 `withTenant()`**。

3. **代码层面**：`long-term-memory.ts` 所有查询直接用 `prisma.userMemory.*`，无 tenantId 过滤、无 `withTenant` 调用：
   ```typescript
   // long-term-memory.ts:25 — 查询不经过 withTenant
   const record = await prisma.userMemory.findUnique({
     where: { userId_key: { userId, key: `${namespace}:${key}` } },
   });
   ```

**跨租户泄露场景：**
- 租户 A 的 user_1 和租户 B 的 user_2 如果 userId 相同（不同租户的用户可能有相同 userId 吗？不会，因为 CustomerUser.id 是 UUID，全局唯一）
- 但 Memory key 冲突：如果两个租户恰好在 LongTermMemory 中用了相同的 `namespace:key`，且代码未设 `current_tenant_id`，RLS 的子查询会返回空 → 查询返回 null
- 实际风险：**读不到而非读到别人的数据**（取决于 RLS 是否真正执行）

#### 2.2.3 文件上传 — 无租户隔离 ❌❌

```typescript
// upload/route.ts
const UPLOAD_DIR = join(process.cwd(), "uploads");
// ...
await writeFile(join(UPLOAD_DIR, filename), buffer);
urls.push(`/uploads/${filename}`);
```

**问题：**
1. 所有租户的文件存入同一个 `./uploads/` 目录
2. 无租户子目录分离
3. 生成的 URL 是 `/uploads/{nanoid}.{ext}`，任何知道文件名的人都可以访问
4. 无访问控制中间件
5. 无 tenantId 校验

**修复方向：**
```
./uploads/
  ├── tenant_a/
  │   └── {nanoid}.jpg
  └── tenant_b/
      └── {nanoid}.jpg

GET /uploads/{tenantId}/{filename} → 验证 tenantId 匹配请求头
```

#### 2.2.4 Conversation — 路径穿越风险 ⚠️

```typescript
// conversations/route.ts:68 — DELETE 操作正确验证了 tenantId
const conv = await prisma.conversation.findFirst({
  where: { id: conversationId, tenantId: tenant.tenantId },
});
if (!conv) return 404;

// 但删除消息时仅用 conversationId
await prisma.message.deleteMany({ where: { conversationId } });  // ← 无 tenantId
await prisma.conversation.delete({ where: { id: conversationId } }); // ← 已通过 findFirst 验证
```

`findFirst` 验证了 tenantId，之后的 `delete` 依赖同一请求上下文。这是**时序安全**，可以接受，但不是深度防御。

### 2.3 低风险表（合规）

| 表 | 评价 |
|----|------|
| **Tenant** | 根实体，无需 tenantId |
| **CustomerUser** | ✅ tenantId + RLS + 联合唯一索引 `[tenantId, externalId]` |
| **KnowledgeBase** | ✅ tenantId + RLS + pgvector |
| **ComplaintCase** | ✅ tenantId + RLS + 双向量索引（PG + Milvus） |
| **Product** | ✅ tenantId + RLS + `[tenantId, sku]` 唯一约束 |
| **AgentConfig** | ✅ Schema 设计好，但代码未使用 |
| **AuditLog** | ✅ Schema 设计好，但代码未写入 |

---

## 3. API 逐接口审计

### 3.1 接口清单

| 接口 | 方法 | 租户识别 | 查询 tenantId 过滤 | 评分 |
|------|------|---------|-------------------|:----:|
| `/api/chat` | POST | ✅ Header `x-tenant-id` | ❌ Message 查询无 tenantId | 🔴 |
| `/api/chat` | GET | ✅ Header `x-tenant-id` | ⚠️ `withTenant` 但 Message 无 RLS | 🟡 |
| `/api/conversations` | GET | ✅ Header | ✅ `{ tenantId, userId }` 过滤 | 🟢 |
| `/api/conversations` | DELETE | ✅ Header | ✅ `findFirst` 校验 tenantId | 🟢 |
| `/api/products` | GET | ✅ Header | ✅ `{ tenantId, isActive }` 过滤 | 🟢 |
| `/api/products` | POST | ✅ Header | ✅ `tenantId` 写入 | 🟢 |
| `/api/products` | PUT | ✅ Header | ⚠️ `findUnique({ id })` 后手工校验 tenantId | 🟡 |
| `/api/products` | DELETE | ✅ Header | ⚠️ `findUnique({ id })` 后手工校验 tenantId | 🟡 |
| `/api/agents` | GET | ❌ **无 tenantId 提取** | ❌ Agent 列表全局共享 | 🟡 |
| `/api/upload` | POST | ❌ **无 tenantId 提取** | ❌ 文件存储无租户分离 | 🔴 |

### 3.2 鉴权机制分析

```typescript
// tenant-middleware.ts:9 — 当前鉴权方式
export function extractTenant(headers: Headers): TenantContext {
  const tenantId = headers.get("x-tenant-id") ?? "default";  // ← 无 token 验证
  const userId = headers.get("x-user-id") ?? undefined;
  return { tenantId, userId, bypassRls: false };
}
```

**问题：**
1. **无加密签名验证** — 仅读取明文 header，无 JWT/session token 校验
2. **默认 tenantId** — 未传 header 时返回 `"default"`，可能意外落入默认租户
3. **无 userId 强制** — `userId` 为 `undefined` 时部分接口仍继续处理
4. **`verifyJwt()` 函数存在但从未被调用** — `tenant-middleware.ts:23` 定义了 JWT 验证函数，但所有 API 都使用 `extractTenant()` 而非 `verifyJwt()`

---

## 4. withTenant() 使用一致性审计

### 4.1 withTenant 的实现

```typescript
// db-client.ts:17-43
export async function withTenant<T>(
  tenant: TenantContext,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  await prisma.$executeRawUnsafe(
    `SELECT set_tenant_context($1::uuid)`, tenant.tenantId,
  );
  try {
    return await fn(prisma);
  } finally {
    await prisma.$executeRawUnsafe(`RESET app.current_tenant_id`);
  }
}
```

`withTenant()` **仅设置 PostgreSQL session 变量**，不修改 Prisma 查询的 WHERE 条件。这意味着：
- 对于已启用 RLS 的表 → 保护生效（PG 自动注入 WHERE 条件）
- 对于未启用 RLS 的表（如 Message）→ **零保护**

### 4.2 使用矩阵

| 调用位置 | 使用 withTenant | 影响 |
|---------|:------------:|------|
| graph.ts — processMessage | ❌ 直接 prisma | Message 读/写无租户隔离 |
| graph.ts — createConversation | ❌ 直接 prisma | 但传入了 tenantId 参数 ✅ |
| chat/route.ts — GET messages | ❌ withTenant | 但 Message 表无 RLS，等于无效 |
| chat/route.ts — POST | ❌ 直接 prisma (间接) | 通过 processMessage |
| conversations/route.ts — DELETE | ❌ 直接 prisma | 但手动校验了 tenantId |
| inventory-service.ts — queryProducts | ✅ withTenant | Product 有 RLS，生效 |
| inventory-service.ts — checkStock | ✅ withTenant | Product 有 RLS，生效 |
| complaint-service.ts — createCase | ✅ withTenant | 生效 |
| complaint-service.ts — searchSimilarCases | ❌ 直接 prisma | 但 WHERE 手动加了 tenantId |
| long-term-memory.ts — ALL | ❌ 直接 prisma | ⚠️ 高风险：UserMemory 无 tenantId |

---

## 5. Socket.IO 租户隔离

```typescript
// socket-server.ts:24-38
io.use(async (socket, next) => {
  const tenantId = socket.handshake.auth.tenantId || socket.handshake.query.tenantId;
  const userId = socket.handshake.auth.userId || socket.handshake.query.userId;
  if (!tenantId || !userId) {
    return next(new Error("Authentication required"));
  }
  socket.data.tenantId = tenantId;
  socket.data.userId = userId;
  next();
});
```

**评价：**
- ✅ 连接时验证 tenantId + userId 存在
- ✅ `socket.join(\`tenant:${tenantId}\`)` 房间隔离
- ❌ 无 token 验证（明文传参）
- ❌ 未验证 tenantId 对应的 tenant 是否存在/活跃

---

## 6. Milvus 向量存储隔离

```typescript
// milvus-client.ts:103-109
const results = await client.search({
  collection_name: collection,
  vectors: [embedding],
  topk: topK,
  filter: `tenant_id == "${tenantId}"`,  // ← 字符串拼接
  output_fields: ["id", "content", "metadata"],
});
```

**评价：**
- ✅ 每次查询都带 tenantId 过滤
- ⚠️ 过滤条件通过**字符串拼接**构建，存在注入风险（如果 tenantId 来自不可信输入）
- ❌ Milvus 没有启用 RBAC（Role-Based Access Control）
- ❌ 没有使用 Milvus Partition Key 做租户物理隔离

**注入风险示例：**
```typescript
// 如果 tenantId = 'x" || true || "'
// → filter: tenant_id == "x" || true || ""
// → 绕过所有租户过滤，返回全量数据
```
*缓解：当前 tenantId 来源于 header，攻击者已可通过改 header 切换租户。但如果未来 tenantId 来自用户输入（如 URL params），此注入可能被利用。*

---

## 7. MCP Server 审计

```typescript
// mcp/server.ts:226
const res = await fetch(`${CSP_API_URL}${endpoint}`, {
  headers: { "x-tenant-id": "default", "x-user-id": "mcp-system" },
});
```

**问题：**
- ❌ **硬编码 `"default"` 租户** — 资源读取始终以 default 租户身份进行
- ❌ MCP tools 接受 `tenantId` 参数，但无验证该 tenantId 是否存在
- ⚠️ `csp.list_agents` 返回全局 Agent 列表，不区分租户

---

## 8. 风险矩阵

| # | 风险 | 严重度 | 影响范围 | 是否可被远程利用 |
|---|------|:------:|---------|:--------------:|
| 1 | Message 表缺 tenantId + 无 RLS | 🔴 高 | 所有消息读写 | 是（需知 conversationId） |
| 2 | 文件上传无租户隔离 | 🔴 高 | 所有上传文件 | 是（URL 可猜测） |
| 3 | LongTermMemory 无 tenantId + 不用 withTenant | 🟡 中 | 用户偏好/投诉上下文 | 可能（userId 需已知） |
| 4 | withTenant 未覆盖全部写路径 | 🟡 中 | graph.ts / chat route | 部分（依赖 RLS 间接保护） |
| 5 | extractTenant 无 token 验证 | 🟡 中 | 所有 API | 是（改 header 即切换租户） |
| 6 | AgentConfig / AuditLog 未使用 | 🟢 低 | 运维/审计 | 否 |
| 7 | Milvus 过滤条件字符串拼接 | 🟢 低 | 向量搜索 | 需要可控输入 |
| 8 | MCP Server 硬编码 default 租户 | 🟢 低 | MCP 工具 | 需要 MCP 客户端连接 |

---

## 9. 推荐迁移方案

### 9.1 Phase 1 — 紧急修复（1 周）

#### Migration 1: Message 表添加 tenantId

```sql
-- 步骤 1: 添加可空列
ALTER TABLE "Message" ADD COLUMN "tenantId" UUID;

-- 步骤 2: 从关联的 Conversation 回填数据
UPDATE "Message" m
SET "tenantId" = c."tenantId"
FROM "Conversation" c
WHERE m."conversationId" = c.id;

-- 步骤 3: 设为 NOT NULL
ALTER TABLE "Message" ALTER COLUMN "tenantId" SET NOT NULL;

-- 步骤 4: 添加索引
CREATE INDEX "Message_tenantId_conversationId_idx" ON "Message" ("tenantId", "conversationId");
CREATE INDEX "Message_tenantId_createdAt_idx" ON "Message" ("tenantId", "createdAt");

-- 步骤 5: 启用 RLS
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message"
  FOR ALL USING ("tenantId" = get_current_tenant_id());
```

#### Migration 2: UserMemory 添加 tenantId

```sql
-- 步骤 1: 添加可空列
ALTER TABLE "UserMemory" ADD COLUMN "tenantId" UUID;

-- 步骤 2: 从 CustomerUser 回填
UPDATE "UserMemory" m
SET "tenantId" = u."tenantId"
FROM "CustomerUser" u
WHERE m."userId" = u.id;

-- 步骤 3: NOT NULL
ALTER TABLE "UserMemory" ALTER COLUMN "tenantId" SET NOT NULL;

-- 步骤 4: 重建 RLS Policy（使用直接的 tenantId 而非子查询）
DROP POLICY IF EXISTS tenant_isolation ON "UserMemory";
CREATE POLICY tenant_isolation ON "UserMemory"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

-- 步骤 5: 添加索引
CREATE INDEX "UserMemory_tenantId_userId_idx" ON "UserMemory" ("tenantId", "userId");
```

#### 代码改造: Message 查询加 tenantId

```typescript
// graph.ts:283 — 修改前
const history = await prisma.message.findMany({
  where: { conversationId: config.conversationId },
});

// graph.ts:283 — 修改后
const history = await prisma.message.findMany({
  where: {
    conversationId: config.conversationId,
    tenantId: config.tenantId,  // ← 新增
  },
});

// graph.ts:300 — message.create 也需要加 tenantId
const userMsg = await prisma.message.create({
  data: {
    conversationId: config.conversationId,
    tenantId: config.tenantId,  // ← 新增
    role: "user",
    content: message,
    metadata: imageUrls ? { imageUrls } : {},
  },
});
```

### 9.2 Phase 2 — 加固（2 周）

#### 2.1 文件上传增加租户子目录

```typescript
// upload/route.ts — 修改方案
const tenantId = req.headers.get("x-tenant-id");
if (!tenantId) return 403;

const tenantDir = join(UPLOAD_DIR, sanitizePath(tenantId));
await mkdir(tenantDir, { recursive: true });
await writeFile(join(tenantDir, filename), buffer);
urls.push(`/uploads/${tenantId}/${filename}`);
```

#### 2.2 JWT 鉴权集成

```typescript
// 所有 API 替换 extractTenant → verifyJwt
// tenant-middleware.ts:23 的 verifyJwt 函数已实现，只需接入

// chat/route.ts — 修改前
const tenant = extractTenant(req.headers);

// chat/route.ts — 修改后
const token = req.headers.get("authorization")?.replace("Bearer ", "");
const tenant = token ? await verifyJwt(token) : null;
if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

#### 2.3 withTenant 全路径覆盖

确保所有数据访问都通过 `withTenant()` 或显式 WHERE tenantId。建议：
- graph.ts 中所有 `prisma.*` 调用改为 `withTenant(tenantCtx, ...)`
- long-term-memory.ts 所有查询加 tenantId

### 9.3 Phase 3 — 完善（3 周）

#### 3.1 激活 AgentConfig

```typescript
// 从 DB 加载租户级 Agent 配置
const agentConfig = await prisma.agentConfig.findMany({
  where: { tenantId, isActive: true },
});
// 按配置定制 Agent behavior（启用/禁用、temperature、System Prompt override）
```

#### 3.2 激活 AuditLog

在以下事件写入审计日志：
- 用户发送消息
- Agent 做出决策
- 升级/转人工
- 管理员操作（产品 CRUD）
- 文件上传

#### 3.3 Milvus 加固

```typescript
// 1. 对 tenantId 做输入校验
const sanitizedId = tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
const filter = `tenant_id == "${sanitizedId}"`;

// 2. 启用 Milvus Partition Key (v2.4+)
// collection 创建时设置 partition_key_field: "tenant_id"
```

---

## 10. Prisma Migration 草案

### migration_YYYYMMDD_add_tenant_to_message/migration.sql

```sql
-- Step 1: Add tenantId column to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

-- Step 2: Backfill from parent Conversation
UPDATE "Message" m
SET "tenantId" = c."tenantId"
FROM "Conversation" c
WHERE m."conversationId" = c.id
  AND m."tenantId" IS NULL;

-- Step 3: Verify no NULLs remain
DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "Message" WHERE "tenantId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION '% Message rows have NULL tenantId after backfill', null_count;
  END IF;
END $$;

-- Step 4: Set NOT NULL
ALTER TABLE "Message" ALTER COLUMN "tenantId" SET NOT NULL;

-- Step 5: Add indexes
CREATE INDEX IF NOT EXISTS "Message_tenantId_conversationId_idx"
  ON "Message" ("tenantId", "conversationId");
CREATE INDEX IF NOT EXISTS "Message_tenantId_createdAt_idx"
  ON "Message" ("tenantId", "createdAt");

-- Step 6: Enable RLS
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message"
  FOR ALL USING ("tenantId" = get_current_tenant_id());
```

### migration_YYYYMMDD_add_tenant_to_user_memory/migration.sql

```sql
-- Step 1: Add tenantId column
ALTER TABLE "UserMemory" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

-- Step 2: Backfill from CustomerUser
UPDATE "UserMemory" m
SET "tenantId" = u."tenantId"
FROM "CustomerUser" u
WHERE m."userId" = u.id
  AND m."tenantId" IS NULL;

-- Step 3: Verify and make NOT NULL
DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "UserMemory" WHERE "tenantId" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION '% UserMemory rows have NULL tenantId after backfill', null_count;
  END IF;
END $$;

ALTER TABLE "UserMemory" ALTER COLUMN "tenantId" SET NOT NULL;

-- Step 4: Replace subquery-based RLS policy with direct tenantId
DROP POLICY IF EXISTS tenant_isolation ON "UserMemory";
CREATE POLICY tenant_isolation ON "UserMemory"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

-- Step 5: Add index
CREATE INDEX IF NOT EXISTS "UserMemory_tenantId_userId_idx"
  ON "UserMemory" ("tenantId", "userId");
```

### Prisma Schema 对应修改

```diff
model Message {
  id             String   @id @default(uuid()) @db.Uuid
+ tenantId       String   @db.Uuid
  conversationId String   @db.Uuid
  role           String   @db.VarChar(50)
  agentType      String?  @db.VarChar(100)
  content        String   @db.Text
  metadata       Json     @default("{}")
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

+ @@index([tenantId, conversationId])
+ @@index([tenantId, createdAt])
  @@index([conversationId, createdAt])
}

model UserMemory {
  id        String   @id @default(uuid()) @db.Uuid
+ tenantId  String   @db.Uuid
  userId    String   @db.Uuid
  key       String   @db.VarChar(500)
  value     Json
  ttl       Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user CustomerUser @relation(fields: [userId], references: [id])

+ @@index([tenantId, userId])
  @@unique([userId, key])
}
```

---

## 11. 检查清单

迁移后验证：

- [ ] `Message` 表所有行 `tenantId` NOT NULL
- [ ] `UserMemory` 表所有行 `tenantId` NOT NULL
- [ ] 所有 Message 查询添加 `tenantId` WHERE 条件
- [ ] 所有 UserMemory 查询添加 `tenantId` WHERE 条件
- [ ] withTenant() 覆盖所有数据访问路径
- [ ] 文件上传按 tenantId 创建子目录
- [ ] 文件访问中间件校验 tenantId
- [ ] extractTenant 升级为 verifyJwt
- [ ] AgentConfig 表有代码读取
- [ ] AuditLog 表有代码写入
- [ ] Milvus 查询 tenantId 输入校验
- [ ] 集成测试：两个租户间无数据泄露

---

> **审计结论：Schema 设计总体合格，但 Message 和 UserMemory 两个核心表缺 tenantId 是阻塞级问题。建议按 Phase 1 → 2 → 3 顺序执行迁移，优先修复 Message 表和文件上传隔离，在 SaaS 化之前完成 Phase 1+2。**
