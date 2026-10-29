export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-9 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="skeleton h-80 rounded-2xl" />
    </div>
  );
}
