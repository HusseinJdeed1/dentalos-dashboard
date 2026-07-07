'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { appointmentStatusLabels } from '@/lib/constants';
import { completeAppointmentWithVisit } from '@/lib/appointmentCompletion';
import { appointmentStatusTone, getAppointmentStatusActions } from '@/lib/appointmentWorkflow';
import { supabase } from '@/lib/supabase';
import type { Appointment, Patient, TreatmentPlan, Visit, Installment } from '@/lib/types';
import { requestActionConfirmation, showSecureMessage } from '@/lib/secureActions';
import { formatDate, formatMoney, getCurrencySymbol, todayISO } from '@/lib/utils';

const OPEN_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'arrived'] as const;
const FINAL_APPOINTMENT_STATUSES = ['completed', 'cancelled', 'no_show'];

type AlertSummary = {
  id: string;
  title: string;
  description: string;
  count: number;
  tone: 'danger' | 'warning' | 'primary' | 'success';
  icon: string;
};

type AppointmentAlertRow = Appointment & {
  patients?: Appointment['patients'];
  services?: Appointment['services'];
};

type VisitAlertRow = Visit & {
  patients?: { id: string; full_name: string; phone?: string | null } | null;
};

type PlanAlertRow = TreatmentPlan & {
  patients?: { id: string; full_name: string; phone?: string | null } | null;
};

type InstallmentAlertRow = Installment & {
  patients?: { id: string; full_name: string; phone?: string | null } | null;
  treatment_plans?: { id: string; title: string } | null;
};

function currentTimeValue() {
  return new Date().toTimeString().slice(0, 5);
}

function archiveThresholdISO() {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString().slice(0, 10);
}

function isOpenAppointment(status?: string | null) {
  return !!status && !FINAL_APPOINTMENT_STATUSES.includes(status);
}

function isAppointmentOverdue(row: Appointment) {
  if (!isOpenAppointment(row.status)) return false;
  const today = todayISO();
  const appointmentTime = (row.appointment_time || '00:00').slice(0, 5);
  if (row.appointment_date < today) return true;
  if (row.appointment_date === today && appointmentTime < currentTimeValue()) return true;
  return false;
}

function hasMissingVisitNotes(row: Visit) {
  return !String(row.procedure_done || '').trim() || !String(row.doctor_notes || '').trim();
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  const [hRaw, mRaw] = value.slice(0, 5).split(':');
  const h = Number(hRaw);
  const suffix = h >= 12 ? 'م' : 'ص';
  const hour = h % 12 || 12;
  return `${hour.toString().padStart(2, '0')}:${mRaw || '00'} ${suffix}`;
}

