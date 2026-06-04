# 统一 Order Service 设计文档

> 版本: v1.0
> 日期: 2026-06-04
> 目标: 构建平台无关的统一订单服务，支持淘宝/拼多多/抖音/京东接入

---

## 1. 四平台差异分析

### 1.1 订单状态对照

```
统一状态          淘宝                    拼多多        抖音          京东
────────          ────                    ─────        ────          ────
pending_payment   WAIT_BUYER_PAY         0-待支付      1-待支付      WAIT_SELLER_STOCK_OUT
paid              WAIT_SELLER_SEND_GOODS  1-已成团      2-备货中      WAIT_SELLER_DELIVERY
shipped           WAIT_BUYER_CONFIRM_GOODS 2-已发货    3-已发货      WAIT_GOODS_RECEIVE_CONFIRM
delivered         TRADE_BUYER_SIGNED      3-已签收      4-已收货      FINISHED_L
completed         TRADE_FINISHED          3-已签收      5-已完成      FINISHED_L
cancelled         TRADE_CLOSED            5-已取消      6-已取消      TRADE_CANCELED
refunding         (退款单独立)             4-已退款      (售后单独立) (售后单独立)
refunded          (退款单独立)             4-已退款      (售后单独立) (售后单独立)
```

### 1.2 关键字段对照

```
字段          淘宝 tid                   拼多多 order_sn        抖音 order_id       京东 orderId
────────      ────────                   ──────────            ────────           ────────
订单号         tid (数字)                 order_sn (字母数字)    order_id (字母数字)  orderId (数字)
父订单         支持 (trade/memo)          不支持                 不支持               支持 (parentOrderId)
SKU 级子订单    orders[].oid              goods[]               product_id×n        itemList[]
商品标题       orders[].title             goods[].goods_name     product_name        itemList[].name
商品单价       orders[].price             goods[].goods_price    product_price       itemList[].price
实付金额       payment                    order_amount           total_amount        orderTotalPrice
邮费           post_fee                   0 (包邮为主)           shipping_fee        freightPrice
收货人         receiver_name              receiver_name         post_addr.name      receiver.name
收货电话       receiver_mobile            receiver_phone        post_addr.tel       receiver.mobile
收货地址       receiver_state + city +    receiver_province +    post_addr.full_addr receiver.address
              district + address          city + town + detail
创建时间       created                    created_time           create_time         orderStartTime
支付时间       pay_time                   payment_time           pay_time            orderPaymentTime
发货时间       consign_time               shipping_time         ship_time           deliverTime
签收时间       end_time                   confirm_time          confirm_time        finishTime
买家昵称       buyer_nick                 (脱敏)                (脱敏)              pin (加密)
买家备注       buyer_memo                 buyer_words           buyer_words         buyerRemark
卖家备注       seller_memo                seller_memo           seller_words        sellerRemark
```

### 1.3 鉴权方式

```
平台           方式                     Token 有效期        限流
────           ────                    ────               ────
淘宝           OAuth 2.0 (sessionKey)  长期 (需刷新)      5000次/天/应用
拼多多         OAuth 2.0 + Sign       长期 (需刷新)      3000次/天/应用
抖音           OAuth 2.0 (accessToken) 短期 (refreshToken) 5000次/天/应用
京东           OAuth 2.0 + MD5 Sign   长期 (需刷新)      3000次/天/应用
```

### 1.4 退款/售后对照

```
平台           退款API                          状态枚举
────           ──────                           ──────
淘宝           taobao.refund.get                WAIT_SELLER_AGREE → WAIT_BUYER_RETURN_GOODS
               taobao.refunds.receive.get       → WAIT_SELLER_CONFIRM_GOODS → SUCCESS
拼多多         pdd.refund.list.get              0-待处理 → 1-处理中 → 2-退款成功 → 3-退款关闭
抖音           /aftersale/apply                 1-待审核 → 2-审核通过 → 3-退货中 → 4-退款成功
               /refund/orderList
京东           jingdong.pop.afs.*               WAIT_SELLER_AUDIT → WAIT_GOODS_RECEIVE
                                                → WAIT_SELLER_REFUND → FINISHED
```

---

## 2. 统一订单模型

### 2.1 模型架构

```
                     ┌─────────────────────┐
                     │     OrderService     │ ← 对外统一接口
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │    OrderAdapter     │ ← 接口定义
                     │    (interface)      │
                     └──────────┬──────────┘
                                │
        ┌───────────┬───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Taobao  │ │ Pinduoduo│ │ Douyin  │ │   JD    │ │  Mock   │
   │ Adapter │ │ Adapter │ │ Adapter │ │ Adapter │ │ Adapter │
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │           │           │
   ┌────▼────┐┌────▼────┐┌────▼────┐┌────▼────┐
   │ 淘宝API ││ 拼多多API││ 抖音API ││ 京东API │
   └─────────┘└─────────┘└─────────┘└─────────┘
```

