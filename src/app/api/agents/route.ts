import { NextResponse } from "next/server";
import { AgentRegistry } from "@/lib/agents";
import type { ApiResponse } from "@/types";

export async function GET() {
  const agents = AgentRegistry.getAll().map((a) => ({
    type: a.type,
    name: a.name,
    capabilities: a.capabilities,
  }));

  return NextResponse.json({
    success: true,
    data: agents,
    timestamp: new Date().toISOString(),
  } satisfies ApiResponse);
}
