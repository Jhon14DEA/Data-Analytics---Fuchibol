import { NextResponse } from "next/server";
import { getAlertConfiguration, saveAlertConfiguration } from "@/lib/matchAlertRegistry";
import type { MatchAlertRuleType } from "@/types/domain";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json(getAlertConfiguration(id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    rules?: Partial<Record<MatchAlertRuleType, boolean>>;
  };
  const config = saveAlertConfiguration(id, body.rules ?? {}, body.enabled ?? true);
  return NextResponse.json({ saved: true, config }, { headers: { "Cache-Control": "no-store" } });
}