### 2.2 统一订单实体

```typescript
/**
 * UnifiedOrder — 平台无关的订单表示。
 * 所有 Adapter 将平台专有格式转换为此结构。
 */
interface UnifiedOrder {
  // ── 标识 ──────────────────────────────────────────
  id: string;                          // 内部 ID (UUID)
  platform: Platform;                  // taobao | pinduoduo | douyin | jd
  platformOrderId: string;             // 平台原始订单号 (tid / order_sn / order_id / orderId)
  parentPlatformOrderId?: string;      // 平台父订单号 (淘宝/京东支持)

  // ── 状态 ──────────────────────────────────────────
  status: OrderStatus;                 // 统一订单状态
  platformStatus: string;              // 平台原始状态字符串 (保留, 便于排障)
  statusUpdatedAt: Date;               // 状态最后更新时间

  // ── 金额 ──────────────────────────────────────────
  totalAmount: number;                 // 实付金额 (元, 统一单位)
  currency: string;                    // CNY (默认)
  shippingFee: number;                 // 邮费
  discountAmount: number;              // 优惠金额
  originalAmount: number;              // 原价 (优惠前)

  // ── 买家 ──────────────────────────────────────────
  buyerNick: string;                   // 买家昵称 (平台可能脱敏)
  buyerNote?: string;                  // 买家备注

  // ── 收货 ──────────────────────────────────────────
  receiver: OrderReceiver;

  // ── 商品 ──────────────────────────────────────────
  items: UnifiedOrderItem[];

  // ── 时间线 ────────────────────────────────────────
  createdAt: Date;                     // 下单时间
  paidAt?: Date;                       // 支付时间
  shippedAt?: Date;                    // 发货时间
  deliveredAt?: Date;                  // 签收时间
  completedAt?: Date;                  // 完成时间
  cancelledAt?: Date;                  // 取消时间

  // ── 售后 ──────────────────────────────────────────
  afterSales?: UnifiedAfterSale[];

  // ── 平台原始数据 ──────────────────────────────────
  platformRaw: Record<string, unknown>; // 平台原始 JSON (不落库, 缓存用)
}

interface OrderReceiver {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;                     // 详细地址
  zipCode?: string;
}

interface UnifiedOrderItem {
  id: string;
  platformSkuId: string;               // 平台 SKU ID / 商品 ID
  platformItemId: string;              // 平台子订单 ID (oid)
  title: string;                       // 商品标题
  price: number;                       // 单价
  quantity: number;
  totalAmount: number;                 // 行总价 (price × quantity)
  imageUrl?: string;
  attributes: Record<string, string>;  // 规格 (颜色/尺寸)
  outerSkuId?: string;                 // 商家编码 (可映射到本地 Product.sku)
}

interface UnifiedAfterSale {
  id: string;
  platformAfterSaleId: string;         // 平台售后单号
  type: AfterSaleType;                 // refund | return | exchange
  status: AfterSaleStatus;
  reason: string;                      // 退款原因
  amount: number;                      // 退款金额
  description: string;                 // 问题描述
  createdAt: Date;
  resolvedAt?: Date;
  platformRaw: Record<string, unknown>;
}

// ── Enums ───────────────────────────────────────────

type Platform = "taobao" | "pinduoduo" | "douyin" | "jd";

enum OrderStatus {
  pending_payment = "pending_payment",
  paid            = "paid",
  shipped         = "shipped",
  delivered       = "delivered",
  completed       = "completed",
  cancelled       = "cancelled",
  refunding       = "refunding",
  refunded        = "refunded",
}

enum AfterSaleType {
  refund   = "refund",      // 仅退款
  return   = "return",      // 退货退款
  exchange = "exchange",    // 换货
}

enum AfterSaleStatus {
  pending      = "pending",       // 待商家处理
  approved     = "approved",      // 已同意
  rejected     = "rejected",      // 已拒绝
  buyer_shipped = "buyer_shipped",// 买家已退货
  received     = "received",      // 商家已收货
  refunding    = "refunding",     // 退款中
  completed    = "completed",     // 已完成
  closed       = "closed",        // 已关闭
}
```

---

## 3. Adapter Pattern 设计

### 3.1 Adapter 接口

