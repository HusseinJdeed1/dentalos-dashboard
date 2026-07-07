import { Icon } from './Icons';

export function AccessDenied({ title = 'غير مسموح', description = 'هذه الصفحة مخصصة للطبيب أو المدير فقط.' }: { title?: string; description?: string }) {
  return (
    <div className="premium-card mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-warning/10 text-warning">
        <Icon name="alert" className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black text-slate-900">{title}</h1>
      <p className="mt-3 text-slate-500 leading-7">{description}</p>
    </div>
  );
}
