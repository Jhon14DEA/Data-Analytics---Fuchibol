import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AnalysisSummary } from "@/components/AnalysisSummary";
import { MainNav } from "@/components/MainNav";
import { getMatchAnalysisContext } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: PageProps) {
  const { id } = await params;
  const context = await getMatchAnalysisContext(id);

  if (!context) {
    notFound();
  }

  const analysis = analyzeMatchContext(context);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <div className="mb-5">
        <Link href="/analyze" className="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" />
          Buscar otro partido
        </Link>
      </div>
      <AnalysisSummary analysis={analysis} />
    </main>
  );
}