```typescript
/**
 * OrderAdapter — 所有平台适配器必须实现的接口
 */
interface OrderAdapter {
  /** 平台标识 */
  readonly platform: Platform;

  /** 平台显示名称 */
  readonly displayName: string;

  // ── 订单查询 ──────────────────────────────────────

  /** 按订单号查询 */
  getOrder(orderId: string, options?: QueryOptions): Promise<UnifiedOrder>;

  /** 批量查询 */
  getOrders(orderIds: string[], options?: QueryOptions): Promise<UnifiedOrder[]>;

  /** 按时间范围/状态搜索 */
  searchOrders(params: OrderSearchParams): Promise<PaginatedResult<UnifiedOrder>>;

  // ── 售后查询 ──────────────────────────────────────

  /** 获取订单的售后记录 */
  getAfterSales(orderId: string): Promise<UnifiedAfterSale[]>;

  /** 搜索售后单 */
  searchAfterSales(params: AfterSaleSearchParams): Promise<PaginatedResult<UnifiedAfterSale>>;

  // ── 实时同步 ──────────────────────────────────────

  /** 增量同步 (上次同步时间 → 现在) */
  syncOrders(lastSyncAt: Date): Promise<SyncResult>;

  // ── 能力声明 ──────────────────────────────────────

  /** 平台支持的能力 */
  readonly capabilities: PlatformCapabilities;
}

interface OrderSearchParams {
  startTime: Date;
  endTime: Date;
  status?: OrderStatus[];
  buyerNick?: string;
  page: number;
  pageSize: number;                    // 各平台限制不同，Adapter 内部处理
}

interface AfterSaleSearchParams {
  startTime: Date;
  endTime: Date;
  type?: AfterSaleType;
  status?: AfterSaleStatus[];
  page: number;
  pageSize: number;
}

interface QueryOptions {
  /** 是否包含售后信息 */
  includeAfterSales?: boolean;
  /** 缓存策略 */
  cacheStrategy?: "cache_first" | "network_only" | "cache_only";
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface SyncResult {
  platform: Platform;
  syncedAt: Date;
  newOrders: number;
  updatedOrders: number;
  errors: SyncError[];
}

interface SyncError {
  orderId: string;
  message: string;
  retryable: boolean;
}

interface PlatformCapabilities {
  supportsParentOrder: boolean;        // 京东/淘宝: true, 拼多多/抖音: false
  supportsPartialRefund: boolean;      // 是否支持部分退款
  supportsExchange: boolean;           // 是否支持换货 (抖音不支持)
  maxPageSize: number;                 // 单页最大数量
  rateLimitPerMinute: number;          // 每分钟最大请求数
}
```

### 3.2 淘宝 Adapter 概念实现

