"use client";
import { useActionState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { ResourceForm, SubmitButton, type FieldDef, type Values } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** ResourceForm para páginas de configuração: atualiza a tela após salvar. */
export function SettingsForm({ action, fields, values, hidden, submitLabel = "Salvar alterações" }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; fields: FieldDef[]; values?: Values; hidden?: Values; submitLabel?: string }) {
  const router = useRouter();
  const onSuccess = useCallback(() => router.refresh(), [router]);
  return (
    <div className="px-6 pt-5">
      <ResourceForm action={action} fields={fields} values={values} hidden={hidden} submitLabel={submitLabel} onSuccess={onSuccess} />
    </div>
  );
}

/** Troca de senha (reutiliza a Server Action updatePassword). */
export function PasswordForm({ action }: { action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const last = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      toast(state.message ?? "Senha alterada.");
      formRef.current?.reset();
    }
  }, [state, toast]);

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      {state.error && (
        <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}
      {state.ok && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {state.message}
        </p>
      )}
      <div>
        <label htmlFor="current-password" className="label">
          Senha atual
        </label>
        <input id="current-password" name="atual" type="password" required maxLength={128} autoComplete="current-password" className="input" aria-invalid={state.fieldErrors?.atual ? true : undefined} />
        {state.fieldErrors?.atual && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.atual}</p>}
      </div>
      <div>
        <label htmlFor="new-password" className="label">
          Nova senha
        </label>
        <input id="new-password" name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className="input" aria-invalid={state.fieldErrors?.password ? true : undefined} />
        <p className="mt-1 text-xs text-muted">Mínimo de 10 caracteres, com maiúsculas, minúsculas e números.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="label">
          Confirmar nova senha
        </label>
        <input id="confirm-password" name="confirm" type="password" required autoComplete="new-password" className="input" aria-invalid={state.fieldErrors?.confirm ? true : undefined} />
      </div>
      <SubmitButton>Alterar senha</SubmitButton>
    </form>
  );
}
