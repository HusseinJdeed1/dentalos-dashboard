import type React from 'react';
import { Icon } from './Icons';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-white/70 p-8 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon name="file" className="h-7 w-7" />
      </div>
      <p className="mt-4 text-lg font-black text-slate-900">{title}</p>
      {description ? <p className="mx-auto mt-2 max-w-xl text-sm font-bold leading-7 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