```typescript
class TaobaoAdapter implements OrderAdapter {
  readonly platform = "taobao";
  readonly displayName = "淘宝";
  readonly capabilities: PlatformCapabilities = {
    supportsParentOrder: true,
    supportsPartialRefund: true,
    supportsExchange: true,
    maxPageSize: 100,
    rateLimitPerMinute: 50,
  };

  constructor(
    private client: TaobaoApiClient,   // 淘宝 SDK 封装
    private tenantId: string,
  ) {}

  // ── 订单查询 ──────────────────────────────────────

  async getOrder(orderId: string): Promise<UnifiedOrder> {
    const raw = await this.client.execute("taobao.trade.fullinfo.get", {
      tid: orderId,
      fields: "tid,status,payment,post_fee,buyer_nick,receiver_name,receiver_mobile,receiver_state,receiver_city,receiver_district,receiver_address,created,pay_time,consign_time,end_time,buyer_message,orders",
    });
    return this.toUnified(raw.trade);
  }

  async searchOrders(params: OrderSearchParams): Promise<PaginatedResult<UnifiedOrder>> {
    const raw = await this.client.execute("taobao.trades.sold.get", {
      start_created: this.formatTime(params.startTime),
      end_created: this.formatTime(params.endTime),
      status: this.mapStatusToPlatform(params.status),
      page_no: params.page,
      page_size: Math.min(params.pageSize, 100),
    });

    return {
      items: raw.trades.map(t => this.toUnified(t)),
      total: raw.total_results,
      page: params.page,
      pageSize: params.pageSize,
      hasMore: raw.has_next,
    };
  }

  // ── 状态映射 ──────────────────────────────────────

  private mapStatusFromPlatform(taobaoStatus: string): OrderStatus {
    switch (taobaoStatus) {
      case "WAIT_BUYER_PAY":          return OrderStatus.pending_payment;
      case "WAIT_SELLER_SEND_GOODS":  return OrderStatus.paid;
      case "WAIT_BUYER_CONFIRM_GOODS":return OrderStatus.shipped;
      case "TRADE_BUYER_SIGNED":      return OrderStatus.delivered;
      case "TRADE_FINISHED":          return OrderStatus.completed;
      case "TRADE_CLOSED":            return OrderStatus.cancelled;
      default:                        return OrderStatus.pending_payment;
    }
  }

  private mapStatusToPlatform(statuses?: OrderStatus[]): string | undefined {
    if (!statuses || statuses.length === 0) return undefined;
    const mapping: Record<OrderStatus, string> = {
      [OrderStatus.pending_payment]: "WAIT_BUYER_PAY",
      [OrderStatus.paid]:            "WAIT_SELLER_SEND_GOODS",
      [OrderStatus.shipped]:         "WAIT_BUYER_CONFIRM_GOODS",
      [OrderStatus.delivered]:       "TRADE_BUYER_SIGNED",
      [OrderStatus.completed]:       "TRADE_FINISHED",
      [OrderStatus.cancelled]:       "TRADE_CLOSED",
      [OrderStatus.refunding]:       "",   // 淘宝退款走独立 API
      [OrderStatus.refunded]:        "",
    };
    return statuses.map(s => mapping[s]).filter(Boolean).join(",");
  }

  // ── 数据转换 ──────────────────────────────────────

  private toUnified(raw: TaobaoTrade): UnifiedOrder {
    return {
      id: uuid(),
      platform: "taobao",
      platformOrderId: String(raw.tid),
      status: this.mapStatusFromPlatform(raw.status),
      platformStatus: raw.status,
      totalAmount: parseFloat(raw.payment),
      currency: "CNY",
      shippingFee: parseFloat(raw.post_fee || "0"),
      discountAmount: 0, // 淘宝 API 需要额外字段
      originalAmount: 0,
      buyerNick: raw.buyer_nick || "",
      buyerNote: raw.buyer_message,
      receiver: {
        name: raw.receiver_name || "",
        phone: raw.receiver_mobile || "",
        province: raw.receiver_state || "",
        city: raw.receiver_city || "",
        district: raw.receiver_district || "",
        address: raw.receiver_address || "",
      },
      items: (raw.orders || []).map(item => ({
        id: uuid(),
        platformSkuId: item.sku_id || "",
        platformItemId: String(item.oid),
        title: item.title || "",
        price: parseFloat(item.price || "0"),
        quantity: parseInt(item.num || "1"),
        totalAmount: parseFloat(item.total_fee || "0"),
        imageUrl: item.pic_path,
        attributes: this.parseSkuProperties(item.sku_properties_name || ""),
        outerSkuId: item.outer_sku_id,
      })),
      createdAt: new Date(raw.created),
      paidAt: raw.pay_time ? new Date(raw.pay_time) : undefined,
      shippedAt: raw.consign_time ? new Date(raw.consign_time) : undefined,
      deliveredAt: raw.end_time ? new Date(raw.end_time) : undefined,
      platformRaw: raw as unknown as Record<string, unknown>,
    };
  }

  private parseSkuProperties(propsName: string): Record<string, string> {
    // "颜色分类:白色;内存:16GB" → { 颜色分类: "白色", 内存: "16GB" }
    if (!propsName) return {};
    return Object.fromEntries(
      propsName.split(";").map(p => p.split(":").map(s => s.trim()))
    );
  }

  async getAfterSales(orderId: string): Promise<UnifiedAfterSale[]> { /* ... */ }
  async searchAfterSales(params: AfterSaleSearchParams): Promise<PaginatedResult<UnifiedAfterSale>> { /* ... */ }
  async syncOrders(lastSyncAt: Date): Promise<SyncResult> { /* ... */ }
  private formatTime(date: Date): string { return date.toISOString(); }
}
```

### 3.3 各平台 Adapter 差异点

```
特性                淘宝         拼多多      抖音         京东
────                ────         ─────      ────         ────
API 调用方式         SDK          SDK        REST         SDK
签名算法             MD5 + HMAC   MD5        —            MD5
分页方式             page_no      offset     cursor       page
日期格式             ISO 8601     Unix秒     Unix毫秒     ISO 8601
订单号类型           Long (19位)  String(18) String(20)   Long
商品信息在           子订单orders 内嵌goods   订单级product 子订单itemList
收货人加密           否(明文)     部分脱敏    全部脱敏      加密
售后独立 API         ✅          ✅         ✅           ✅
Webhook/消息推送     ❌ (需轮询)  ❌ (需轮询) ✅ (消息队列) ✅ (JOS消息)
测试环境             Sandbox     —           Sandbox      测试App
```

### 3.4 Adapter 工厂

```typescript
class OrderAdapterFactory {
  private adapters = new Map<string, OrderAdapter>();

  register(adapter: OrderAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  get(platform: Platform): OrderAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
    return adapter;
  }

  getForTenant(tenantId: string, platform: Platform): OrderAdapter {
    // 从 Tenant.settings.platforms[platform] 获取租户的 API 凭证
    // 创建对应 adapter 实例并缓存
    const credentials = this.loadCredentials(tenantId, platform);
    return this.createAdapter(platform, credentials);
  }

  private createAdapter(platform: Platform, creds: PlatformCredentials): OrderAdapter {
    switch (platform) {
      case "taobao":    return new TaobaoAdapter(new TaobaoClient(creds), creds.tenantId);
      case "pinduoduo": return new PinduoduoAdapter(new PddClient(creds), creds.tenantId);
      case "douyin":    return new DouyinAdapter(new DyClient(creds), creds.tenantId);
      case "jd":        return new JdAdapter(new JdClient(creds), creds.tenantId);
    }
  }
}

interface PlatformCredentials {
  tenantId: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}
```

