import { Suspense } from "react";
import { MfaForm } from "@/components/auth/mfa-form";

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
