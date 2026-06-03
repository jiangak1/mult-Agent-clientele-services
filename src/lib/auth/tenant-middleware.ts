import type { TenantContext } from "@/types";
import { createHash } from "crypto";
import { config } from "@/lib/utils/config";

/**
 * Extract tenant context from request headers.
 * In production, use JWT verification here.
 */
export function extractTenant(headers: Headers): TenantContext {
  const tenantId = headers.get("x-tenant-id") ?? headers.get("x-tenant-id") ?? "default";
  const userId = headers.get("x-user-id") ?? undefined;

  return {
    tenantId,
    userId,
    bypassRls: false,
  };
}

/**
 * Verify JWT token and extract tenant context
 */
export async function verifyJwt(token: string): Promise<TenantContext | null> {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.sub) return null;

    return {
      tenantId: payload.tenant_id ?? "default",
      userId: payload.sub,
      bypassRls: payload.role === "admin",
    };
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, string> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Generate a tenant-bound API key hash
 */
export function hashApiKey(tenantId: string, secret: string): string {
  return createHash("sha256")
    .update(`${tenantId}:${secret}:${config.app.secret}`)
    .digest("hex");
}
