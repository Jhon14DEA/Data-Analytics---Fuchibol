import { NextResponse } from "next/server";
import { getMatchAnalysisContext } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

type Params = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const context = await getMatchAnalysisContext(id);

  if (!context) {
    return NextResponse.json({ error: "Partido no encontrado" }, { status: 404 });
  }

  return NextResponse.json(analyzeMatchContext(context), { headers: { "Cache-Control": "no-store" } });
}
