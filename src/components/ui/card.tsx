import { cn } from "@/lib/cn";

export function Card({ className, children, interactive, ...p }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cn("card", interactive && "card-interactive", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
