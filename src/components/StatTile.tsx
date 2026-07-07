import { Icon } from './Icons';
import { clsx } from '@/lib/utils';

type Tone = 'blue' | 'green' | 'orange' | 'purple' | 'red';
const tones: Record<Tone, string> = {
  blue: 'bg-sky-100 text-sky-600 ring-sky-200',
  green: 'bg-emerald-100 text-emerald-600 ring-emerald-200',
  orange: 'bg-orange-100 text-orange-600 ring-orange-200',
  purple: 'bg-violet-100 text-violet-600 ring-violet-200',
  red: 'bg-rose-100 text-rose-600 ring-rose-200'
};
export function StatTile({ title, value, hint, icon, tone='blue', dangerHint=false }: { title: string; value: string | number; hint?: string; icon: string; tone?: Tone; dangerHint?: boolean }) {
  return <div className="premium-card min-h-[140px]">
    <div className="flex items-start justify-between gap-4">
      <div className={clsx('grid h-14 w-14 place-items-center rounded-full ring-1', tones[tone])}><Icon name={icon} className="h-7 w-7"/></div>
      <div className="text-right">
        <p className="text-sm font-medium text-slate-600">{title}</p>
        <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 number-ltr">{value}</p>
        {hint ? <p className={clsx('mt-2 text-xs font-bold', dangerHint ? 'text-danger' : 'text-slate-500')}>{hint}</p> : null}
      </div>
    </div>
  </div>;
}
