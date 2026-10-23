"use client";
import { useRef, useState } from "react";
import { Camera, Check } from "lucide-react";
import { carregarImagem, paraJpeg } from "@/lib/campo/imagem";

/** Foto pela câmera (comprovante, hodômetro, selfie), comprimida no aparelho (< 1 MB). */
export function FotoInput({ label, onFoto, frontal = false }: { label: string; onFoto: (b: Blob | null) => void; frontal?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [ok, setOk] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={frontal ? "user" : "environment"}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const c = await carregarImagem(f);
          const { blob } = await paraJpeg(c, 700_000);
          onFoto(blob);
          setOk(true);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => ref.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2.5 text-sm font-semibold">
        {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Camera className="h-4 w-4" />} {ok ? `${label} ✓` : label}
      </button>
    </>
  );
}
