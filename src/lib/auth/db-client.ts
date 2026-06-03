import { PrismaClient } from "@prisma/client";
import { config } from "@/lib/utils/config";
import type { TenantContext } from "@/types";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: config.isDev ? ["warn", "error"] : ["error"],
});

if (config.isDev) globalForPrisma.prisma = prisma;

/**
 * Execute a query within a tenant context (Row Level Security).
 * Sets the session-level tenant_id variable so RLS policies apply.
 */
export async function withTenant<T>(
  tenant: TenantContext,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  const tenantParam = tenant.tenantId;

  if (tenant.bypassRls) {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.bypass_rls', 'true', true)`,
    );
  }

  await prisma.$executeRawUnsafe(
    `SELECT set_tenant_context($1::uuid)`,
    tenantParam,
  );

  try {
    const result = await fn(prisma);
    return result;
  } finally {
    await prisma.$executeRawUnsafe(`RESET app.current_tenant_id`);
    if (tenant.bypassRls) {
      await prisma.$executeRawUnsafe(`RESET app.bypass_rls`);
    }
  }
}

/**
 * Create a tenant-scoped transaction
 */
export async function withTenantTx<T>(
  tenant: TenantContext,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_tenant_context($1::uuid)`,
      tenant.tenantId,
    );
    return fn(tx);
  });
}
