/**
 * Case Engine REST API
 *
 * POST   /api/cases              — Create a case
 * GET    /api/cases              — List cases
 * GET    /api/cases?search=...   — Search similar cases
 * PATCH  /api/cases/:id          — Update a case
 * POST   /api/cases/:id/feedback — Record feedback
 */

import { NextRequest, NextResponse } from "next/server";
import { CaseService } from "@/domains/case";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

// ── POST /api/cases ───────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const tenant = extractTenant(req.headers);
    const body = await req.json();

    const { issue, solution, productId, category, severity, ticketId, tags } = body;
    if (!issue || !solution) {
      return NextResponse.json(
        { success: false, error: "issue and solution are required" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    const case_ = await CaseService.createCase({
      tenantId: tenant.tenantId,
      productId,
      issue,
      solution,
      category,
      severity,
      ticketId,
      tags,
    });

    return NextResponse.json({
      success: true,
      data: case_,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Create case error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create case" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

// ── GET /api/cases ────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const tenant = extractTenant(req.headers);
    const url = req.nextUrl;
    const searchQuery = url.searchParams.get("search");
    const category = url.searchParams.get("category") ?? undefined;
    const productId = url.searchParams.get("productId") ?? undefined;
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") ?? "20", 10);

    if (searchQuery) {
      // Search mode — use Matcher + Ranker
      const matchMode = (url.searchParams.get("mode") ?? "hybrid") as "keyword" | "vector" | "hybrid";
      const topK = parseInt(url.searchParams.get("topK") ?? "5", 10);

      const results = await CaseService.searchSimilar({
        tenantId: tenant.tenantId,
        query: searchQuery,
        category,
        productId,
        topK,
        matchMode,
      });

      return NextResponse.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse);
    }

    // List mode
    const result = await CaseService.listCases(tenant.tenantId, {
      category,
      productId,
      page,
      pageSize,
    });

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] List cases error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch cases" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

// ── PATCH /api/cases/:id ──────────────────────────────────
// Handled via route group — see route.ts in [id] directory
