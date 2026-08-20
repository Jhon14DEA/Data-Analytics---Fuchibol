import { NextResponse } from "next/server";
import { searchFootballMatches } from "@/providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await searchFootballMatches(query);
  return NextResponse.json({ matches: matches.slice(0, 20) });
}
