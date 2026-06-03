import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { nanoid } from "nanoid";
import type { ApiResponse } from "@/types";

const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? "10", 10)) * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No files provided" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    const urls: string[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { success: false, error: `File ${file.name} exceeds max size` } satisfies ApiResponse,
          { status: 413 },
        );
      }

      const ext = file.name.split(".").pop() ?? "bin";
      const filename = `${nanoid()}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(join(UPLOAD_DIR, filename), buffer);

      urls.push(`/uploads/${filename}`);
    }

    return NextResponse.json({
      success: true,
      data: { urls },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Upload failed" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}
