import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "btn-shine bg-gradient-to-b from-brand-600 to-brand-800 text-white shadow-md shadow-brand-900/25 ring-1 ring-inset ring-white/15 hover:from-brand-500 hover:to-brand-700 hover:shadow-glow-brand",
  accent: "btn-shine bg-gradient-to-b from-accent-400 to-accent-600 text-white shadow-glow ring-1 ring-inset ring-white/15 hover:from-accent-300 hover:to-accent-500",
  secondary: "bg-surface text-fg border border-line hover:bg-surface-2 shadow-sm",
  outline: "border border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-200 dark:hover:bg-brand-900/40",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-sm ring-1 ring-inset ring-white/15 hover:from-red-400 hover:to-red-600",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center font-semibold transition-all duration-200 ease-smooth hover:-translate-y-px active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-60",
    variants[variant],
    sizes[size],
    className,
  );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button ref={ref} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  prefetch,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode; prefetch?: boolean } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
