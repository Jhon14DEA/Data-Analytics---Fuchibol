import { NextResponse } from "next/server";
import { searchFootballMatches } from "@/providers";
import { measureProcess } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await measureProcess("search", () => searchFootballMatches(query));
  return NextResponse.json({ matches: matches.slice(0, 20) }, { headers: { "Cache-Control": "private, max-age=30" } });
}
