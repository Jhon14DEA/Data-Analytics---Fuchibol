import { NextResponse } from "next/server";
import { allSportsApiProvider } from "@/providers";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  if (!allSportsApiProvider.isConfigured()) {
    return NextResponse.json({ provider: "AllSportsApi", configured: false, message: "AllSportsApi no configurada" }, { status: 503 });
  }

  const debug = await allSportsApiProvider.debugMarkets(id);
  return NextResponse.json(debug, { headers: { "Cache-Control": "no-store" } });
}
