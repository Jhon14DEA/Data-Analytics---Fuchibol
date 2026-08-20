import { NextResponse } from "next/server";
import { getFootballDebugStatus } from "@/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const debug = await getFootballDebugStatus();
  return NextResponse.json(debug);
}
