export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="premium-card animate-pulse">
      <div className="h-5 w-40 rounded-full bg-slate-200" />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: lines }).map((_, index) => <div key={index} className="h-4 rounded-full bg-slate-100" />)}
      </div>
    </div>
  );
}
