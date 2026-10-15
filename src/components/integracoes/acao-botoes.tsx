"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, Loader2, Newspaper } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";

/** Botão "Sincronizar com o Google" (envia prazos e compromissos pendentes do usuário). */
export function SincronizarAgendaButton({ action }: { action: () => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      title="Enviar ao Google Agenda os prazos e compromissos ainda não sincronizados"
      onClick={() =>
        start(async () => {
          const r = await action();
          toast(r.ok ? (r.message ?? "Agenda sincronizada.") : (r.error ?? "Falha ao sincronizar."), r.ok ? "success" : "error");
          if (r.ok) router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarSync className="h-4 w-4" />} Sincronizar Google
    </Button>
  );
}

/** Busca de intimações no DJEN com escolha do período. */
export function BuscarDjenButton({ action, escopo }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; escopo: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const toast = useToast();
  const router = useRouter();
  const last = useRef<ActionState>({});
  useEffect(() => {
    if (state === last.current || (!state.ok && !state.error)) return;
    last.current = state;
    toast(state.ok ? (state.message ?? "Busca concluída.") : (state.error ?? "Falha na busca."), state.ok ? "success" : "error");
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router]);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Newspaper className="h-4 w-4" /> Buscar no DJEN
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Buscar intimações no DJEN">
        <form action={formAction} className="space-y-4">
          <p className="text-sm text-muted">
            Consulta o Diário de Justiça Eletrônico Nacional (Comunica PJe/CNJ) pelas OABs {escopo}. As comunicações novas entram na caixa de publicações e
            são vinculadas automaticamente ao processo pelo número CNJ. A data de publicação é o 1º dia útil seguinte à disponibilização.
          </p>
          <div>
            <label className="label" htmlFor="djen-dias">Período</label>
            <select id="djen-dias" name="dias" defaultValue="7" className="input">
              <option value="1">Hoje e ontem</option>
              <option value="3">Últimos 3 dias</option>
              <option value="7">Últimos 7 dias</option>
              <option value="15">Últimos 15 dias</option>
              <option value="30">Últimos 30 dias</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="accent" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Newspaper className="h-4 w-4" />} Buscar
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
