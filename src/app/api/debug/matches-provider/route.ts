import { NextResponse } from "next/server";
import { allSportsApiProvider } from "@/providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? undefined;

  if (!allSportsApiProvider.isConfigured()) {
    return NextResponse.json(
      {
        provider: "AllSportsApi",
        configured: false,
        message: "AllSportsApi no configurada"
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const debug = await allSportsApiProvider.debugListMatches(date);
  return NextResponse.json(debug, { headers: { "Cache-Control": "no-store" } });
}
