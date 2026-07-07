export function LoadingIndicator({ label, compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={compact ? "loading-indicator loading-indicator-compact" : "loading-indicator"} role="status" aria-live="polite">
      <span className="loading-wave" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      {label ? <span className="loading-label">{label}</span> : <span className="sr-only">جاري التحميل</span>}
    </div>
  );
}
