import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseTrainingFilters, trainingSummary } from "@/services/training/liveMarketSnapshots";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let filters;
  try { filters = parseTrainingFilters(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid filters" }, { status: 400 }); }
  try {
    const summary = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return trainingSummary(filters, tx);
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "TRAINING_DATABASE_ERROR" }, { status: 503 });
  }
}
