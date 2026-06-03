export type Locale = "zh" | "en";

export type TranslationKey = keyof typeof translations.zh;

export const translations = {
  zh: {
    // Sidebar
    "sidebar.title": "CSP 客服平台",
    "sidebar.subtitle": "多智能体 v1.0",
    "sidebar.newChat": "+ 新建会话",
    "sidebar.noConversations": "暂无会话",
    "sidebar.noConversationsHint": "开始新对话吧",
    "sidebar.tenant": "租户",
    "sidebar.version": "v1.0.0",

    // Chat Area Header
    "chat.header.active": "智能客服对话",
    "chat.header.new": "新建会话",
    "chat.header.connected": "已连接 (实时)",
    "chat.header.restMode": "REST 模式",
    "chat.header.agent": "智能体",
    "chat.header.agents": "智能体面板",

    // Chat Area Welcome
    "chat.welcome.title": "欢迎使用 CSP 客服平台",
    "chat.welcome.subtitle": "我是您的智能客服助手，由多智能体系统驱动。您可以咨询产品、查询订单或获取任何问题的支持。",

    // Chat Area Input
    "chat.input.placeholder": "输入您的消息... (Enter 发送, Shift+Enter 换行)",
    "chat.input.send": "发送",
    "chat.input.attachImages": "上传图片",

    // Chat Area Messages
    "chat.recommendations": "推荐",

    // Chat Area Processing
    "chat.processing": "正在处理...",

    // Agent Panel
    "agent.monitor": "智能体监控",
    "agent.description": "多智能体工作流管道。各智能体根据意图分类按顺序处理消息。",
    "agent.workflowPipeline": "工作流管道",
    "agent.registeredAgents": "已注册智能体",
    "agent.intentClassifier": "意图分类器",
    "agent.presale": "售前智能体",
    "agent.aftersale": "售后智能体",
    "agent.supervisor": "主管智能体",
    "agent.presaleAftersale": "售前 / 售后",

    // Chat Area Header (additional)
    "chat.header.products": "产品面板",

    // Product Panel
    "product.title": "产品管理",
    "product.addProduct": "添加产品",
    "product.editProduct": "编辑产品",
    "product.sku": "SKU",
    "product.name": "名称",
    "product.description": "描述",
    "product.price": "价格",
    "product.stock": "库存",
    "product.category": "分类",
    "product.add": "添加",
    "product.save": "保存",
    "product.cancel": "取消",
    "product.edit": "编辑",
    "product.delete": "删除",
    "product.inStock": "库存",
    "product.outOfStock": "缺货",
    "product.empty": "暂无产品，点击上方按钮添加",
    "product.count": "产品列表 ({count})",
    "product.errorRequired": "SKU 和名称为必填项",
    "product.errorSave": "保存失败，请重试",
    "product.imageUrls": "产品图片",
    "product.imageUrlsHint": "输入图片URL，多个以逗号分隔",
    "product.errorNetwork": "网络错误，请检查连接",

    // Confirm Dialog
    "dialog.deleteTitle": "删除会话",
    "dialog.deleteMessage": "确定要删除此会话吗？此操作不可撤销。",
    "dialog.keepSolution": "保留解决方案（仅删除对话记录，保留问题处理结果）",
    "dialog.cancel": "取消",
    "dialog.confirm": "删除",
    "dialog.deleting": "删除中...",
  },
  en: {
    // Sidebar
    "sidebar.title": "CSP Platform",
    "sidebar.subtitle": "Multi-Agent v1.0",
    "sidebar.newChat": "+ New Conversation",
    "sidebar.noConversations": "No conversations yet.",
    "sidebar.noConversationsHint": "Start a new chat to begin.",
    "sidebar.tenant": "Tenant",
    "sidebar.version": "v1.0.0",

    // Chat Area Header
    "chat.header.active": "Customer Service Chat",
    "chat.header.new": "New Conversation",
    "chat.header.connected": "Connected (real-time)",
    "chat.header.restMode": "REST mode",
    "chat.header.agent": "Agent",
    "chat.header.agents": "Agents",

    // Chat Area Welcome
    "chat.welcome.title": "Welcome to CSP",
    "chat.welcome.subtitle": "I'm your intelligent customer service assistant powered by a multi-agent system. Ask about products, check orders, or get support for any issues.",

    // Chat Area Input
    "chat.input.placeholder": "Type your message... (Enter to send, Shift+Enter for new line)",
    "chat.input.send": "Send",
    "chat.input.attachImages": "Attach images",

    // Chat Area Messages
    "chat.recommendations": "Recommendations",

    // Chat Area Processing
    "chat.processing": "Processing...",

    // Agent Panel
    "agent.monitor": "Agent Monitor",
    "agent.description": "Multi-agent workflow pipeline. Agents process messages in sequence based on intent classification.",
    "agent.workflowPipeline": "Workflow Pipeline",
    "agent.registeredAgents": "Registered Agents",
    "agent.intentClassifier": "Intent Classifier",
    "agent.presale": "Presale Agent",
    "agent.aftersale": "AfterSale Agent",
    "agent.supervisor": "Supervisor Agent",
    "agent.presaleAftersale": "Presale / AfterSale",

    // Chat Area Header (additional)
    "chat.header.products": "Products",

    // Product Panel
    "product.title": "Product Management",
    "product.addProduct": "Add Product",
    "product.editProduct": "Edit Product",
    "product.sku": "SKU",
    "product.name": "Name",
    "product.description": "Description",
    "product.price": "Price",
    "product.stock": "Stock",
    "product.category": "Category",
    "product.add": "Add",
    "product.save": "Save",
    "product.cancel": "Cancel",
    "product.edit": "Edit",
    "product.delete": "Delete",
    "product.inStock": "In stock",
    "product.outOfStock": "Out of stock",
    "product.empty": "No products yet. Click the button above to add.",
    "product.count": "Products ({count})",
    "product.errorRequired": "SKU and Name are required",
    "product.errorSave": "Save failed, please retry",
    "product.imageUrls": "Product Images",
    "product.imageUrlsHint": "Enter image URLs, comma-separated",
    "product.errorNetwork": "Network error, please check connection",

    // Confirm Dialog
    "dialog.deleteTitle": "Delete Conversation",
    "dialog.deleteMessage": "Are you sure you want to delete this conversation? This action cannot be undone.",
    "dialog.keepSolution": "Keep the solution (only delete chat history, retain the resolution)",
    "dialog.cancel": "Cancel",
    "dialog.confirm": "Delete",
    "dialog.deleting": "Deleting...",
  },
} as const;
