'use client';
import { useEffect, useMemo, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { StatTile } from '@/components/StatTile';
import { canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { Payment, TreatmentPlan } from '@/lib/types';
import { formatMoney, getCurrencySymbol, todayISO } from '@/lib/utils';

const paymentMethodLabels: Record<string, string> = { cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل', other: 'أخرى', insurance: 'تأمين' };
const paymentTypeLabels: Record<string, string> = { installment: 'قسط', down_payment: 'دفعة أولى', full_payment: 'دفعة كاملة', extra_payment: 'دفعة إضافية', refund: 'استرداد' };

function installmentLabel(payment: Payment) {
  const installment = payment.installments;
  if (!installment) return '—';
  return installment.installment_number ? `قسط رقم ${installment.installment_number}` : `قسط ${installment.due_date}`;
}

function PageContent({ staff, clinic }: AppContext) {
  const canView = canViewFullFinancials(staff);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const [payments, setPayments] = useState<Payment[]>([]), [plans, setPlans] = useState<TreatmentPlan[]>([]);

  useEffect(() => {
    async function load() {
      if (!staff || !canView) return;
      const [p, t] = await Promise.all([
        supabase.from('payments').select('*, patients(*), treatment_plans(*), installments(*)').eq('clinic_id', staff.clinic_id).order('payment_date', { ascending: false }),
        supabase.from('treatment_plans').select('*').eq('clinic_id', staff.clinic_id)
      ]);
      setPayments((p.data || []) as Payment[]);
      setPlans((t.data || []) as TreatmentPlan[]);
    }
    load();
  }, [staff?.clinic_id, canView]);

  const stats = useMemo(() => ({
    today: payments.filter((p) => p.payment_date === todayISO()).reduce((s, p) => s + Number(p.amount || 0), 0),
    total: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    remaining: plans.reduce((s, p) => s + Number(p.remaining_amount || 0), 0)
  }), [payments, plans]);

  if (!canView) return <AccessDenied title="الملخص المالي غير متاح" description="حساب السكرتيرة لا يملك صلاحية فتح صفحة الدفعات والأقساط أو رؤية الإيرادات والمتبقي الكامل. يمكن للطبيب أو المدير فقط فتح هذه الصفحة." />;

  return <div className="space-y-6"><div><h1 className="text-3xl font-black">الدفعات والأقساط</h1><p className="text-slate-500">متابعة مالية كاملة للمرضى وخطط العلاج.</p></div><div className="grid gap-4 md:grid-cols-3"><StatTile title="دخل اليوم" value={formatMoney(stats.today, currencySymbol)} icon="wallet" tone="green" /><StatTile title="إجمالي المدفوع" value={formatMoney(stats.total, currencySymbol)} icon="card" tone="blue" /><StatTile title="المتبقي" value={formatMoney(stats.remaining, currencySymbol)} icon="file" tone="orange" /></div><div className="premium-card overflow-x-auto"><table className="w-full min-w-[850px]"><thead><tr><th className="table-th">المريض</th><th className="table-th">الخطة</th><th className="table-th">القسط</th><th className="table-th">المبلغ</th><th className="table-th">الطريقة</th><th className="table-th">النوع</th><th className="table-th">التاريخ</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id}><td className="table-td font-black">{p.patients?.full_name}</td><td className="table-td">{p.treatment_plans?.title || '—'}</td><td className="table-td">{installmentLabel(p)}</td><td className="table-td number-ltr">{formatMoney(p.amount, currencySymbol)}</td><td className="table-td">{paymentMethodLabels[p.payment_method] || p.payment_method || '—'}</td><td className="table-td">{paymentTypeLabels[p.payment_type] || p.payment_type || '—'}</td><td className="table-td">{p.payment_date}</td></tr>)}</tbody></table>{!payments.length ? <p className="py-8 text-center text-slate-500">لا توجد دفعات بعد.</p> : null}</div></div>;
}

export default function FinancePage() { return <AppShell>{ctx => <PageContent {...ctx} />}</AppShell>; }
