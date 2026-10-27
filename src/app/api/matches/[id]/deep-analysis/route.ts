import { NextResponse } from "next/server";
import { measureProcess } from "@/lib/performance";
import { getDeepMatchAnalysis } from "@/services/analysis/deepMatchAnalysis";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const analysis = await measureProcess("deep-analysis", () => getDeepMatchAnalysis(id));

  if (!analysis) {
    return NextResponse.json({ message: "Partido no encontrado" }, { status: 404 });
  }

  return NextResponse.json(analysis, { headers: { "Cache-Control": "private, max-age=30" } });
}
