import { NextResponse } from "next/server";
import { searchFootballMatchesDetailed } from "@/providers";
import { measureProcess } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const date = searchParams.get("date") ?? undefined;

  if (!query.trim()) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const result = await measureProcess("search", () => searchFootballMatchesDetailed(query, date));
    return NextResponse.json(
      { matches: result.matches.slice(0, 20), diagnostics: result.diagnostics },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        matches: [],
        diagnostics: {
          term: query,
          provider: "AllSportsApi",
          searchedRanges: date ? [date] : ["±7 dias", "±30 dias"],
          apiResults: 0,
          filteredOut: 0,
          filterReasons: [error instanceof Error ? error.message : "error desconocido consultando proveedor"],
          cacheHits: 0,
          cacheMisses: 1,
          endpoints: ["Fixtures"]
        }
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
