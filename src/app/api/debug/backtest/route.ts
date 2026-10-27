import { NextResponse } from "next/server";
import { runBasicGoalBacktest, runGoalPressureSignalBacktest } from "@/services/analysis/backtest";

export const dynamic = "force-dynamic";

export async function GET() {
  const [summary, goalPressure] = await Promise.all([
    runBasicGoalBacktest(),
    runGoalPressureSignalBacktest()
  ]);
  return NextResponse.json({ summary, goalPressure });
}