function AlertsContent({ staff, clinic }: AppContext) {
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const [appointments, setAppointments] = useState<AppointmentAlertRow[]>([]);
  const [visits, setVisits] = useState<VisitAlertRow[]>([]);
  const [plans, setPlans] = useState<PlanAlertRow[]>([]);
  const [installments, setInstallments] = useState<InstallmentAlertRow[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentAlertRow[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMenuRow, setStatusMenuRow] = useState<AppointmentAlertRow | null>(null);
  const [completionRow, setCompletionRow] = useState<AppointmentAlertRow | null>(null);
  const [completionForm, setCompletionForm] = useState({ procedure_done: '', doctor_notes: '' });
  const [savingCompletion, setSavingCompletion] = useState(false);

  async function load() {
    if (!staff) return;
    setLoading(true);
    const today = todayISO();

    const [appointmentsRes, visitsRes, plansRes, installmentsRes, upcomingRes, patientsRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, patients(id,full_name,phone), services(id,name)')
        .eq('clinic_id', staff.clinic_id)
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false })
        .limit(250),
      supabase
        .from('visits')
        .select('*, patients(id,full_name,phone), services(id,name)')
        .eq('clinic_id', staff.clinic_id)
        .order('visit_date', { ascending: false })
        .limit(120),
      supabase
        .from('treatment_plans')
        .select('*, patients(id,full_name,phone), services(id,name)')
        .eq('clinic_id', staff.clinic_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(120),
      supabase
        .from('installments')
        .select('*, patients(id,full_name,phone), treatment_plans(id,title)')
        .eq('clinic_id', staff.clinic_id)
        .lt('due_date', today)
        .in('status', ['pending','partial'])
        .order('due_date', { ascending: true })
        .limit(120),
      supabase
        .from('appointments')
        .select('*, patients(id,full_name,phone), services(id,name)')
        .eq('clinic_id', staff.clinic_id)
        .gte('appointment_date', today)
        .in('status', OPEN_APPOINTMENT_STATUSES as unknown as string[])
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true })
        .limit(250),
      supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', staff.clinic_id)
        .limit(500)
    ]);

    if (appointmentsRes.error) await showSecureMessage('تعذر تحميل التنبيهات', appointmentsRes.error.message);
    setAppointments((appointmentsRes.data || []) as AppointmentAlertRow[]);
    setVisits((visitsRes.data || []) as VisitAlertRow[]);
    setPlans((plansRes.data || []) as PlanAlertRow[]);
    setInstallments((installmentsRes.data || []) as InstallmentAlertRow[]);
    setUpcomingAppointments((upcomingRes.data || []) as AppointmentAlertRow[]);
    setPatients((patientsRes.data || []) as Patient[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [staff?.clinic_id]);

  const pendingAppointments = useMemo(() => appointments.filter((row) => row.status === 'pending'), [appointments]);
  const overdueAppointments = useMemo(() => appointments.filter(isAppointmentOverdue), [appointments]);
  const todayOpenAppointments = useMemo(() => appointments.filter((row) => row.appointment_date === todayISO() && isOpenAppointment(row.status)), [appointments]);
  const noShowNeedFollowup = useMemo(() => {
    const futurePatientIds = new Set(upcomingAppointments.map((row) => row.patient_id));
    return appointments.filter((row) => row.status === 'no_show' && !futurePatientIds.has(row.patient_id));
  }, [appointments, upcomingAppointments]);
  const visitsMissingNotes = useMemo(() => visits.filter(hasMissingVisitNotes), [visits]);
  const activePlansWithoutNextAppointment = useMemo(() => {
    const futurePatientServiceKeys = new Set(upcomingAppointments.map((row) => `${row.patient_id}:${row.service_id || 'none'}`));
    const futurePatientKeys = new Set(upcomingAppointments.map((row) => row.patient_id));
    return plans.filter((plan) => {
      if (plan.service_id && futurePatientServiceKeys.has(`${plan.patient_id}:${plan.service_id}`)) return false;
      return !futurePatientKeys.has(plan.patient_id);
    });
  }, [plans, upcomingAppointments]);

  const inactiveArchiveCandidates = useMemo(() => {
    const threshold = archiveThresholdISO();
    const futurePatientIds = new Set(upcomingAppointments.map((row) => row.patient_id));
    const latestByPatient = new Map<string, string>();
    appointments.forEach((row) => {
      const current = latestByPatient.get(row.patient_id);
      if (!current || row.appointment_date > current) latestByPatient.set(row.patient_id, row.appointment_date);
    });
    return patients.filter((patient) => {
      if ((patient.status || 'active') === 'archived') return false;
      if (futurePatientIds.has(patient.id)) return false;
      const latest = latestByPatient.get(patient.id);
      return !!latest && latest < threshold;
    });
  }, [appointments, patients, upcomingAppointments]);

  const summaries: AlertSummary[] = [
    { id: 'overdue', title: 'مواعيد فات وقتها', description: 'لم تُلغَ، لم تكتمل، ولم تسجل كـ لم يحضر', count: overdueAppointments.length, tone: overdueAppointments.length ? 'danger' : 'success', icon: 'alert' },
    { id: 'overdue-installments', title: 'أقساط متأخرة', description: 'أقساط تجاوزت تاريخ الاستحقاق ولم تدفع بالكامل', count: installments.length, tone: installments.length ? 'danger' : 'success', icon: 'wallet' },
    { id: 'pending', title: 'بانتظار التأكيد', description: 'مواعيد تحتاج تأكيداً أو إلغاء', count: pendingAppointments.length, tone: pendingAppointments.length ? 'warning' : 'success', icon: 'calendar' },
    { id: 'today-open', title: 'مواعيد اليوم غير مكتملة', description: 'مواعيد اليوم التي ما زالت تحتاج متابعة', count: todayOpenAppointments.length, tone: todayOpenAppointments.length ? 'primary' : 'success', icon: 'clock' },
    { id: 'no-show', title: 'لم يحضر بدون موعد جديد', description: 'مرضى لم يحضروا ولم يظهر لهم موعد قادم', count: noShowNeedFollowup.length, tone: noShowNeedFollowup.length ? 'warning' : 'success', icon: 'users' },
    { id: 'missing-notes', title: 'جلسات بدون ملاحظات كاملة', description: 'جلسات مكتملة تحتاج استكمال ما تم إجراؤه أو الملاحظات', count: visitsMissingNotes.length, tone: visitsMissingNotes.length ? 'warning' : 'success', icon: 'tooth' },
    { id: 'followup', title: 'خطط علاج بلا موعد قادم', description: 'خطط نشطة تحتاج متابعة أو جدولة جلسة', count: activePlansWithoutNextAppointment.length, tone: activePlansWithoutNextAppointment.length ? 'primary' : 'success', icon: 'file' }
  ];

  async function updateAppointmentStatus(row: AppointmentAlertRow, nextStatus: string) {
    const action = getAppointmentStatusActions(row.status).find((item) => item.status === nextStatus);
    if (!staff || !action) return;

    if (action.status === 'completed') {
      setStatusMenuRow(null);
      setCompletionRow(row);
      setCompletionForm({ procedure_done: '', doctor_notes: '' });
      return;
    }

    if (action.confirm) {
      const ok = await requestActionConfirmation(action.confirmTitle || 'تأكيد تغيير الحالة', action.confirmMessage || 'هل تريد تغيير حالة الموعد؟', action.confirmLabel || action.label);
      if (!ok) return;
    }

    const { error } = await supabase
      .from('appointments')
      .update({ status: action.status })
      .eq('id', row.id)
      .eq('clinic_id', staff.clinic_id);

    if (error) {
      await showSecureMessage('تعذر تحديث الحالة', error.message);
      return;
    }

    setStatusMenuRow(null);
    await showSecureMessage('تم تحديث الحالة', `تم تغيير حالة الموعد إلى: ${appointmentStatusLabels[action.status]}`);
    load();
  }

  async function submitAppointmentCompletion(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !completionRow) return;
    setSavingCompletion(true);
    const result = await completeAppointmentWithVisit({
      clinicId: staff.clinic_id,
      patientId: completionRow.patient_id,
      appointmentId: completionRow.id,
      serviceId: completionRow.service_id,
      visitDate: completionRow.appointment_date || todayISO(),
      procedureDone: completionForm.procedure_done,
      doctorNotes: completionForm.doctor_notes
    });
    setSavingCompletion(false);

    if (result.error) {
      await showSecureMessage('تعذر إنهاء الموعد', result.error);
      return;
    }

    setCompletionRow(null);
    setCompletionForm({ procedure_done: '', doctor_notes: '' });
    await showSecureMessage('تم إنهاء الموعد', 'تم تسجيل ملخص الجلسة والملاحظات الطبية في ملف المريض.');
    load();
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">كل التنبيهات</h1>
          <p className="mt-2 text-slate-500">هذه الصفحة مخصصة لعرض كل التنبيهات التشغيلية ومتابعتها من مكان واحد.</p>
        </div>
        <Link href="/dashboard" className="outline-btn"><Icon name="arrow" /> العودة للرئيسية</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {summaries.map((item) => <AlertSummaryCard key={item.id} item={item} />)}
      </div>

      {loading ? <div className="premium-card text-center font-bold text-slate-500">جاري تحميل التنبيهات...</div> : null}

      <section id="overdue-installments" className="premium-card scroll-mt-24">
        <SectionHeader title="أقساط متأخرة" description="دفعات مستحقة قبل اليوم ولم يتم سدادها بالكامل." count={installments.length} />
        <InstallmentsAlertsTable rows={installments} currencySymbol={currencySymbol} />
      </section>

      <section id="overdue" className="premium-card scroll-mt-24">
        <SectionHeader
          title="مواعيد فات وقتها ولم يتم تحديث حالتها"
          description="تظهر هنا المواعيد التي مر وقتها وما زالت ليست مكتملة، ليست ملغاة، وليست لم يحضر."
          count={overdueAppointments.length}
        />
        <AppointmentAlertsTable rows={overdueAppointments} onOpenStatus={setStatusMenuRow} emptyText="لا توجد مواعيد فائتة تحتاج تحديث حالة." />
      </section>

      <section id="pending" className="premium-card scroll-mt-24">
        <SectionHeader title="مواعيد بانتظار التأكيد" description="مواعيد تحتاج تأكيداً أو إلغاء." count={pendingAppointments.length} />
        <AppointmentAlertsTable rows={pendingAppointments} onOpenStatus={setStatusMenuRow} emptyText="لا توجد مواعيد بانتظار التأكيد." />
      </section>

      <section id="today-open" className="premium-card scroll-mt-24">
        <SectionHeader title="مواعيد اليوم غير مكتملة" description="مواعيد اليوم التي ما زالت تحتاج متابعة أو تحديث حالة." count={todayOpenAppointments.length} />
        <AppointmentAlertsTable rows={todayOpenAppointments} onOpenStatus={setStatusMenuRow} emptyText="لا توجد مواعيد مفتوحة اليوم." />
      </section>

      <section id="no-show" className="premium-card scroll-mt-24">
        <SectionHeader title="مرضى لم يحضروا ولم يتم تحديد موعد جديد" description="يفضل التواصل معهم أو إعادة جدولة الموعد." count={noShowNeedFollowup.length} />
        <AppointmentAlertsTable rows={noShowNeedFollowup} onOpenStatus={setStatusMenuRow} emptyText="لا توجد حالات لم يحضر تحتاج متابعة حالياً." />
      </section>

      <section id="missing-notes" className="premium-card scroll-mt-24">
        <SectionHeader title="جلسات مكتملة بدون ملاحظات كاملة" description="افتح ملف المريض لاستكمال ما تم إجراؤه أو الملاحظات الطبية." count={visitsMissingNotes.length} />
        <VisitsAlertsTable rows={visitsMissingNotes} />
      </section>

      <section id="followup" className="premium-card scroll-mt-24">
        <SectionHeader title="خطط علاج نشطة بدون موعد قادم" description="هذه الخطط قد تحتاج جدولة جلسة متابعة." count={activePlansWithoutNextAppointment.length} />
        <PlansAlertsTable rows={activePlansWithoutNextAppointment} />
      </section>

      <section id="archive-candidates" className="premium-card scroll-mt-24">
        <SectionHeader title="مرضى مرشحون للأرشفة" description="مرضى لم تتم إضافة موعد جديد لهم منذ أكثر من 3 أشهر ولا يوجد لديهم موعد قادم." count={inactiveArchiveCandidates.length} />
        <ArchiveCandidatesTable rows={inactiveArchiveCandidates} />
      </section>

      <Modal open={!!statusMenuRow} title="تغيير حالة الموعد" onClose={() => setStatusMenuRow(null)}>
        {statusMenuRow ? (
          <div className="space-y-4 text-right">
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="font-black text-slate-900">{statusMenuRow.patients?.full_name || 'مريض'}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">{statusMenuRow.services?.name || 'خدمة'} — {statusMenuRow.appointment_date} — {formatTime(statusMenuRow.appointment_time)}</p>
              <div className="mt-3"><StatusBadge tone={appointmentStatusTone(statusMenuRow.status)}>{appointmentStatusLabels[statusMenuRow.status] || statusMenuRow.status}</StatusBadge></div>
            </div>
            {getAppointmentStatusActions(statusMenuRow.status).length ? (
              <div className="table-actions-row appointment-status-actions justify-start">
                {getAppointmentStatusActions(statusMenuRow.status).map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    className={`${action.tone === 'danger' ? 'ghost-btn text-danger' : 'outline-btn'} table-action-btn`}
                    onClick={() => updateAppointmentStatus(statusMenuRow, action.status)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm font-bold text-slate-500">هذا الموعد في حالة نهائية ولا يحتاج إلى تغيير حالة.</p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!completionRow} title="إنهاء الموعد وتسجيل الجلسة" onClose={() => { if (!savingCompletion) setCompletionRow(null); }}>
        {completionRow ? (
          <form onSubmit={submitAppointmentCompletion} className="grid gap-4 text-right">
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="font-black text-slate-900">{completionRow.patients?.full_name || 'مريض'}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">{completionRow.services?.name || 'خدمة'} — {formatTime(completionRow.appointment_time)}</p>
            </div>
            <label>
              <span className="mb-2 block font-bold">وصف مختصر لما تم إجراؤه في الجلسة</span>
              <textarea
                className="soft-input min-h-28"
                required
                placeholder="مثال: تم تنظيف الأسنان، إزالة الجير، فحص اللثة..."
                value={completionForm.procedure_done}
                onChange={(e) => setCompletionForm({ ...completionForm, procedure_done: e.target.value })}
              />
            </label>
            <label>
              <span className="mb-2 block font-bold">ملاحظات طبية للمريض</span>
              <textarea
                className="soft-input min-h-28"
                required
                placeholder="مثال: حساسية، ألم، توصيات، تعليمات بعد الجلسة..."
                value={completionForm.doctor_notes}
                onChange={(e) => setCompletionForm({ ...completionForm, doctor_notes: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" className="outline-btn" onClick={() => setCompletionRow(null)} disabled={savingCompletion}>تراجع</button>
              <button className="premium-btn" disabled={savingCompletion}>{savingCompletion ? 'جاري الحفظ...' : 'إنهاء الموعد وحفظ الملاحظات'}</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

function AlertSummaryCard({ item }: { item: AlertSummary }) {
  const toneClass = item.tone === 'danger'
    ? 'bg-danger/10 text-danger'
    : item.tone === 'warning'
      ? 'bg-warning/10 text-warning'
      : item.tone === 'success'
        ? 'bg-success/10 text-success'
        : 'bg-primary/10 text-primary';

  return (
    <a href={`#${item.id}`} className="premium-card flex items-center justify-between gap-4 transition hover:border-primary/40 hover:bg-primary/5">
      <div className="text-right">
        <p className="text-base font-black text-slate-900">{item.title}</p>
        <p className="mt-1 text-sm font-bold text-slate-500">{item.description}</p>
        <p className="mt-4 text-3xl font-black number-ltr">{item.count}</p>
      </div>
      <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${toneClass}`}><Icon name={item.icon} /></div>
    </a>
  );
}

function SectionHeader({ title, description, count }: { title: string; description: string; count: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-right">
      <div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">{description}</p>
      </div>
      <StatusBadge tone={count ? 'warning' : 'success'}>{count} تنبيه</StatusBadge>
    </div>
  );
}

function AppointmentAlertsTable({ rows, onOpenStatus, emptyText }: { rows: AppointmentAlertRow[]; onOpenStatus: (row: AppointmentAlertRow) => void; emptyText: string }) {
  if (!rows.length) return <EmptyState text={emptyText} />;

  return (
    <div className="data-table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>المريض</th>
            <th>الخدمة</th>
            <th>التاريخ</th>
            <th>الوقت</th>
            <th>الحالة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusLabel = appointmentStatusLabels[row.status] || row.status;
            const hasActions = getAppointmentStatusActions(row.status).length > 0;
            return (
              <tr key={row.id}>
                <td>{row.patients?.full_name || 'مريض'}</td>
                <td>{row.services?.name || 'خدمة'}</td>
                <td className="number-ltr">{row.appointment_date}</td>
                <td><span className="number-ltr">{formatTime(row.appointment_time)}</span></td>
                <td>
                  {hasActions ? (
                    <button type="button" className="status-picker-button" onClick={() => onOpenStatus(row)} title="تغيير حالة الموعد">
                      <StatusBadge tone={appointmentStatusTone(row.status)}>{statusLabel}</StatusBadge>
                    </button>
                  ) : (
                    <StatusBadge tone={appointmentStatusTone(row.status)}>{statusLabel}</StatusBadge>
                  )}
                </td>
                <td>
                  <Link href={`/patients/profile?id=${row.patient_id}`} className="outline-btn">فتح الملف</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InstallmentsAlertsTable({ rows, currencySymbol }: { rows: InstallmentAlertRow[]; currencySymbol: string }) {
  if (!rows.length) return <EmptyState text="لا توجد أقساط متأخرة حالياً." />;

  return (
    <div className="data-table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>المريض</th>
            <th>الخطة</th>
            <th>تاريخ الاستحقاق</th>
            <th>المبلغ</th>
            <th>المدفوع</th>
            <th>المتبقي</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.patients?.full_name || 'مريض'}</td>
              <td>{row.treatment_plans?.title || 'قسط'}</td>
              <td className="number-ltr">{formatDate(row.due_date)}</td>
              <td className="number-ltr">{formatMoney(row.amount, currencySymbol)}</td>
              <td className="number-ltr text-success">{formatMoney(row.paid_amount, currencySymbol)}</td>
              <td className="number-ltr text-danger">{formatMoney(Math.max(0, Number(row.amount || 0) - Number(row.paid_amount || 0)), currencySymbol)}</td>
              <td><Link href={`/patients/profile?id=${row.patient_id}`} className="outline-btn">فتح الملف</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VisitsAlertsTable({ rows }: { rows: VisitAlertRow[] }) {
  if (!rows.length) return <EmptyState text="لا توجد جلسات ناقصة الملاحظات." />;

  return (
    <div className="data-table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>المريض</th>
            <th>التاريخ</th>
            <th>ما تم إجراؤه</th>
            <th>الملاحظات</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.patients?.full_name || 'مريض'}</td>
              <td className="number-ltr">{row.visit_date}</td>
              <td>{row.procedure_done?.trim() || 'غير مكتمل'}</td>
              <td>{row.doctor_notes?.trim() || 'غير مكتمل'}</td>
              <td><Link href={`/patients/profile?id=${row.patient_id}`} className="outline-btn">فتح الملف</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlansAlertsTable({ rows }: { rows: PlanAlertRow[] }) {
  if (!rows.length) return <EmptyState text="لا توجد خطط علاج نشطة بدون موعد قادم." />;

  return (
    <div className="data-table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>المريض</th>
            <th>الخطة</th>
            <th>الحالة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.patients?.full_name || 'مريض'}</td>
              <td>{row.title}</td>
              <td><StatusBadge tone="primary">نشطة</StatusBadge></td>
              <td><Link href={`/patients/profile?id=${row.patient_id}`} className="outline-btn">فتح الملف</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function ArchiveCandidatesTable({ rows }: { rows: Patient[] }) {
  if (!rows.length) return <EmptyState text="لا توجد ملفات مرشحة للأرشفة حالياً." />;

  return (
    <div className="data-table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>المريض</th>
            <th>الهاتف</th>
            <th>الحالة المقترحة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="font-black">{row.full_name}</td>
              <td><span className="number-ltr">{row.phone}</span></td>
              <td><StatusBadge tone="warning">مرشح للأرشفة</StatusBadge></td>
              <td><Link href={`/patients/profile?id=${row.id}`} className="outline-btn">فتح الملف</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-white/70 p-8 text-center font-bold text-slate-500">{text}</div>;
}

export default function AlertsPage() {
  return <AppShell>{(ctx) => <AlertsContent {...ctx} />}</AppShell>;
}