---

## 4. OrderService 设计

### 4.1 服务接口

```typescript
class OrderService {
  constructor(
    private adapterFactory: OrderAdapterFactory,
    private db: PrismaClient,
    private cache: Redis,
  ) {}

  // ── 订单查询 ──────────────────────────────────────

  /**
   * 按订单号查询。
   * 策略: 本地 DB → 缓存 → 远程平台 API
   */
  async getOrder(tenantId: string, platform: Platform, orderId: string): Promise<UnifiedOrder>;

  /**
   * 搜索租户的跨平台订单。
   * 策略: 先查本地 DB (已同步的), 再并行查各平台 API (实时)
   */
  async searchOrders(tenantId: string, params: UnifiedSearchParams): Promise<PaginatedResult<UnifiedOrder>>;

  /**
   * 查询客户的所有订单。
   * 策略: 按 phone / receiver_name 去各平台搜索
   */
  async getCustomerOrders(tenantId: string, customerId: string): Promise<UnifiedOrder[]>;

  /**
   * 查询与某对话关联的订单。
   * 策略: 从 conversation.metadata.orderId 读取
   */
  async getOrdersForConversation(tenantId: string, conversationId: string): Promise<UnifiedOrder[]>;

  // ── 售后查询 ──────────────────────────────────────

  async getAfterSales(tenantId: string, platform: Platform, orderId: string): Promise<UnifiedAfterSale[]>;

  // ── 同步 ──────────────────────────────────────────

  /**
   * 增量同步: 拉取平台最新订单变更到本地 DB
   */
  async syncOrders(tenantId: string, platform: Platform): Promise<SyncResult>;

  /**
   * 全量同步 (仅在首次接入时执行)
   */
  async fullSync(tenantId: string, platform: Platform, startDate: Date): Promise<SyncResult>;

  // ── 关联 ──────────────────────────────────────────

  /**
   * 将订单关联到对话。
   * Agent 在处理售前/售后时调用，帮助上下文关联。
   */
  async linkOrderToConversation(orderId: string, conversationId: string): Promise<void>;

  /**
   * 将平台 SKU 映射到本地 Product。
   */
  async linkPlatformSku(platformSkuId: string, productId: string): Promise<void>;

  // ── 缓存管理 ──────────────────────────────────────

  async warmCache(tenantId: string, platform: Platform): Promise<void>;
  async invalidateCache(tenantId: string, platform: Platform, orderId: string): Promise<void>;
}

interface UnifiedSearchParams {
  platforms?: Platform[];
  status?: OrderStatus[];
  startTime: Date;
  endTime: Date;
  buyerNick?: string;
  keyword?: string;                    // 商品名/订单号模糊搜索
  page: number;
  pageSize: number;
}
```

### 4.2 查询策略

```
getOrder() 流程:

  1. 查本地 DB: OrderCache.where({ platformOrderId, tenantId })
     ├─ 命中 & 未过期 (TTL < 5min) → 直接返回
     └─ 未命中或已过期
         │
  2. 查 Redis: cacheGet(`order:{tenantId}:{platform}:{orderId}`)
     ├─ 命中 → 返回缓存
     └─ 未命中
         │
  3. 调用平台 Adapter.getOrder(orderId)
     ├─ 成功 → 写入 OrderCache (DB) + Redis (TTL 5min)
     └─ 失败 → 返回 stale cache (如有), 标记需要重试
```

### 4.3 同步策略

```
增量同步 (syncOrders) — 每 5 分钟 cron:

  1. 读取 SyncCursor 表 (上次同步的游标/时间)
  2. 调用 Adapter.searchOrders({ startTime: lastSyncAt, endTime: now })
  3. 对每页结果:
     - 新订单 → INSERT OrderCache
     - 已有订单 & 状态不同 → UPDATE OrderCache + 记录状态变更
  4. 更新 SyncCursor
  5. 如遇限流 → 退避重试 (指数退避, 最多 3 次)

全量同步 (fullSync) — 首次接入时:

  1. 从 startDate 开始按天分批
  2. 每天最多 100 页 → 如果超限, 缩短时间窗口
  3. 后台任务队列处理, 不阻塞 API
  4. 进度写入 SyncProgress 表

各平台同步特点:
  淘宝:   按创建时间分页, 每次 100 条, 有 has_next
  拼多多:  按创建时间 offset, 每次 50 条
  抖音:    按 cursor 分页
  京东:    按创建时间分页, 每次 50 条
```

