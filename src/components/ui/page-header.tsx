export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="reveal mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-600">
            <span className="h-[2px] w-5 rounded-full bg-gradient-to-r from-accent-500 to-accent-300" />
            {eyebrow}
          </div>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
