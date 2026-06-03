-- ============================================
-- PostgreSQL Base Setup (runs at container init)
-- Extensions + helper functions only.
-- RLS & indexes are applied via prisma/post-migrate.sql
-- after Prisma creates the tables.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create tenant-aware session variable
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Bypass RLS for system-level operations
CREATE OR REPLACE FUNCTION bypass_rls()
RETURNS boolean AS $$
BEGIN
  RETURN NULLIF(current_setting('app.bypass_rls', true), '')::boolean;
END;
$$ LANGUAGE plpgsql STABLE;