---

## 5. 数据库设计

### 5.1 Prisma Schema

```prisma
// ============================================
// PlatformAccount — 租户绑定的平台账号
// ============================================
model PlatformAccount {
  id             String   @id @default(uuid()) @db.Uuid
  tenantId       String   @db.Uuid
  platform       String   @db.VarChar(50)   // taobao | pinduoduo | douyin | jd
  shopName       String   @db.VarChar(255)  // 店铺名称
  appKey         String   @db.VarChar(255)
  appSecret      String   @db.VarChar(255)  // 加密存储
  accessToken    String   @db.Text          // 加密存储
  refreshToken   String?  @db.Text
  tokenExpiresAt DateTime?
  isActive       Boolean  @default(true)
  settings       Json     @default("{}")     // 平台特定配置
  syncEnabled    Boolean  @default(true)
  lastSyncAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant         Tenant        @relation(fields: [tenantId], references: [id])
  orders         OrderCache[]
  syncCursors    SyncCursor[]

  @@unique([tenantId, platform, shopName])
  @@index([tenantId])
}

// ============================================
// OrderCache — 本地订单缓存
// ============================================
model OrderCache {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @db.Uuid
  platformAccountId String   @db.Uuid

  // 订单标识
  platform          String   @db.VarChar(50)
  platformOrderId   String   @db.VarChar(100)
  parentOrderId     String?  @db.VarChar(100)

  // 统一状态
  status            String   @db.VarChar(50)   // OrderStatus
  platformStatus    String   @db.VarChar(100)  // 平台原始状态

  // 金额
  totalAmount       Decimal  @db.Decimal(12, 2)
  shippingFee       Decimal  @db.Decimal(10, 2) @default(0)
  discountAmount    Decimal  @db.Decimal(10, 2) @default(0)
  originalAmount    Decimal  @db.Decimal(12, 2) @default(0)

  // 买家
  buyerNick         String?  @db.VarChar(255)
  buyerNote         String?  @db.Text

  // 收货 (脱敏存储: phone 取后 4 位)
  receiverName      String?  @db.VarChar(100)
  receiverPhoneHash String?  @db.VarChar(255)  // SHA256 hash
  receiverPhoneLast4 String? @db.VarChar(4)
  receiverProvince  String?  @db.VarChar(100)
  receiverCity      String?  @db.VarChar(100)
  receiverDistrict  String?  @db.VarChar(100)
  receiverAddress   String?  @db.Text

  // 时间线
  orderCreatedAt    DateTime
  paidAt            DateTime?
  shippedAt         DateTime?
  deliveredAt       DateTime?
  completedAt       DateTime?
  cancelledAt       DateTime?

  // 关联
  customerUserId    String?  @db.Uuid         // 关联到 CustomerUser

  // 平台原始数据 (不常用字段放 JSON)
  platformData      Json     @default("{}")

  // 同步时间
  lastSyncedAt      DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  platformAccount   PlatformAccount @relation(fields: [platformAccountId], references: [id])
  items             OrderItemCache[]
  afterSales        AfterSaleCache[]
  conversations     ConversationOrder[]

  @@unique([tenantId, platform, platformOrderId])
  @@index([tenantId, status])
  @@index([tenantId, orderCreatedAt])
  @@index([tenantId, receiverPhoneHash, receiverPhoneLast4])
  @@index([tenantId, buyerNick])
}

// ============================================
// OrderItemCache — 订单商品行
// ============================================
model OrderItemCache {
  id              String   @id @default(uuid()) @db.Uuid
  orderId         String   @db.Uuid
  platformSkuId   String   @db.VarChar(200)
  platformItemId  String   @db.VarChar(100)   // 平台子订单 ID
  title           String   @db.VarChar(500)
  price           Decimal  @db.Decimal(12, 2)
  quantity        Int
  totalAmount     Decimal  @db.Decimal(12, 2)
  skuAttributes   Json     @default("{}")     // 规格: {颜色: "白色", 尺寸: "XL"}
  imageUrl        String?  @db.VarChar(1000)
  outerSkuId      String?  @db.VarChar(100)   // 商家编码 → 可映射到 Product.sku
  productId       String?  @db.Uuid           // 映射到本地 Product

  order           OrderCache @relation(fields: [orderId], references: [id])

  @@index([orderId])
  @@index([outerSkuId])
  @@index([productId])
}

// ============================================
// AfterSaleCache — 售后记录缓存
// ============================================
model AfterSaleCache {
  id                  String   @id @default(uuid()) @db.Uuid
  tenantId            String   @db.Uuid
  orderId             String   @db.Uuid
  platform            String   @db.VarChar(50)
  platformAfterSaleId String   @db.VarChar(100)
  type                String   @db.VarChar(50)   // refund | return | exchange
  status              String   @db.VarChar(50)   // AfterSaleStatus
  reason              String?  @db.Text
  amount              Decimal  @db.Decimal(12, 2)
  description         String?  @db.Text
  platformData        Json     @default("{}")
  createdAt           DateTime
  resolvedAt          DateTime?
  lastSyncedAt        DateTime @default(now())

  order               OrderCache @relation(fields: [orderId], references: [id])

  @@unique([tenantId, platform, platformAfterSaleId])
  @@index([orderId])
  @@index([tenantId, status])
}

// ============================================
// ConversationOrder — 对话-订单关联
// ============================================
model ConversationOrder {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid
  orderId        String   @db.Uuid

  conversation   Conversation @relation(fields: [conversationId], references: [id])
  order          OrderCache   @relation(fields: [orderId], references: [id])

  @@unique([conversationId, orderId])
}

// ============================================
// SyncCursor — 同步进度
// ============================================
model SyncCursor {
  id                String   @id @default(uuid()) @db.Uuid
  platformAccountId String   @db.Uuid
  syncType          String   @db.VarChar(50)   // order | after_sale | full
  lastCursor        String?  @db.Text           // 平台 cursor (抖音用)
  lastSyncAt        DateTime                   // 上次同步到的时间
  lastOrderId       String?  @db.VarChar(100)   // 最后同步的订单号
  totalSynced       Int      @default(0)
  errors            Json     @default("[]")     // SyncError[]
  updatedAt         DateTime @updatedAt

  platformAccount   PlatformAccount @relation(fields: [platformAccountId], references: [id])

  @@unique([platformAccountId, syncType])
}

// ============================================
// PlatformSkuMapping — 平台 SKU → 本地 Product 映射
// ============================================
model PlatformSkuMapping {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @db.Uuid
  platform      String   @db.VarChar(50)
  platformSkuId String   @db.VarChar(200)
  productId     String   @db.Uuid
  createdAt     DateTime @default(now())

  product       Product @relation(fields: [productId], references: [id])

  @@unique([tenantId, platform, platformSkuId])
  @@index([productId])
}
```

