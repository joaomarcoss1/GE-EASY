"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2 } from "lucide-react";
import { prorrogarExigencia } from "@/lib/actions/comercial";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

function diasAte(iso: string) {
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  hoje.setHours(0, 0, 0, 0);
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round((new Date(a, m - 1, d).getTime() - hoje.getTime()) / 86_400_000);
}

/** Prazo da exigência (7 dias, prorrogável uma vez por mais 7) com o botão de prorrogar. */
export function ExigenciaPrazo({ casoId, prazo, prorrogada, podeProrrogar }: { casoId: string; prazo: string | null; prorrogada: boolean; podeProrrogar: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (!prazo) return null;
  const d = diasAte(prazo);
  const [a, m, dia] = prazo.split("-");
  const texto = d < 0 ? `vencida há ${-d} dia(s)` : d === 0 ? "vence hoje" : `${d} dia(s)`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        title={`Prazo da exigência: ${dia}/${m}/${a}${prorrogada ? " (já prorrogada)" : ""}`}
        className={cn(
          "rounded-md px-2 py-0.5 text-[11px] font-bold",
          d < 0 ? "bg-red-600 text-white" : d <= 2 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
        )}
      >
        Exigência: {texto}{prorrogada ? " · prorrogada" : ""}
      </span>
      {podeProrrogar && !prorrogada && (
        <button
          type="button"
          disabled={pending}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline disabled:opacity-60 dark:text-brand-300"
          onClick={() => {
            if (!window.confirm("Prorrogar o prazo desta exigência por mais 7 dias? Só é possível prorrogar uma vez.")) return;
            start(async () => {
              const r = await prorrogarExigencia(casoId);
              toast(r.ok ? (r.message ?? "Prazo prorrogado.") : (r.error ?? "Não foi possível prorrogar."), r.ok ? undefined : "error");
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3" />}Prorrogar +7
        </button>
      )}
    </span>
  );
}
