import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

const palette = ["from-brand-500 to-brand-700", "from-accent-400 to-accent-600", "from-violet-500 to-brand-700", "from-sky-500 to-brand-600", "from-emerald-500 to-teal-700"];

export function Avatar({ name, src, size = 36, className }: { name: string | null | undefined; src?: string | null; size?: number; className?: string }) {
  const idx = ((name ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) || 0) % palette.length;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name ?? ""} width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white", palette[idx], className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}
