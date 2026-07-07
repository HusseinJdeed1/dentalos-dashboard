'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { StatTile } from '@/components/StatTile';
import { canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { Appointment, Expense, Payment, Patient, TreatmentPlan, Installment } from '@/lib/types';
import { formatMoney, getCurrencySymbol, todayISO, monthStartISO, formatDate } from '@/lib/utils';

type OverduePlanRow = TreatmentPlan & { patients?: Patient };
type OverdueInstallmentRow = Installment & { patients?: Patient; treatment_plans?: TreatmentPlan };

function PageContent({ staff, clinic }: AppContext) {
  const canView = canViewFullFinancials(staff);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [plans, setPlans] = useState<OverduePlanRow[]>([]);
  const [installments, setInstallments] = useState<OverdueInstallmentRow[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      if (!staff || !canView) return;
      setLoading(true);
      const [paymentsRes, expensesRes, plansRes, installmentsRes, appointmentsRes, patientsRes] = await Promise.all([
        supabase
          .from('payments')
          .select('*, patients(*), treatment_plans(*)')
          .eq('clinic_id', staff.clinic_id)
          .order('payment_date', { ascending: false }),
        supabase
          .from('expenses')
          .select('*')
          .eq('clinic_id', staff.clinic_id)
          .order('expense_date', { ascending: false }),
        supabase
          .from('treatment_plans')
          .select('*, patients(*)')
          .eq('clinic_id', staff.clinic_id)
          .gt('remaining_amount', 0)
          .order('created_at', { ascending: false }),
        supabase
          .from('installments')
          .select('*, patients(*), treatment_plans(*)')
          .eq('clinic_id', staff.clinic_id)
          .lt('due_date', todayISO())
          .in('status', ['pending','partial'])
          .order('due_date', { ascending: true }),
        supabase
          .from('appointments')
          .select('*, patients(*), services(*)')
          .eq('clinic_id', staff.clinic_id)
          .gte('appointment_date', monthStartISO())
          .order('appointment_date', { ascending: false }),
        supabase
          .from('patients')
          .select('*')
          .eq('clinic_id', staff.clinic_id)
          .gte('created_at', `${monthStartISO()}T00:00:00`)
      ]);

      setPayments((paymentsRes.data || []) as Payment[]);
      setExpenses((expensesRes.data || []) as Expense[]);
      setPlans((plansRes.data || []) as OverduePlanRow[]);
      setInstallments((installmentsRes.data || []) as OverdueInstallmentRow[]);
      setAppointments((appointmentsRes.data || []) as Appointment[]);
      setPatients((patientsRes.data || []) as Patient[]);
      setLoading(false);
    }

    load();
  }, [staff?.clinic_id, canView]);

  const stats = useMemo(() => {
    const today = todayISO();
    const monthStart = monthStartISO();
    const revenueToday = payments
      .filter((payment) => payment.payment_date === today)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const revenueMonth = payments
      .filter((payment) => payment.payment_date >= monthStart)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const expensesToday = expenses
      .filter((expense) => expense.expense_date === today)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const expensesMonth = expenses
      .filter((expense) => expense.expense_date >= monthStart)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const overdueRows = installments.length ? installments : plans;
    const overdueAmount = installments.length
      ? installments.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0)), 0)
      : plans.reduce((sum, plan) => sum + Number(plan.remaining_amount || 0), 0);

    return {
      revenueToday,
      revenueMonth,
      expensesToday,
      expensesMonth,
      netToday: revenueToday - expensesToday,
      netMonth: revenueMonth - expensesMonth,
      overdueCount: overdueRows.length,
      overdueAmount,
      newPatients: patients.length,
      cancelledAppointments: appointments.filter((appointment) => appointment.status === 'cancelled').length,
      noShowAppointments: appointments.filter((appointment) => appointment.status === 'no_show').length,
      completedAppointments: appointments.filter((appointment) => appointment.status === 'completed').length
    };
  }, [payments, expenses, plans, installments, appointments, patients]);

  const dailyRevenue = useMemo(() => {
    const map = new Map<string, number>();
    payments.filter((payment) => payment.payment_date >= monthStartISO()).forEach((payment) => {
      map.set(payment.payment_date, (map.get(payment.payment_date) || 0) + Number(payment.amount || 0));
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([label, value]) => ({ label: formatDate(label), value }));
  }, [payments]);

  const expenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses.filter((expense) => expense.expense_date >= monthStartISO()).forEach((expense) => {
      map.set(expense.category || 'أخرى', (map.get(expense.category || 'أخرى') || 0) + Number(expense.amount || 0));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  }, [expenses]);

  const appointmentStatusChart = useMemo(() => {
    const labels: Record<string, string> = { completed: 'مكتملة', cancelled: 'ملغاة', no_show: 'لم يحضر', confirmed: 'مؤكدة', pending: 'بانتظار' };
    const map = new Map<string, number>();
    appointments.forEach((appointment) => map.set(labels[appointment.status] || appointment.status, (map.get(labels[appointment.status] || appointment.status) || 0) + 1));
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [appointments]);


  function exportMonthlyCsv() {
    const rows = [
      ['metric','value'],
      ['revenue_month', String(stats.revenueMonth)],
      ['expenses_month', String(stats.expensesMonth)],
      ['net_month', String(stats.netMonth)],
      ['new_patients', String(stats.newPatients)],
      ['completed_appointments', String(stats.completedAppointments)],
      ['cancelled_appointments', String(stats.cancelledAppointments)],
      ['no_show_appointments', String(stats.noShowAppointments)],
      ['overdue_amount', String(stats.overdueAmount)]
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `dentalos-report-${monthStartISO()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function printReport() {
    window.print();
  }

  if (!canView) {
    return (
      <AccessDenied
        title="التقارير المالية غير متاحة"
        description="حساب السكرتيرة لا يمكنه رؤية تقرير الإيرادات، المصروفات، الصافي، أو الأقساط المتأخرة."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-right">
          <h1 className="text-3xl font-black">التقارير</h1>
          <p className="mt-2 text-slate-500">تقرير مختصر للإيرادات، المصروفات، والأقساط المتأخرة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="outline-btn px-4 py-2.5 text-sm" onClick={printReport}><Icon name="file" className="h-4 w-4" /> طباعة PDF</button>
          <button className="outline-btn px-4 py-2.5 text-sm" onClick={exportMonthlyCsv}><Icon name="upload" className="h-4 w-4" /> تصدير CSV</button>
          <Link href="/finance" className="outline-btn px-4 py-2.5 text-sm"><Icon name="wallet" className="h-4 w-4" /> فتح الدفعات والأقساط</Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile title="إيرادات اليوم" value={formatMoney(stats.revenueToday, currencySymbol)} icon="wallet" tone="green" />
        <StatTile title="مصروفات اليوم" value={formatMoney(stats.expensesToday, currencySymbol)} icon="card" tone="orange" />
        <StatTile title="صافي اليوم" value={formatMoney(stats.netToday, currencySymbol)} icon="chart" tone="blue" />
        <StatTile title="أقساط متأخرة" value={stats.overdueCount} hint={formatMoney(stats.overdueAmount, currencySymbol)} icon="clock" tone="orange" dangerHint />
        <StatTile title="مرضى جدد" value={stats.newPatients} icon="users" tone="purple" />
        <StatTile title="مواعيد مكتملة" value={stats.completedAppointments} icon="calendar" tone="green" />
        <StatTile title="لم يحضروا" value={stats.noShowAppointments} icon="alert" tone="orange" dangerHint />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="premium-card text-right">
          <p className="text-sm font-black text-slate-500">إيرادات هذا الشهر</p>
          <p className="mt-3 text-2xl font-black number-ltr text-success">{formatMoney(stats.revenueMonth, currencySymbol)}</p>
        </div>
        <div className="premium-card text-right">
          <p className="text-sm font-black text-slate-500">مصروفات هذا الشهر</p>
          <p className="mt-3 text-2xl font-black number-ltr text-warning">{formatMoney(stats.expensesMonth, currencySymbol)}</p>
        </div>
        <div className="premium-card text-right">
          <p className="text-sm font-black text-slate-500">صافي هذا الشهر</p>
          <p className="mt-3 text-2xl font-black number-ltr text-slate-900">{formatMoney(stats.netMonth, currencySymbol)}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ReportBarChart title="اتجاه الإيرادات" description="آخر أيام فيها دفعات خلال الشهر الحالي." data={dailyRevenue} formatter={(value) => formatMoney(value, currencySymbol)} />
        <ReportBarChart title="المصروفات حسب التصنيف" description="أكبر تصنيفات المصروفات خلال الشهر." data={expenseByCategory} formatter={(value) => formatMoney(value, currencySymbol)} />
        <ReportBarChart title="حالات المواعيد" description="توزيع حالات مواعيد الشهر الحالي." data={appointmentStatusChart} formatter={(value) => `${value}`} />
      </div>

      <div className="premium-card overflow-x-auto">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-right">
          <div>
            <h2 className="text-xl font-black">الأقساط المتأخرة</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">الأقساط التي تجاوزت تاريخ الاستحقاق ولم تُدفع بالكامل. إذا لم تُنشأ أقساط بعد، يظهر النظام خطط العلاج ذات المبالغ المتبقية كبديل مؤقت.</p>
          </div>
          <span className="rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-slate-600">
            {loading ? 'جاري التحميل...' : `${stats.overdueCount} ملف`}
          </span>
        </div>

        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="table-th">المريض</th>
              <th className="table-th">الخطة</th>
              <th className="table-th">الإجمالي</th>
              <th className="table-th">المدفوع</th>
              <th className="table-th">المتبقي</th>
              <th className="table-th">تاريخ الإنشاء</th>
              <th className="table-th">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {installments.length ? installments.map((item) => (
              <tr key={item.id}>
                <td className="table-td font-black">{item.patients?.full_name || 'مريض'}</td>
                <td className="table-td">{item.treatment_plans?.title || 'قسط'}</td>
                <td className="table-td number-ltr">{formatMoney(item.amount, currencySymbol)}</td>
                <td className="table-td number-ltr text-success">{formatMoney(item.paid_amount, currencySymbol)}</td>
                <td className="table-td number-ltr text-danger">{formatMoney(Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0)), currencySymbol)}</td>
                <td className="table-td number-ltr">{formatDate(item.due_date)}</td>
                <td className="table-td"><Link href={`/patients/profile?id=${item.patient_id}`} className="outline-btn table-action-btn mx-auto">فتح الملف</Link></td>
              </tr>
            )) : plans.map((plan) => (
              <tr key={plan.id}>
                <td className="table-td font-black">{plan.patients?.full_name || 'مريض'}</td>
                <td className="table-td">{plan.title}</td>
                <td className="table-td number-ltr">{formatMoney(plan.final_amount, currencySymbol)}</td>
                <td className="table-td number-ltr text-success">{formatMoney(plan.paid_amount, currencySymbol)}</td>
                <td className="table-td number-ltr text-danger">{formatMoney(plan.remaining_amount, currencySymbol)}</td>
                <td className="table-td number-ltr">{formatDate(plan.created_at)}</td>
                <td className="table-td"><Link href={`/patients/profile?id=${plan.patient_id}`} className="outline-btn table-action-btn mx-auto">فتح الملف</Link></td>
              </tr>
            ))}
          </tbody>
        </table>

        {!installments.length && !plans.length ? <p className="py-8 text-center text-slate-500">لا توجد أقساط متأخرة حالياً.</p> : null}
      </div>
    </div>
  );
}


function ReportBarChart({ title, description, data, formatter }: { title: string; description: string; data: Array<{ label: string; value: number }>; formatter: (value: number) => string }) {
  const max = Math.max(1, ...data.map((item) => Number(item.value || 0)));
  return (
    <section className="premium-card report-chart-card">
      <div className="mb-4 text-right">
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">{description}</p>
      </div>
      {data.length ? (
        <div className="report-chart-bars">
          {data.map((item) => (
            <div key={item.label} className="report-chart-row">
              <span className="report-chart-label">{item.label}</span>
              <div className="report-chart-track"><span className="report-chart-fill" style={{ width: `${Math.max(6, (Number(item.value || 0) / max) * 100)}%` }} /></div>
              <strong className="number-ltr report-chart-value">{formatter(Number(item.value || 0))}</strong>
            </div>
          ))}
        </div>
      ) : <p className="rounded-2xl border border-border bg-muted/40 p-5 text-center text-sm font-bold text-slate-500">لا توجد بيانات كافية لعرض الرسم.</p>}
    </section>
  );
}

export default function ReportsPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
