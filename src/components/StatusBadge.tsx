import { clsx } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'primary';
const map: Record<Tone, string> = {
  success: 'bg-success/12 text-success border-success/20',
  warning: 'bg-warning/12 text-amber-600 border-warning/20',
  danger: 'bg-danger/12 text-danger border-danger/20',
  info: 'bg-sky-100 text-sky-700 border-sky-200',
  muted: 'bg-slate-100 text-slate-600 border-slate-200',
  primary: 'bg-primary/10 text-primary border-primary/20'
};
export function StatusBadge({ children, tone='primary' }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={clsx('status-badge inline-flex items-center justify-center rounded-lg border px-3 py-1 text-xs font-bold', map[tone])}>{children}</span>;
}
