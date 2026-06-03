/**
 * Seed script — populates demo data for development.
 * Run: npx tsx prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-tenant" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Demo Electronics Store",
      slug: "demo-tenant",
      plan: "pro",
      isActive: true,
      settings: {
        timezone: "Asia/Shanghai",
        locale: "zh-CN",
        supportedChannels: ["web", "mobile"],
      },
    },
  });
  console.log(`  Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Create demo user
  const user = await prisma.customerUser.upsert({
    where: { tenantId_externalId: { tenantId: tenant.id, externalId: "user-1" } },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      tenantId: tenant.id,
      externalId: "user-1",
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+86-13800138000",
    },
  });
  console.log(`  User: ${user.name} (${user.id})`);

  // 3. Seed products
  const products = [
    { sku: "IP16P-256-NT", name: "iPhone 16 Pro 256GB Natural Titanium", description: "Apple iPhone 16 Pro with A18 Pro chip, 256GB storage, Natural Titanium finish", price: 8999.00, stock: 12, category: "Smartphones" },
    { sku: "IP16P-512-NT", name: "iPhone 16 Pro 512GB Natural Titanium", description: "Apple iPhone 16 Pro with A18 Pro chip, 512GB storage, Natural Titanium finish", price: 9999.00, stock: 5, category: "Smartphones" },
    { sku: "MAC-M3-15", name: "MacBook Air M3 15\"", description: "Apple MacBook Air with M3 chip, 15-inch Liquid Retina display, 16GB RAM, 512GB SSD", price: 10999.00, stock: 8, category: "Laptops" },
    { sku: "AIRPODS-PRO2", name: "AirPods Pro 2nd Gen", description: "Apple AirPods Pro 2 with Active Noise Cancellation, Adaptive Audio, USB-C", price: 1899.00, stock: 25, category: "Audio" },
    { sku: "AW-ULTRA2", name: "Apple Watch Ultra 2", description: "Apple Watch Ultra 2 with precision dual-frequency GPS, 49mm titanium case", price: 6499.00, stock: 3, category: "Wearables" },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: product.sku } },
      update: { stock: product.stock, price: product.price },
      create: { tenantId: tenant.id, ...product },
    });
  }
  console.log(`  Products: ${products.length} seeded`);

  // 4. Seed knowledge base entries
  const knowledgeEntries = [
    { title: "Return Policy", content: "Our standard return policy allows returns within 30 days of purchase. Items must be in original condition with all accessories and packaging. Electronics must be unopened for full refund. Opened items are subject to a 15% restocking fee. Defective items can be returned within the warranty period at no cost.", category: "policy" },
    { title: "Warranty Information", content: "All products come with a 1-year limited warranty covering manufacturing defects. Extended warranty (AppleCare+) is available for Apple products — 2 years total coverage including accidental damage with service fee. Warranty does not cover: accidental damage (without AppleCare+), unauthorized modifications, loss/theft, normal wear and tear.", category: "policy" },
    { title: "Shipping & Delivery", content: "Free standard shipping on orders over ¥500. Estimated delivery: 2-5 business days for major cities, 5-10 business days for remote areas. Express shipping available for ¥50 extra (1-2 business days). All shipments are insured and trackable. International shipping available to select countries.", category: "policy" },
    { title: "iPhone 16 Pro Features", content: "iPhone 16 Pro features: A18 Pro chip with 16-core Neural Engine, 48MP Fusion camera system with 5x optical zoom, ProMotion 120Hz display, Titanium design, USB-C 3.2, Wi-Fi 7, Action button, Camera Control button, up to 29 hours video playback. Available in Natural Titanium, Blue Titanium, White Titanium, Black Titanium. Storage: 256GB/512GB/1TB.", category: "product_info" },
    { title: "MacBook Air M3 Comparison", content: "MacBook Air M3 (13-inch vs 15-inch): Both feature M3 chip with 8-core CPU, up to 10-core GPU. 13-inch: 13.6\" Liquid Retina, 1.24 kg, starts at ¥8,999 (8GB/256GB). 15-inch: 15.3\" Liquid Retina, 1.51 kg, starts at ¥10,999 (16GB/512GB). Both offer: 18-hour battery, MagSafe charging, 1080p camera, Touch ID, two Thunderbolt/USB 4 ports. The 15-inch includes 6-speaker sound system vs 4-speaker on 13-inch.", category: "product_info" },
    { title: "Payment Methods", content: "We accept: Credit/Debit cards (Visa, Mastercard, UnionPay), Alipay, WeChat Pay, Apple Pay, bank transfer (for orders over ¥10,000). Installment plans available through Alipay Huabei (3/6/12 months) and credit cards. Corporate purchasing with PO available for business accounts.", category: "policy" },
  ];

  for (const entry of knowledgeEntries) {
    await prisma.knowledgeBase.create({
      data: { tenantId: tenant.id, ...entry },
    });
  }
  console.log(`  Knowledge Base: ${knowledgeEntries.length} entries seeded`);

  // 5. Seed complaint cases
  const complaintCases = [
    { title: "Screen defect on new iPhone", description: "Customer received iPhone 16 Pro with a visible dead pixel cluster on the top right corner of the screen. Device was unboxed today.", category: "defect", severity: "high", resolution: "Immediate replacement authorized. Customer returned defective unit and received new replacement within 3 business days. Compensation: ¥200 store credit for inconvenience." },
    { title: "AirPods charging issue", description: "AirPods Pro 2 left earbud not charging in case. Case shows green light but left pod stays at 0%. Had for 3 months.", category: "defect", severity: "medium", resolution: "Diagnosed as charging contact issue. Cleaned contacts remotely with customer. When issue persisted, replaced left AirPod under warranty. Process took 5 days total." },
    { title: "Late delivery — MacBook", description: "MacBook Air M3 15\" ordered with express shipping (1-2 day promise). Order placed Monday, arrived Friday. Customer missed important presentation.", category: "delivery", severity: "medium", resolution: "Refunded express shipping fee (¥50). Apologized for courier delay. Updated shipping SLA monitoring." },
    { title: "Wrong color shipped", description: "Ordered iPhone 16 Pro in Natural Titanium, received Blue Titanium. Customer specifically chose Natural for professional appearance.", category: "fulfillment", severity: "medium", resolution: "Cross-ship correct color immediately. Provided return label for wrong item. ¥100 store credit for trouble. Root cause: warehouse picker scanned wrong shelf bin." },
    { title: "Battery drain issue", description: "iPhone 16 Pro battery draining 40% overnight with no apps running. Purchased 1 month ago. Customer tried resetting and updating iOS.", category: "technical", severity: "high", resolution: "Remote diagnostics showed background process stuck. Guided customer through DFU restore. Battery normalized after restore. Followed up after 3 days — issue resolved." },
  ];

  for (const c of complaintCases) {
    await prisma.complaintCase.create({
      data: { tenantId: tenant.id, ...c },
    });
  }
  console.log(`  Complaint Cases: ${complaintCases.length} seeded`);

  // 6. Seed agent configs
  const agentConfigs = [
    { agentName: "intent_classifier", config: { temperature: 0.1, maxTokens: 512, confidenceThreshold: 0.5 } },
    { agentName: "presale", config: { temperature: 0.5, maxTokens: 2048, topKResults: 5, includeInventory: true } },
    { agentName: "aftersale", config: { temperature: 0.4, maxTokens: 2048, topKResults: 5, autoEscalateSeverity: ["critical", "high"] } },
    { agentName: "supervisor", config: { temperature: 0.2, maxTokens: 1024, autoResolveThreshold: 0.8 } },
  ];

  for (const config of agentConfigs) {
    await prisma.agentConfig.upsert({
      where: { tenantId_agentName: { tenantId: tenant.id, agentName: config.agentName } },
      update: { config: config.config },
      create: { tenantId: tenant.id, ...config },
    });
  }
  console.log(`  Agent Configs: ${agentConfigs.length} seeded`);

  console.log("\nSeed complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
