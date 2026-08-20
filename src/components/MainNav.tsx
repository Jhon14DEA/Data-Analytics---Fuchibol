import Link from "next/link";
import { Activity, Bell, Search, Target } from "lucide-react";

const links = [
  { href: "/", label: "Partidos", Icon: Activity },
  { href: "/opportunities", label: "Oportunidades", Icon: Target },
  { href: "/analyze", label: "Analizar partido", Icon: Search },
  { href: "/alerts", label: "Alertas", Icon: Bell }
];

export function MainNav() {
  return (
    <nav className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {links.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="inline-flex items-center justify-center gap-2 rounded border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-bold text-zinc-200 transition hover:border-emerald-300/40 hover:bg-white/[0.075]"
        >
          <Icon className="h-4 w-4 text-emerald-300" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