### 5.2 ER 图

```
┌──────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Tenant  │1───N│ PlatformAccount   │1───N│   OrderCache     │
└──────────┘     │ (腾讯 ×4平台)      │     │ (统一订单缓存)    │
                 └──────────────────┘     └────────┬─────────┘
                                                   │
                   ┌───────────────────────────────┼───────────────┐
             1───N │                         1───N │         1───N │
                   ▼                               ▼               ▼
          ┌──────────────┐               ┌──────────────┐  ┌──────────────┐
          │OrderItemCache│               │AfterSaleCache│  │ConversationOrder│
          │ (商品行)      │               │ (售后记录)    │  │ (对话关联)     │
          └──────┬───────┘               └──────────────┘  └──────────────┘
                 │
            M:1  │
          ┌──────▼───────┐     ┌──────────────────┐
          │   Product    │     │PlatformSkuMapping│
          │  (本地产品)   │1───N│ (SKU映射)        │
          └──────────────┘     └──────────────────┘
```

---

## 6. API 设计

### 6.1 REST Endpoints

```
Base: /api/orders

GET    /api/orders/:platform/:orderId      查询单个订单
GET    /api/orders                         跨平台搜索订单
GET    /api/orders/:platform/:orderId/items      订单商品列表
GET    /api/orders/:platform/:orderId/aftersales  订单售后记录

POST   /api/orders/sync                    手动触发增量同步
POST   /api/orders/full-sync               触发全量同步 (管理员)
GET    /api/orders/sync-status             查看同步状态

GET    /api/platform-accounts              租户的平台账号列表
POST   /api/platform-accounts              绑定新的平台账号
PATCH  /api/platform-accounts/:id          更新平台凭证
DELETE /api/platform-accounts/:id          解绑平台账号

POST   /api/orders/:orderId/link-conversation  关联订单到对话
GET    /api/conversations/:id/orders            获取对话关联的订单

GET    /api/sku-mappings                    查看 SKU 映射
POST   /api/sku-mappings                    创建 SKU 映射
DELETE /api/sku-mappings/:id                删除映射
```

### 6.2 关键接口规格

