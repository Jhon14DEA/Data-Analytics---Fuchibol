import { NextResponse } from "next/server";
import { getPerformanceMetrics } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), metrics: getPerformanceMetrics() });
}