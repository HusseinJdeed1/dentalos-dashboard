'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatTile } from '@/components/StatTile';
import { StatusBadge } from '@/components/StatusBadge';
import { dentalStatusClass, dentalStatusLabel, dentalStatusOptions, toothGroups } from '@/components/patients/PatientDentalChart';
import { appointmentStatusLabels } from '@/lib/constants';
import { completeAppointmentWithVisit } from '@/lib/appointmentCompletion';
import { appointmentStatusTone, getAppointmentStatusActions } from '@/lib/appointmentWorkflow';
import { canManageMedicalRecords, canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { requestActionConfirmation, showSecureMessage } from '@/lib/secureActions';
import { logActivity } from '@/lib/audit';
import type { Appointment, Payment, Patient, TreatmentPlan, Visit, DentalChartRow } from '@/lib/types';
import { formatMoney, getCurrencySymbol, todayISO } from '@/lib/utils';
import { getCache, getOnlineStatus, offlineKeys, setCache } from '@/lib/offline';

type AppointmentRow = {
  id: string;
  time: string;
  patient: string;
  service: string;
  status: string;
  amount: number;
  patientId?: string;
  serviceId?: string | null;
  appointmentDate?: string;
  appointmentTime?: string;
  patientData?: Patient;
};

type AlertRow = {
  title: string;
  text: string;
  tone: 'danger' | 'warning' | 'primary';
  icon: string;
  href?: string;
};

type CompletionToothForm = { tooth_number: string; old_status: string | null; new_status: string; procedure_done: string; notes: string };

function archiveThresholdISO() {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString().slice(0, 10);
}

function DashboardContent({ staff, clinic }: AppContext) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [alertAppointments, setAlertAppointments] = useState<Appointment[]>([]);
  const [upcomingAlertAppointments, setUpcomingAlertAppointments] = useState<Appointment[]>([]);
  const [overdueAppointmentsCount, setOverdueAppointmentsCount] = useState(0);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [alertPatients, setAlertPatients] = useState<Patient[]>([]);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [statusMenuRow, setStatusMenuRow] = useState<AppointmentRow | null>(null);
  const [completionRow, setCompletionRow] = useState<AppointmentRow | null>(null);
  const [completionForm, setCompletionForm] = useState({ procedure_done: '', doctor_notes: '' });
  const [completionTeeth, setCompletionTeeth] = useState<CompletionToothForm[]>([]);
  const [completionStep, setCompletionStep] = useState(1);
  const [dentalChartRows, setDentalChartRows] = useState<DentalChartRow[]>([]);
  const [savingCompletion, setSavingCompletion] = useState(false);

  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);

  const hasFinancialAccess = canViewFullFinancials(staff);
  const canManageMedical = canManageMedicalRecords(staff);

  async function load() {
    if (!staff) return;
    const dashboardCacheKey = `dashboard:${staff.clinic_id}:${selectedDate}`;
    if (!getOnlineStatus()) {
      const cached = await getCache<any>(dashboardCacheKey);
      if (cached) {
        setAppointments(cached.appointments || []);
        setPatients(cached.patients || []);
        setAlertPatients(cached.alertPatients || []);
        setAlertAppointments(cached.alertAppointments || []);
        setUpcomingAlertAppointments(cached.upcomingAlertAppointments || []);
        setVisits(cached.visits || []);
        setOverdueAppointmentsCount(cached.overdueAppointmentsCount || 0);
        setPayments(cached.payments || []);
        setPlans(cached.plans || []);
      }
      return;
    }

    const today = selectedDate;
    const appointmentsSelect = hasFinancialAccess
      ? '*, patients(*), services(*)'
      : '*, patients(*), services(id,name,category,duration_minutes,is_active)';

    const currentTime = new Date().toTimeString().slice(0, 8);
    const openStatuses = ['pending', 'confirmed', 'arrived'];

    const [appointmentsRes, patientsRes, allPatientsRes, allAlertAppointmentsRes, upcomingAlertAppointmentsRes, overduePastRes, overdueTodayRes, visitsRes] = await Promise.all([
      supabase
        .from('appointments')
        .select(appointmentsSelect)
        .eq('clinic_id', staff.clinic_id)
        .eq('appointment_date', today)
        .order('appointment_time', { ascending: true }),
      supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', staff.clinic_id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', staff.clinic_id)
        .limit(500),
      supabase
        .from('appointments')
        .select('id, clinic_id, patient_id, service_id, appointment_date, appointment_time, status, treatment_cost, notes')
        .eq('clinic_id', staff.clinic_id)
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false })
        .limit(500),
      supabase
        .from('appointments')
        .select('id, patient_id, service_id, appointment_date, appointment_time, status')
        .eq('clinic_id', staff.clinic_id)
        .gte('appointment_date', todayISO())
        .in('status', openStatuses)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true })
        .limit(500),
      supabase
        .from('appointments')
        .select('id')
        .eq('clinic_id', staff.clinic_id)
        .lt('appointment_date', todayISO())
        .in('status', openStatuses)
        .limit(500),
      supabase
        .from('appointments')
        .select('id')
        .eq('clinic_id', staff.clinic_id)
        .eq('appointment_date', todayISO())
        .lt('appointment_time', currentTime)
        .in('status', openStatuses)
        .limit(500),
      supabase
        .from('visits')
        .select('*, services(*)')
        .eq('clinic_id', staff.clinic_id)
        .order('visit_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(250)
    ]);

    setAppointments((appointmentsRes.data || []) as Appointment[]);
    setPatients((patientsRes.data || []) as Patient[]);
    setAlertPatients((allPatientsRes.data || []) as Patient[]);
    setAlertAppointments((allAlertAppointmentsRes.data || []) as Appointment[]);
    setUpcomingAlertAppointments((upcomingAlertAppointmentsRes.data || []) as Appointment[]);
    setVisits((visitsRes.data || []) as Visit[]);
    setOverdueAppointmentsCount((overduePastRes.data?.length || 0) + (overdueTodayRes.data?.length || 0));

    if (hasFinancialAccess) {
      const [paymentsRes, plansRes] = await Promise.all([
        supabase
          .from('payments')
          .select('*, patients(*), treatment_plans(*)')
          .eq('clinic_id', staff.clinic_id)
          .order('payment_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(160),
        supabase
          .from('treatment_plans')
          .select('*, patients(*), services(*)')
          .eq('clinic_id', staff.clinic_id)
          .order('created_at', { ascending: false })
          .limit(100)
      ]);

      setPayments((paymentsRes.data || []) as Payment[]);
      setPlans((plansRes.data || []) as TreatmentPlan[]);
      await setCache(dashboardCacheKey, {
        appointments: (appointmentsRes.data || []) as Appointment[],
        patients: (patientsRes.data || []) as Patient[],
        alertPatients: (allPatientsRes.data || []) as Patient[],
        alertAppointments: (allAlertAppointmentsRes.data || []) as Appointment[],
        upcomingAlertAppointments: (upcomingAlertAppointmentsRes.data || []) as Appointment[],
        visits: (visitsRes.data || []) as Visit[],
        overdueAppointmentsCount: (overduePastRes.data?.length || 0) + (overdueTodayRes.data?.length || 0),
        payments: (paymentsRes.data || []) as Payment[],
        plans: (plansRes.data || []) as TreatmentPlan[]
      });
    } else {
      setPayments([]);
      setPlans([]);
      await setCache(dashboardCacheKey, {
        appointments: (appointmentsRes.data || []) as Appointment[],
        patients: (patientsRes.data || []) as Patient[],
        alertPatients: (allPatientsRes.data || []) as Patient[],
        alertAppointments: (allAlertAppointmentsRes.data || []) as Appointment[],
        upcomingAlertAppointments: (upcomingAlertAppointmentsRes.data || []) as Appointment[],
        visits: (visitsRes.data || []) as Visit[],
        overdueAppointmentsCount: (overduePastRes.data?.length || 0) + (overdueTodayRes.data?.length || 0),
        payments: [],
        plans: []
      });
    }
  }

  useEffect(() => {
    load();
  }, [staff?.clinic_id, staff?.role, selectedDate]);

  const appointmentRows: AppointmentRow[] = appointments.map((a) => ({
    id: a.id,
    time: formatTime(a.appointment_time),
    patient: a.patients?.full_name || 'مريض',
    service: a.services?.name || 'خدمة',
    status: a.status,
    amount: Number((a.services as any)?.price || 0),
    patientId: a.patient_id,
    serviceId: a.service_id,
    appointmentDate: a.appointment_date,
    appointmentTime: a.appointment_time,
    patientData: a.patients as Patient | undefined
  }));

  const pendingAppointments = appointmentRows.filter((a) => a.status === 'pending').length;
  const confirmedAppointments = appointmentRows.length;
  const newPatients = patients.length;
  const featured = useMemo<Patient | null>(() => {
    const selectedFromAppointments = appointmentRows.find((row) => row.patientId === selectedPatientId)?.patientData;
    const selectedFromPatients = patients.find((patient) => patient.id === selectedPatientId);
    return selectedFromAppointments || selectedFromPatients || appointmentRows[0]?.patientData || patients[0] || null;
  }, [appointmentRows, patients, selectedPatientId]);

  const featuredPlans = featured ? plans.filter((plan) => plan.patient_id === featured.id) : [];
  const featuredRemaining = featuredPlans.reduce((sum, plan) => sum + Number(plan.remaining_amount || 0), 0);
  const featuredVisits = featured ? visits.filter((visit) => visit.patient_id === featured.id).slice(0, 2) : [];
  const featuredLastPayment = featured ? payments.find((payment) => payment.patient_id === featured.id) || null : null;

  const openTodayAppointments = appointmentRows.filter((a) => !['completed', 'cancelled', 'no_show'].includes(a.status)).length;

  const allPendingAppointmentsCount = alertAppointments.filter((a) => a.status === 'pending').length;
  const allTodayOpenAppointmentsCount = alertAppointments.filter((a) => a.appointment_date === todayISO() && !['completed', 'cancelled', 'no_show'].includes(a.status)).length;
  const futurePatientIds = new Set(upcomingAlertAppointments.map((a) => a.patient_id));
  const futurePatientServiceKeys = new Set(upcomingAlertAppointments.map((a) => `${a.patient_id}:${a.service_id || 'none'}`));
  const noShowNeedFollowupCount = alertAppointments.filter((a) => a.status === 'no_show' && !futurePatientIds.has(a.patient_id)).length;
  const visitsMissingNotesCount = visits.filter((visit) => !String(visit.procedure_done || '').trim() || !String(visit.doctor_notes || '').trim()).length;
  const activePlansWithoutNextAppointmentCount = hasFinancialAccess
    ? plans.filter((plan) => {
      if (plan.status !== 'active') return false;
      if (plan.service_id && futurePatientServiceKeys.has(`${plan.patient_id}:${plan.service_id}`)) return false;
      return !futurePatientIds.has(plan.patient_id);
    }).length
    : 0;
  const latestAppointmentByPatient = new Map<string, string>();
  alertAppointments.forEach((appointment) => {
    const current = latestAppointmentByPatient.get(appointment.patient_id);
    if (!current || appointment.appointment_date > current) latestAppointmentByPatient.set(appointment.patient_id, appointment.appointment_date);
  });
  const archiveCandidatesCount = alertPatients.filter((patient) => {
    if ((patient.status || 'active') === 'archived') return false;
    if (futurePatientIds.has(patient.id)) return false;
    const latest = latestAppointmentByPatient.get(patient.id);
    return !!latest && latest < archiveThresholdISO();
  }).length;

  const importantAlertRows: Array<AlertRow & { count: number; priority: number }> = [
    {
      title: 'مواعيد فات وقتها',
      text: `${overdueAppointmentsCount} مواعيد لم يتم تحديث حالتها`,
      tone: 'danger',
      icon: 'alert',
      href: '/alerts#overdue',
      count: overdueAppointmentsCount,
      priority: 1
    },
    {
      title: 'مواعيد اليوم غير مكتملة',
      text: `${allTodayOpenAppointmentsCount} مواعيد تحتاج متابعة`,
      tone: 'primary',
      icon: 'clock',
      href: '/alerts#today-open',
      count: allTodayOpenAppointmentsCount,
      priority: 2
    },
    {
      title: 'تأكيد مواعيد',
      text: `${allPendingAppointmentsCount} مواعيد بانتظار التأكيد`,
      tone: 'warning',
      icon: 'calendar',
      href: '/alerts#pending',
      count: allPendingAppointmentsCount,
      priority: 3
    },
    {
      title: 'مرضى لم يحضروا',
      text: `${noShowNeedFollowupCount} مرضى يحتاجون متابعة`,
      tone: 'warning',
      icon: 'users',
      href: '/alerts#no-show-followup',
      count: noShowNeedFollowupCount,
      priority: 4
    },
    {
      title: 'جلسات بدون ملاحظات',
      text: `${visitsMissingNotesCount} جلسات تحتاج استكمال`,
      tone: 'primary',
      icon: 'tooth',
      href: '/alerts#missing-visit-notes',
      count: visitsMissingNotesCount,
      priority: 5
    },
    {
      title: 'خطط بدون موعد قادم',
      text: `${activePlansWithoutNextAppointmentCount} خطط علاج تحتاج متابعة`,
      tone: 'primary',
      icon: 'tooth',
      href: '/alerts#followup',
      count: activePlansWithoutNextAppointmentCount,
      priority: 6
    },
    {
      title: 'مرضى مرشحون للأرشفة',
      text: `${archiveCandidatesCount} مرضى بدون موعد منذ 3 أشهر`,
      tone: 'warning',
      icon: 'archive',
      href: '/alerts#archive-candidates',
      count: archiveCandidatesCount,
      priority: 7
    }
  ];

  const alerts: AlertRow[] = importantAlertRows
    .filter((alert) => alert.count > 0)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const importantAlertsCount = allPendingAppointmentsCount
    + overdueAppointmentsCount
    + allTodayOpenAppointmentsCount
    + noShowNeedFollowupCount
    + visitsMissingNotesCount
    + activePlansWithoutNextAppointmentCount
    + archiveCandidatesCount;

  const stats = [
    { title: 'مواعيد اليوم', value: confirmedAppointments, hint: 'حسب التاريخ المحدد', icon: 'calendar', tone: 'blue' as const, dangerHint: false },
    { title: 'بانتظار التأكيد', value: pendingAppointments, hint: 'مواعيد تحتاج متابعة', icon: 'clock', tone: 'orange' as const, dangerHint: false },
    { title: 'مرضى جدد', value: newPatients, hint: 'آخر المرضى المضافين', icon: 'users', tone: 'purple' as const, dangerHint: false }
  ];

  const todayLabel = useMemo(() => formatArabicDateLong(todayISO()), []);
  const greetingInfo = useMemo(() => getDashboardGreeting(), []);
  const appointmentsTitle = selectedDate === todayISO() ? 'مواعيد اليوم' : 'مواعيد العيادة';


  async function startAppointmentCompletion(row: AppointmentRow) {
    if (!staff || !row.patientId) return;
    const { data } = await supabase
      .from('patient_dental_chart')
      .select('*')
      .eq('clinic_id', staff.clinic_id)
      .eq('patient_id', row.patientId)
      .order('tooth_number');
    setDentalChartRows((data || []) as DentalChartRow[]);
    setCompletionRow(row);
    setCompletionForm({ procedure_done: '', doctor_notes: '' });
    setCompletionTeeth([]);
    setCompletionStep(1);
  }

  function toggleCompletionTooth(tooth: string) {
    setCompletionTeeth((current) => {
      if (current.some((item) => item.tooth_number === tooth)) return current.filter((item) => item.tooth_number !== tooth);
      const chartRow = dentalChartRows.find((row) => row.tooth_number === tooth);
      return [...current, {
        tooth_number: tooth,
        old_status: chartRow?.status || null,
        new_status: chartRow?.status || 'healthy',
        procedure_done: completionForm.procedure_done,
        notes: ''
      }];
    });
  }

  function updateCompletionTooth(tooth: string, patch: Partial<CompletionToothForm>) {
    setCompletionTeeth((current) => current.map((item) => item.tooth_number === tooth ? { ...item, ...patch } : item));
  }

  function applyProcedureToAllCompletionTeeth(value: string) {
    setCompletionForm((current) => ({ ...current, procedure_done: value }));
    setCompletionTeeth((current) => current.map((item) => ({ ...item, procedure_done: value })));
  }

  function applyStatusToAllCompletionTeeth(value: string) {
    setCompletionTeeth((current) => current.map((item) => ({ ...item, new_status: value })));
  }

  async function updateAppointmentStatus(row: AppointmentRow, nextStatus: string) {
    const action = getAppointmentStatusActions(row.status).find((item) => item.status === nextStatus);
    if (!staff || !action) return;

    if (action.status === 'completed') {
      if (!canManageMedical) {
        await showSecureMessage('صلاحية غير متاحة', 'إنهاء الجلسة الطبية وتحديث مخطط الأسنان متاح للطبيب فقط.');
        setStatusMenuRow(null);
        return;
      }
      setStatusMenuRow(null);
      await startAppointmentCompletion(row);
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
    await logActivity(staff, 'appointment_status_updated', 'appointment', row.id, { status: row.status }, { status: action.status });
    load();
  }

  async function submitAppointmentCompletion(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !completionRow || !completionRow.patientId || !canManageMedical) return;
    if (!completionTeeth.length) {
      setCompletionStep(1);
      await showSecureMessage('حدد الأسنان المعالجة', 'اختر سنًا واحدًا على الأقل من مخطط الأسنان قبل إنهاء الجلسة.');
      return;
    }
    const procedureSummary = completionForm.procedure_done.trim() || completionTeeth.map((item) => item.procedure_done.trim()).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join('، ');
    if (!procedureSummary) {
      setCompletionStep(2);
      await showSecureMessage('الإجراء غير مكتمل', 'اكتب الإجراء المنفذ ليتم حفظ الجلسة وتحديث مخطط الأسنان.');
      return;
    }
    const missingToothNotes = completionTeeth.filter((item) => !item.notes.trim());
    if (missingToothNotes.length) {
      setCompletionStep(4);
      await showSecureMessage('ملاحظات الأسنان غير مكتملة', 'يجب تعبئة ملاحظة لكل سن محدد قبل حفظ الجلسة.');
      return;
    }
    const doctorNotes = completionForm.doctor_notes.trim();
    if (!doctorNotes) {
      setCompletionStep(4);
      await showSecureMessage('الملاحظات العامة غير مكتملة', 'اكتب الملاحظات الطبية العامة للمريض قبل حفظ الجلسة.');
      return;
    }
    setSavingCompletion(true);
    const result = await completeAppointmentWithVisit({
      clinicId: staff.clinic_id,
      patientId: completionRow.patientId,
      appointmentId: completionRow.id,
      serviceId: completionRow.serviceId,
      visitDate: completionRow.appointmentDate || selectedDate,
      procedureDone: procedureSummary,
      doctorNotes,
      createdBy: staff.id,
      teeth: completionTeeth.map((item) => ({
        toothNumber: item.tooth_number,
        oldStatus: item.old_status,
        newStatus: item.new_status,
        procedureDone: item.procedure_done || procedureSummary,
        notes: item.notes
      }))
    });
    setSavingCompletion(false);

    if (result.error) {
      await showSecureMessage('تعذر إنهاء الموعد', result.error);
      return;
    }

    setCompletionRow(null);
    setCompletionForm({ procedure_done: '', doctor_notes: '' });
    setCompletionTeeth([]);
    setCompletionStep(1);
    setDentalChartRows([]);
    await logActivity(staff, 'appointment_completed', 'appointment', completionRow.id, null, { procedure_done: procedureSummary, teeth: completionTeeth.map((item) => item.tooth_number) });
    load();
  }

  return (
    <div className="dashboard-premium-shell dashboard-layout-v3">
      <aside className="dashboard-left-rail" dir="rtl">
        <div className="premium-card dashboard-alerts-card">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[22px] font-black">تنبيهات مهمة</h2>
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary" title={`إجمالي التنبيهات: ${importantAlertsCount}`}>
              <Icon name="bell" className="h-6 w-6" />
            </div>
          </div>
          {alerts.length ? (
            <div className="space-y-3">
              {alerts.map((a) => <AlertCard key={a.title} alert={a} />)}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-white p-5 text-center">
              <p className="font-black text-slate-900">لا توجد تنبيهات مهمة حالياً</p>
              <p className="mt-2 text-sm font-bold text-slate-500">كل شيء محدث ومنظم.</p>
            </div>
          )}
          <Link href="/alerts" className="mt-5 inline-flex items-center gap-2 text-base font-black text-primary">
            <Icon name="arrow" className="h-4 w-4" /> عرض كل التنبيهات
          </Link>
        </div>

        <div className="premium-card dashboard-patient-card">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[22px] font-black">ملف المريض</h2>
            <Icon name="users" className="h-6 w-6" />
          </div>

          {featured ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <div className="text-right">
                  <p className="text-[22px] font-black leading-tight">{featured.full_name}</p>
                  <p className="mt-2 text-sm font-bold text-slate-500 number-ltr">{featured.phone || 'لا يوجد رقم'}</p>
                </div>
                <div className="patient-person-avatar dashboard-patient-person-avatar" aria-hidden="true">
                  <Icon name="user" className="h-9 w-9" />
                </div>
              </div>

              <PatientRecentVisits visits={featuredVisits} />

              {hasFinancialAccess ? (
                <div className="mt-5 divide-y divide-border rounded-2xl border border-border bg-white/75">
                  {featuredLastPayment ? (
                    <>
                      <InfoRow label="آخر دفعة" value={formatMoney(Number(featuredLastPayment.amount || 0), currencySymbol)} success />
                      <InfoRow label="تاريخ آخر دفعة" value={formatDate(featuredLastPayment.payment_date)} calendar />
                    </>
                  ) : (
                    <div className="px-4 py-3 text-sm font-bold text-slate-500">لا توجد دفعات مسجلة لهذا المريض.</div>
                  )}
                  <InfoRow label="المبلغ المتبقي" value={formatMoney(featuredRemaining, currencySymbol)} danger={featuredRemaining > 0} />
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-border bg-white/75 p-4 text-sm leading-7 text-slate-600">
                  تظهر للسكرتيرة معلومات المتابعة الأساسية فقط، بينما تبقى البيانات المالية مخفية.
                </div>
              )}

              <Link href={`/patients/profile?id=${featured.id}`} className="outline-btn mt-5 w-full justify-center py-3 text-base font-black">
                <Icon name="file" /> فتح ملف المريض
              </Link>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-white/70 p-6 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary"><Icon name="users" className="h-7 w-7" /></div>
              <p className="mt-4 font-black text-slate-900">لا يوجد مريض محدد حالياً</p>
              <p className="mt-2 text-sm font-bold leading-7 text-slate-500">اختر مريضاً من جدول المواعيد أو أضف مريضاً جديداً لعرض ملخصه هنا.</p>
              <Link href="/patients" className="outline-btn mt-5 w-full justify-center py-3 text-base font-black"><Icon name="users" /> فتح المرضى</Link>
            </div>
          )}
        </div>
      </aside>

      <section className="dashboard-main-column" dir="rtl">
        <div className="dashboard-greeting-row">
          <div className="dashboard-date-inline" aria-label="تاريخ اليوم">{todayLabel}</div>
          <div className="dashboard-greeting-text text-right">
            <h1 className="dashboard-greeting-heading text-[22px] font-black text-slate-900 lg:text-[28px]" dir="rtl">
              <span aria-hidden="true" className="dashboard-greeting-icon">{greetingInfo.icon}</span>
              <span>{greetingInfo.label}</span>
            </h1>
          </div>
        </div>

        <div className="dashboard-stats-grid">
          {stats.map((item) => (
            <StatTile
              key={item.title}
              title={item.title}
              value={item.value}
              hint={item.hint}
              icon={item.icon}
              tone={item.tone}
              dangerHint={'dangerHint' in item ? item.dangerHint : false}
            />
          ))}
        </div>

        <div className="premium-card dashboard-appointments-card">
          <div className="dashboard-appointments-toolbar mb-4">
            <div className="dashboard-appointments-title">
              <h2 className="flex items-center gap-2 text-[20px] font-black lg:text-[22px]">
                <Icon name="calendar" className="h-5 w-5" />
                <span>{appointmentsTitle}</span>
              </h2>
            </div>

            <div className="dashboard-appointments-utility-row">
              <div className="dashboard-appointments-controls">
                <label className="dashboard-date-filter text-sm font-black text-slate-600" aria-label="اختيار تاريخ المواعيد">
                  <input className="soft-input h-11 w-[145px] number-ltr" type="date" value={selectedDate} onChange={(e)=>setSelectedDate(e.target.value || todayISO())} />
                </label>
                <button className="outline-btn h-11 px-4 text-sm" onClick={()=>setSelectedDate(todayISO())}>اليوم</button>
              </div>

              <div className="dashboard-appointments-actions">
                <Link href="/patients?new=1" className="outline-btn h-11 px-4 text-sm"><Icon name="users" className="h-4 w-4" /> إضافة مريض</Link>
                <Link href="/appointments?new=1" className="premium-btn h-11 px-4 text-sm"><Icon name="plus" className="h-4 w-4" /> إضافة موعد</Link>
              </div>
            </div>
          </div>

          <div className="appointment-grid-table" role="table" aria-label="مواعيد الصفحة الرئيسية">
            <div className={`appointment-grid-row appointment-grid-head ${hasFinancialAccess ? 'appointment-grid-with-finance' : 'appointment-grid-no-finance'}`} role="row">
              <div role="columnheader">الوقت</div>
              <div role="columnheader">المريض</div>
              <div role="columnheader">الخدمة</div>
              <div role="columnheader">الحالة</div>
              {hasFinancialAccess ? <div role="columnheader">المبلغ</div> : null}
              <div role="columnheader">الإجراءات</div>
            </div>

            {appointmentRows.length === 0 ? (
              <div className="appointment-grid-empty" role="row">
                {selectedDate === todayISO() ? 'لا توجد مواعيد اليوم.' : 'لا توجد مواعيد في هذا التاريخ.'} استخدم زر إضافة موعد من الرئيسية.
              </div>
            ) : (
              appointmentRows.map((row) => (
                <AppointmentLine
                  key={row.id}
                  row={row}
                  hasFinancialAccess={hasFinancialAccess}
                  currencySymbol={currencySymbol}
                  onSelectPatient={setSelectedPatientId}
                  onOpenStatus={(item) => setStatusMenuRow(item)}
                  isSelected={selectedPatientId === row.patientId || (!selectedPatientId && featured?.id === row.patientId)}
                />
              ))
            )}
          </div>

          <Link href="/appointments" className="mt-4 inline-flex items-center gap-2 text-base font-black text-primary">
            <Icon name="arrow" className="h-4 w-4" /> {selectedDate === todayISO() ? 'عرض كل مواعيد اليوم' : 'عرض صفحة المواعيد'}
          </Link>
        </div>

        <Modal open={!!statusMenuRow} title="تغيير حالة الموعد" onClose={() => setStatusMenuRow(null)}>
          {statusMenuRow ? (
            <div className="space-y-4 text-right">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="font-black text-slate-900">{statusMenuRow.patient}</p>
                <p className="mt-1 text-sm font-bold text-slate-500">{statusMenuRow.service} — {statusMenuRow.time}</p>
                <div className="mt-3"><StatusBadge tone={appointmentStatusTone(statusMenuRow.status)}>{appointmentStatusLabels[statusMenuRow.status as keyof typeof appointmentStatusLabels] || statusMenuRow.status}</StatusBadge></div>
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

        <Modal open={!!completionRow} title="إنهاء الجلسة بخطوات بسيطة" className="completion-modal-panel" onClose={() => { if (!savingCompletion) { setCompletionRow(null); setCompletionTeeth([]); setCompletionStep(1); } }}>
          {completionRow ? (
            <form onSubmit={submitAppointmentCompletion} className="grid gap-4 text-right">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="font-black text-slate-900">{completionRow.patient}</p>
                <p className="mt-1 text-sm font-bold text-slate-500 number-ltr">{completionRow.appointmentDate || selectedDate} — {completionRow.time}</p>
                <p className="mt-2 text-primary font-black">{completionRow.service}</p>
              </div>

              <div className="completion-steps" aria-label="خطوات إنهاء الجلسة">
                {['اختر الأسنان', 'الإجراء', 'الحالة بعد العلاج', 'ملاحظات وحفظ'].map((label, index) => (
                  <div key={label} className={`completion-step ${completionStep === index + 1 ? 'is-active' : completionStep > index + 1 ? 'is-done' : ''}`}>
                    <span className="number-ltr">{index + 1}</span>
                    <strong>{label}</strong>
                  </div>
                ))}
              </div>

              {completionStep === 1 ? (
                <div className="rounded-3xl border border-border bg-white/80 p-4">
                  <div className="mb-3">
                    <p className="font-black text-slate-900">اختر الأسنان التي تم العمل عليها</p>
                    <p className="mt-1 text-sm font-bold text-slate-500">اضغط على سن واحد أو أكثر. بعد ذلك انتقل إلى الخطوة التالية.</p>
                  </div>
                  <div className="dental-arch-wrap compact">
                    {toothGroups.map((group, groupIndex) => (
                      <div key={groupIndex} className="dental-arch-row">
                        {group.map((tooth) => {
                          const chartRow = dentalChartRows.find((row) => row.tooth_number === tooth);
                          const selected = completionTeeth.some((item) => item.tooth_number === tooth);
                          return (
                            <button key={tooth} type="button" className={`tooth-button ${dentalStatusClass(chartRow?.status)} ${selected ? 'is-selected' : ''}`} onClick={() => toggleCompletionTooth(tooth)} title={`سن ${tooth} - ${dentalStatusLabel(chartRow?.status)}`}>
                              <span className="tooth-shape">{tooth}</span>
                              <small>{selected ? 'محدد' : dentalStatusLabel(chartRow?.status)}</small>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {!completionTeeth.length ? <p className="mt-4 rounded-2xl border border-warning/25 bg-warning/10 p-3 text-sm font-bold text-slate-600">حدد سنًا واحدًا على الأقل لإكمال إنهاء الجلسة.</p> : null}
                </div>
              ) : null}

              {completionStep === 2 ? (
                <div className="rounded-3xl border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">الإجراء المنفذ</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">اكتب الإجراء مرة واحدة وسيتم تطبيقه على كل الأسنان المحددة.</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{completionTeeth.length} أسنان محددة</span>
                  </div>
                  <textarea className="soft-input min-h-24" value={completionForm.procedure_done} onChange={(e) => applyProcedureToAllCompletionTeeth(e.target.value)} placeholder="مثال: حشوة، علاج عصب، تنظيف، تقويم..." />
                  <div className="selected-teeth-chip-row mt-3">
                    {completionTeeth.map((item) => <span key={item.tooth_number} className="selected-tooth-chip number-ltr">{item.tooth_number}</span>)}
                  </div>
                </div>
              ) : null}

              {completionStep === 3 ? (
                <div className="grid gap-4">
                  <div className="rounded-3xl border border-border bg-muted/30 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-black text-slate-900">الحالة بعد العلاج</p>
                        <p className="mt-1 text-sm font-bold text-slate-500">اختر حالة واحدة لتطبيقها على كل الأسنان المحددة.</p>
                      </div>
                      <select className="soft-input max-w-56" value={completionTeeth[0]?.new_status || 'healthy'} onChange={(e) => applyStatusToAllCompletionTeeth(e.target.value)}>
                        {dentalStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                      </select>
                    </div>
                    <div className="selected-teeth-state-grid">
                      {completionTeeth.map((item) => (
                        <div key={item.tooth_number} className="selected-tooth-state-card">
                          <strong className="number-ltr">{item.tooth_number}</strong>
                          <span className={`dental-status-pill ${dentalStatusClass(item.old_status)}`}>{dentalStatusLabel(item.old_status)}</span>
                          <span className="text-xs font-black text-slate-400">←</span>
                          <span className={`dental-status-pill ${dentalStatusClass(item.new_status)}`}>{dentalStatusLabel(item.new_status)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <details className="advanced-only-section rounded-3xl border border-border p-4">
                    <summary className="cursor-pointer select-none font-black text-slate-700">تعديل حالة سن محدد عند الحاجة</summary>
                    <div className="completion-teeth-grid mt-4">
                      {completionTeeth.map((item) => (
                        <label key={item.tooth_number} className="completion-tooth-card compact-card">
                          <span className="block text-xs font-black text-slate-500">سن <span className="number-ltr">{item.tooth_number}</span></span>
                          <select className="soft-input mt-2" value={item.new_status} onChange={(e) => updateCompletionTooth(item.tooth_number, { new_status: e.target.value })}>
                            {dentalStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>
                </div>
              ) : null}

              {completionStep === 4 ? (
                <div className="grid gap-4">
                  <div className="rounded-3xl border border-border bg-muted/30 p-4">
                    <div className="mb-3">
                      <p className="font-black text-slate-900">ملاحظات الأسنان المحددة</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">اكتب ملاحظة لكل سن تم تحديده. هذه الملاحظات مطلوبة لحفظ السجل الطبي بدقة.</p>
                    </div>
                    <div className="completion-scroll-panel">
                      <div className="completion-teeth-grid">
                        {completionTeeth.map((item) => {
                          const missingNote = !item.notes.trim();
                          return (
                            <label key={item.tooth_number} className={`completion-tooth-card compact-card ${missingNote ? 'has-error' : ''}`}>
                              <span className="block text-xs font-black text-slate-500">ملاحظة لسن <span className="number-ltr">{item.tooth_number}</span></span>
                              <textarea className="soft-input mt-2 min-h-20" value={item.notes} onChange={(e) => updateCompletionTooth(item.tooth_number, { notes: e.target.value })} placeholder="مثال: ألم عند الضغط، حشوة مؤقتة، يحتاج متابعة..." />
                              {missingNote ? <span className="field-error-message">يجب تعبئة ملاحظة هذا السن.</span> : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <label>
                    <span className="mb-2 block font-bold">ملاحظات طبية عامة للمريض</span>
                    <textarea className={`soft-input min-h-28 ${!completionForm.doctor_notes.trim() ? 'input-error' : ''}`} placeholder="مثال: توصيات بعد الجلسة، أدوية، حساسية، تعليمات للمريض..." value={completionForm.doctor_notes} onChange={(e) => setCompletionForm({ ...completionForm, doctor_notes: e.target.value })} />
                    {!completionForm.doctor_notes.trim() ? <span className="field-error-message">يجب تعبئة الملاحظات الطبية العامة.</span> : null}
                  </label>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button type="button" className="outline-btn" onClick={() => setCompletionRow(null)} disabled={savingCompletion}>تراجع</button>
                <div className="flex gap-2">
                  {completionStep > 1 ? <button type="button" className="outline-btn" onClick={() => setCompletionStep((step) => Math.max(1, step - 1))} disabled={savingCompletion}>السابق</button> : null}
                  {completionStep < 4 ? <button type="button" className="premium-btn" onClick={() => { if (completionStep === 1 && !completionTeeth.length) return; setCompletionStep((step) => Math.min(4, step + 1)); }}>التالي</button> : <button className="premium-btn" disabled={savingCompletion}>{savingCompletion ? 'جاري الحفظ...' : 'حفظ الجلسة وتحديث الأسنان'}</button>}
                </div>
              </div>
            </form>
          ) : null}
        </Modal>

      </section>
    </div>
  );
}

function AppointmentLine({ row, hasFinancialAccess, currencySymbol, onSelectPatient, onOpenStatus, isSelected }: { row: AppointmentRow; hasFinancialAccess: boolean; currencySymbol: string; onSelectPatient: (patientId: string) => void; onOpenStatus: (row: AppointmentRow) => void; isSelected?: boolean }) {
  const item = { label: appointmentStatusLabels[row.status as keyof typeof appointmentStatusLabels] || row.status, tone: appointmentStatusTone(row.status) };


  return (
    <div className={`appointment-grid-row appointment-grid-body ${hasFinancialAccess ? 'appointment-grid-with-finance' : 'appointment-grid-no-finance'}`} role="row">
      <div className="appointment-grid-cell appointment-time" role="cell"><span className="appointment-cell-number number-ltr">{row.time}</span></div>
      <div className="appointment-grid-cell appointment-patient" role="cell">
        {row.patientId ? (
          <button
            type="button"
            onClick={() => onSelectPatient(row.patientId!)}
            className={`appointment-patient-button ${isSelected ? 'is-selected' : ''}`}
            title="عرض هذا المريض في بطاقة ملف المريض"
          >
            {row.patient}
          </button>
        ) : row.patient}
      </div>
      <div className="appointment-grid-cell appointment-service" role="cell">{row.service}</div>
      <div className="appointment-grid-cell appointment-status" role="cell">
        {getAppointmentStatusActions(row.status).length ? (
          <button type="button" className="status-picker-button" onClick={() => onOpenStatus(row)} title="تغيير حالة الموعد">
            <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
          </button>
        ) : (
          <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
        )}
      </div>
      {hasFinancialAccess ? <div className="appointment-grid-cell appointment-amount" role="cell"><span className="appointment-cell-number number-ltr">{formatMoney(row.amount, currencySymbol)}</span></div> : null}
      <div className="appointment-grid-cell appointment-actions" role="cell">
        <Link href={row.patientId ? `/patients/profile?id=${row.patientId}` : '/patients'} className="outline-btn appointment-action-btn">
          <Icon name="file" className="h-4 w-4" /> الملف
        </Link>
        {hasFinancialAccess && row.status === 'completed' ? (
          <Link href="/finance" className="outline-btn appointment-action-btn">
            <Icon name="plus" className="h-4 w-4" /> دفعة
          </Link>
        ) : null}
      </div>
    </div>
  );}

function FinanceMiniCard({ label, value, currencySymbol, tone }: { label: string; value: number; currencySymbol: string; tone?: 'success' | 'danger' }) {
  const valueColor = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-slate-900';


return (
    <div className="rounded-2xl border border-border bg-white/80 p-5 text-right shadow-subtle">
      <p className="text-sm font-black text-slate-500">{label}</p>
      <p className={`mt-3 text-2xl font-black number-ltr ${valueColor}`}>{formatMoney(value, currencySymbol)}</p>
    </div>
  );
}

function AlertCard({ alert }: { alert: AlertRow }) {
  const color = alert.tone === 'danger'
    ? 'bg-danger/10 text-danger'
    : alert.tone === 'warning'
      ? 'bg-warning/10 text-warning'
      : 'bg-primary/10 text-primary';


const content = (
    <>
      <Icon name="arrow" className="h-5 w-5 text-slate-500" />
      <div className="flex flex-1 items-center justify-end gap-3 text-right">
        <div>
          <p className="font-black">{alert.title}</p>
          <p className="mt-1 text-sm text-slate-500">{alert.text}</p>
        </div>
        <div className={`grid h-12 w-12 place-items-center rounded-full ${color}`}><Icon name={alert.icon} /></div>
      </div>
    </>
  );

  if (alert.href) {
    return <Link href={alert.href} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 transition hover:border-primary/40 hover:bg-primary/5">{content}</Link>;
  }

return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4">
      {content}
    </div>
  );
}

function PatientRecentVisits({ visits }: { visits: Visit[] }) {
  return (
    <div className="mt-5 rounded-2xl border border-border bg-white/75 p-4 text-right">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-black text-slate-500">آخر ما تم إجراؤه</span>
        <Icon name="tooth" className="h-5 w-5 text-primary" />
      </div>
      {visits.length ? (
        <div className="space-y-3">
          {visits.map((visit) => (
            <div key={visit.id} className="rounded-2xl bg-muted/45 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900">{visit.services?.name || 'جلسة علاج'}</span>
                <span className="text-xs font-black text-slate-500 number-ltr">التاريخ: {formatDate(visit.visit_date)}</span>
              </div>
              <p className="patient-recent-visit-text text-sm font-bold leading-7 text-slate-600">
                {visit.procedure_done?.trim() || 'لم يتم تسجيل ما تم إجراؤه بعد'}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-muted/45 p-3 text-sm font-bold leading-7 text-slate-500">لا توجد جلسات مسجلة لهذا المريض بعد.</p>
      )}
    </div>
  );
}

function InfoRow({ label, value, success, danger, calendar }: { label: string; value: string; success?: boolean; danger?: boolean; calendar?: boolean }) {

return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <span className={`${success ? 'text-success' : danger ? 'text-danger' : 'text-slate-900'} font-black number-ltr`}>
        {value}{calendar ? <Icon name="calendar" className="mr-2 inline h-4 w-4 text-slate-500" /> : null}
      </span>
    </div>
  );
}


function getDashboardGreeting() {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return { label: 'صباح الخير', icon: '☀️' };
  }
  if (hour >= 18 || hour < 5) {
    return { label: 'مساء الخير', icon: '🌙' };
  }

  return { label: 'مرحباً', icon: '👋' };
}

function makeLocalDate(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatArabicDateLong(value?: string | null) {
  const date = makeLocalDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatArabicDateShort(value?: string | null) {
  const date = makeLocalDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  const [hRaw, mRaw] = value.slice(0, 5).split(':');
  const h = Number(hRaw);
  const suffix = h >= 12 ? 'م' : 'ص';
  const hour = h % 12 || 12;
  return `${hour.toString().padStart(2, '0')}:${mRaw || '00'} ${suffix}`;
}

export default function DashboardPage(){
  return <AppShell>{(ctx) => <DashboardContent {...ctx} />}</AppShell>;
}