```
GET /api/orders?platforms=taobao,jd&status=paid,shipped&startTime=...&endTime=...&page=1

Response:
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-internal",
        "platform": "taobao",
        "platformOrderId": "1234567890123456789",
        "status": "paid",
        "platformStatus": "WAIT_SELLER_SEND_GOODS",
        "totalAmount": 8999.00,
        "shippingFee": 0,
        "buyerNick": "tb***user",
        "receiver": {
          "name": "张三",
          "province": "广东省",
          "city": "深圳市"
        },
        "items": [
          {
            "title": "iPhone 16 Pro 256GB",
            "price": 8999.00,
            "quantity": 1,
            "attributes": { "颜色": "原色钛金属", "存储": "256GB" }
          }
        ],
        "orderCreatedAt": "2026-06-01T10:30:00Z",
        "paidAt": "2026-06-01T10:31:25Z"
      }
    ],
    "total": 156,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

---

## 7. 与现有 Agent Pipeline 集成

### 7.1 售前场景

```
用户: "我刚才下的单什么时候发货?"

PresaleAgent.execute()
  ├─ Intent: general_inquiry
  ├─ OrderService.getCustomerOrders(userId)
  │    └─ 按 receiverPhoneHash 匹配 → 找到最近订单
  ├─ 将订单信息注入 Prompt:
  │    "用户最近订单: [平台: 淘宝, 订单号: xxx, 状态: 已付款, 金额: ¥8999,
  │     商品: iPhone 16 Pro, 下单时间: 2026-06-01]"
  └─ LLM 基于订单数据生成回复
```

### 7.2 售后场景

```
用户: "订单xxx的屏幕有坏点, 我要退货"

AfterSaleAgent.execute()
  ├─ Intent: aftersale
  ├─ OrderService.getOrder(platform, orderId)
  │    ├─ 加载订单详情 + 商品列表
  │    └─ 加载售后历史 (是否已有退款记录)
  ├─ CaseEngine.search({
  │    query: "屏幕坏点退货",
  │    filter: { productCategory: "phone", resolutionType: "return" }
  │  })
  ├─ 将订单 + 案例数据注入 Prompt
  └─ LLM 基于完整上下文生成回复
```

### 7.3 对话-订单关联

```
Socket.IO chat:message 事件可携带 orderId:
  socket.emit("chat:message", {
    message: "这个订单什么时候发货",
    conversationId: "...",
    orderContext: {
      platform: "taobao",
      orderId: "1234567890123456789"
    }
  });

Server 端:
  → processMessage() 识别 orderContext
  → 自动调用 OrderService.linkOrderToConversation()
  → 在 AgentContext 中注入 order 数据
```

---

## 8. 未来扩展策略

### 8.1 新平台接入检查清单

```
□ 实现 OrderAdapter 接口 (预计 2-3 天/平台)
□ 添加 Platform 枚举值
□ 实现平台 API Client (鉴权 + 签名 + HTTP)
□ 状态映射表 (platform status → OrderStatus)
□ 字段映射逻辑 (platform fields → UnifiedOrder)
□ 分页适配 (适配平台的分页机制)
□ 限流处理 (遵守平台的 rate limit)
□ 单元测试 + Mock Adapter
□ 集成测试 (使用平台 Sandbox)
```

### 8.2 Webhook 改造

```
阶段 1 (当前设计): Poll-based 同步 (cron 每 5 分钟)
阶段 2 (V2): Webhook 实时推送

  新增表: PlatformWebhook
  - 接收平台订单状态变更推送 (抖音/京东已支持)
  - 淘宝/拼多多 → 仍需轮询 (或使用第三方消息服务)

  Webhook handler:
    POST /api/webhooks/:platform
    → 验证签名
    → 解析事件
    → 更新 OrderCache
    → 推送通知给关联的 Conversation (如客户正在等待)
```

### 8.3 订单数据脱敏策略

```
收货人姓名:   保留 (客服需要核实身份)
收货电话:     存储 SHA256(phone) + 后 4 位 (用于匹配查询)
收货地址:     保留 (售后需要)
买家昵称:     保留 (平台已脱敏)
平台原始数据: 不落库 (仅 Redis 缓存, TTL 1h)
GDPR 删除:    receiverName → "已删除"
              receiverPhoneHash → null
              receiverAddress → "已删除"
```

### 8.4 性能扩展

```
水平扩展:
  - OrderCache 按 tenantId 分片
  - Redis 缓存已覆盖热数据 (TTL 5min)

读写分离:
  - OrderCache 写入仅发生在 sync (批量写)
  - 查询: Redis → DB → Platform API (降级链)

预加载:
  - 客户接入客服时自动预加载最近 5 个订单到 Redis
  - 基于 customerUserId 或 phoneHash 预取
```

---

> **设计总结：** 统一 Order Service 通过 Adapter Pattern 屏蔽淘宝/拼多多/抖音/京东 4 个平台的差异，以 `UnifiedOrder` 为规范表示，`OrderCache` 实现本地缓存 + 平台实时查询两级策略。核心模块：`OrderAdapter`（6 个方法接口）、`OrderService`（12 个公共服务方法）、`OrderCache`（7 表 Schema）。新平台接入仅需实现 `OrderAdapter` 接口，预估 2-3 天/平台。
