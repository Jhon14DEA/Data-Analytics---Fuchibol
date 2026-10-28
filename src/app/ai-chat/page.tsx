import { MainNav } from '@/components/MainNav';
import { AiChat } from '@/components/AiChat';

export default function AiChatPage() {
  return <main className="mx-auto max-w-6xl p-4 sm:p-6">
    <MainNav />
    <header className="mb-6"><p className="text-sm font-bold uppercase tracking-widest text-emerald-300">FUT Analytics</p>
      <h1 className="mt-2 text-3xl font-bold text-white">Conversa con FUT</h1>
      <p className="mt-2 text-sm text-zinc-400">Consulta lo observado, entiende la presión y revisa el histórico. Los datos ausentes son N/D.</p>
    </header>
    <AiChat />
  </main>;
}
