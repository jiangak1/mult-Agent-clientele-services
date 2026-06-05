import { NextRequest, NextResponse } from "next/server";
import { CaseService } from "@/domains/case";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

// ── GET /api/cases/:id ────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenant = extractTenant(req.headers);
  const { id } = await params;

  const case_ = await CaseService.getCase(tenant.tenantId, id);
  if (!case_) {
    return NextResponse.json(
      { success: false, error: "Case not found" } satisfies ApiResponse,
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    data: case_,
    timestamp: new Date().toISOString(),
  } satisfies ApiResponse);
}

// ── PATCH /api/cases/:id ──────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = extractTenant(req.headers);
    const { id } = await params;
    const body = await req.json();

    const ok = await CaseService.updateCase(tenant.tenantId, id, body);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Update failed" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: { id, updated: true },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Update case error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update case" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

// ── POST /api/cases/:id/feedback ──────────────────────────
// Handled via separate route — see feedback/route.ts
