-- ============================================
-- RLS & Indexes (run AFTER prisma db push)
-- Tables must already exist before this runs.
-- ============================================

-- Enable RLS on multi-tenant tables
ALTER TABLE "CustomerUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeBase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplaintCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserMemory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- RLS Policies: filter by current tenant
CREATE POLICY tenant_isolation ON "CustomerUser"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "Conversation"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "KnowledgeBase"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "ComplaintCase"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "Product"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "UserMemory"
  FOR ALL USING (
    "userId" IN (SELECT id FROM "CustomerUser" WHERE "tenantId" = get_current_tenant_id())
  );

CREATE POLICY tenant_isolation ON "AgentConfig"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

CREATE POLICY tenant_isolation ON "AuditLog"
  FOR ALL USING ("tenantId" = get_current_tenant_id());

-- Bypass RLS for system-level operations
CREATE POLICY bypass_rls_policy ON "CustomerUser"
  FOR ALL USING (bypass_rls() IS TRUE);

CREATE POLICY bypass_rls_policy ON "Conversation"
  FOR ALL USING (bypass_rls() IS TRUE);


