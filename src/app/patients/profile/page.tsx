'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { PatientHeader } from '@/components/patients/PatientHeader';
import { PatientOverviewTab } from '@/components/patients/PatientOverviewTab';
import { PatientDentalChart, dentalStatusClass, dentalStatusLabel, dentalStatusOptions, toothGroups } from '@/components/patients/PatientDentalChart';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { SkeletonCard } from '@/components/Skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { appointmentStatusLabels, appointmentStatusLabels as statusLabels, planStatusLabels } from '@/lib/constants';
import { completeAppointmentWithVisit } from '@/lib/appointmentCompletion';
import { appointmentStatusOptions, appointmentStatusTone, getAppointmentStatusActions } from '@/lib/appointmentWorkflow';
import { canManageMedicalRecords, canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/audit';
import { logFinancialAudit } from '@/lib/financialAudit';
import { printPaymentReceipt, receiptNumber } from '@/lib/paymentReceipt';
import { showToast } from '@/lib/toast';
import { canDeletePatientFinancially, canDeleteTreatmentPlanSafely, requestActionConfirmation, requestPasswordConfirmation, showSecureMessage } from '@/lib/secureActions';
import type { Appointment, Patient, Payment, Service, TreatmentPlan, Visit, WorkingHour, PatientImage, Installment, DentalChartRow, FinancialAuditLog, VisitTooth } from '@/lib/types';
import { formatDate, formatMoney, getCurrencySymbol, getDayOfWeek, timeToMinutes, todayISO } from '@/lib/utils';
import { appendToCachedList, getCache, getOnlineStatus, makeLocalId, offlineKeys, queueOperation, setCache } from '@/lib/offline';

function getPatientIdFromUrl() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('id') || '';
}

const paymentMethodText: Record<string, string> = {
  cash: 'نقداً',
  transfer: 'حوالة',
  card: 'بطاقة',
  other: 'أخرى'
};

const paymentTypeText: Record<string, string> = {
  down_payment: 'دفعة أولى',
  installment: 'قسط',
  full_payment: 'دفعة كاملة',
  extra_payment: 'دفعة إضافية',
  refund: 'استرجاع'
};

function getInstallmentLabel(installment?: Installment | null) {
  if (!installment) return 'غير مرتبط بقسط';
  const number = installment.installment_number ? `رقم ${installment.installment_number}` : formatDate(installment.due_date);
  return `قسط ${number}`;
}

const MAX_PATIENT_ATTACHMENTS = 10;
const MAX_PATIENT_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const allowedPatientAttachmentTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];
const allowedPatientAttachmentExtensions = ['.pdf', '.doc', '.docx', '.txt'];

type PatientProfileTab = 'overview' | 'dental' | 'appointments' | 'visits' | 'files' | 'finance' | 'notes';

type CompletionToothForm = { tooth_number: string; old_status: string | null; new_status: string; procedure_done: string; notes: string };


function isSupportedPatientAttachment(file: File) {
  const fileName = file.name.toLowerCase();
  const hasSupportedExtension = allowedPatientAttachmentExtensions.some((ext) => fileName.endsWith(ext));
  return file.type.startsWith('image/') || allowedPatientAttachmentTypes.includes(file.type) || hasSupportedExtension;
}

function isImageAttachment(attachment: PatientImage) {
  return (attachment.file_type || '').startsWith('image/') || attachment.image_data.startsWith('data:image/') || /\.(png|jpg|jpeg|webp|gif)$/i.test(attachment.file_name || '');
}

function getAttachmentDisplayName(attachment: PatientImage) {
  return attachment.file_name || attachment.description || 'ملف مرفق';
}

function getAttachmentIcon(attachment: PatientImage) {
  const name = getAttachmentDisplayName(attachment).toLowerCase();
  if (name.endsWith('.pdf')) return '📕';
  if (name.endsWith('.doc') || name.endsWith('.docx')) return '📘';
  if (name.endsWith('.txt')) return '📄';
  return '📎';
}

function formatFileSize(size?: number | null) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(name?: string | null) {
  const clean = String(name || '').trim();
  if (!clean) return 'م';
  return clean.split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-\u0600-\u06FF]+/g, '-').slice(0, 90);
}

function PatientProfileContent({ staff, clinic }: AppContext) {
  const router = useRouter();
  const [patientId, setPatientId] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHour[]>([]);
  const [patientImages, setPatientImages] = useState<PatientImage[]>([]);
  const [dentalChartRows, setDentalChartRows] = useState<DentalChartRow[]>([]);
  const [financialAuditLogs, setFinancialAuditLogs] = useState<FinancialAuditLog[]>([]);
  const [imageFeatureAvailable, setImageFeatureAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PatientProfileTab>('overview');
  const [showFinanceDetails, setShowFinanceDetails] = useState(false);
  const [completionStep, setCompletionStep] = useState(1);

  const [openPatientEdit, setOpenPatientEdit] = useState(false);
  const [patientForm, setPatientForm] = useState({ full_name: '', phone: '', address: '', medical_notes: '' });
  const [openPlan, setOpenPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TreatmentPlan | null>(null);
  const [openPayment, setOpenPayment] = useState(false);
  const [openInstallment, setOpenInstallment] = useState(false);
  const [openAppointment, setOpenAppointment] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [planForm, setPlanForm] = useState({ service_id: '', title: '', total_amount: '0', discount_amount: '0', status: 'active', notes: '' });
  const [paymentForm, setPaymentForm] = useState({ treatment_plan_id: '', installment_id: '', amount: '', payment_method: 'cash', payment_type: 'installment', notes: '' });
  const [installmentForm, setInstallmentForm] = useState({ treatment_plan_id: '', due_date: todayISO(), amount: '', notes: '' });
  const [appointmentForm, setAppointmentForm] = useState({ service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
  const [appointmentFilters, setAppointmentFilters] = useState({ date: '', status: '', service_id: '', sort: 'desc' });
  const [statusMenuRow, setStatusMenuRow] = useState<Appointment | null>(null);
  const [completionRow, setCompletionRow] = useState<Appointment | null>(null);
  const [completionForm, setCompletionForm] = useState({ procedure_done: '', doctor_notes: '' });
  const [completionTeeth, setCompletionTeeth] = useState<CompletionToothForm[]>([]);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null);
  const [visitEditForm, setVisitEditForm] = useState({ procedure_done: '', doctor_notes: '' });
  const [savingVisitEdit, setSavingVisitEdit] = useState(false);
  const [openMedicalNotesEdit, setOpenMedicalNotesEdit] = useState(false);
  const [medicalNotesDraft, setMedicalNotesDraft] = useState('');
  const [savingMedicalNotes, setSavingMedicalNotes] = useState(false);
  const [openImageModal, setOpenImageModal] = useState(false);
  const [imageDescription, setImageDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [savingImage, setSavingImage] = useState(false);

  const canViewFinance = canViewFullFinancials(staff);
  const canManageMedical = canManageMedicalRecords(staff);
  const canDeleteFiles = staff?.role === 'admin' || staff?.role === 'doctor';
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);

  useEffect(() => {
    setPatientId(getPatientIdFromUrl());
  }, []);

  async function signPatientFiles(items: PatientImage[]) {
    return Promise.all(items.map(async (item) => {
      const storagePath = item.storage_path || (!item.image_data.startsWith('data:') && !item.image_data.startsWith('http') ? item.image_data : '');
      if (!storagePath) return item;
      const { data } = await supabase.storage.from('patient-files').createSignedUrl(storagePath, 60 * 60);
      return { ...item, storage_path: storagePath, image_data: data?.signedUrl || item.image_data };
    }));
  }

  async function load() {
    if (!staff || !patientId) return;
    setLoading(true);

    const cacheKey = offlineKeys.patientProfile(staff.clinic_id, patientId);
    if (!getOnlineStatus()) {
      const cached = await getCache<any>(cacheKey);
      if (cached) {
        setPatient(cached.patient || null);
        setAppointments(cached.appointments || []);
        setServices(cached.services || []);
        setWorkingHours(cached.workingHours || []);
        setVisits(cached.visits || []);
        setDentalChartRows(cached.dentalChartRows || []);
        setPatientImages(cached.patientImages || []);
        setPlans(cached.plans || []);
        setPayments(cached.payments || []);
        setInstallments(cached.installments || []);
        setFinancialAuditLogs(cached.financialAuditLogs || []);
        setLoading(false);
        return;
      }
    }

    const [patientRes, appointmentsRes, servicesRes, visitsRes, imagesRes, dentalChartRes, workingHoursRes] = await Promise.all([
      supabase.from('patients').select('*').eq('clinic_id', staff.clinic_id).eq('id', patientId).maybeSingle(),
      supabase.from('appointments').select('*, services(*)').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('appointment_date', { ascending: false }).order('appointment_time'),
      supabase.from('services').select('*').eq('clinic_id', staff.clinic_id).eq('is_active', true).order('name'),
      supabase.from('visits').select('*, services(*), treatment_plans(*), visit_teeth(*)').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('visit_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('patient_images').select('*').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('patient_dental_chart').select('*').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('tooth_number'),
      supabase.from('clinic_working_hours').select('*').eq('clinic_id', staff.clinic_id)
    ]);

    setPatient(patientRes.data as Patient | null);
    setAppointments((appointmentsRes.data || []) as Appointment[]);
    setServices((servicesRes.data || []) as Service[]);
    setWorkingHours((workingHoursRes.data || []) as WorkingHour[]);
    setVisits((visitsRes.data || []) as Visit[]);
    setDentalChartRows((dentalChartRes.data || []) as DentalChartRow[]);

    if (imagesRes.error) {
      setImageFeatureAvailable(false);
      setPatientImages([]);
    } else {
      setImageFeatureAvailable(true);
      setPatientImages(await signPatientFiles((imagesRes.data || []) as PatientImage[]));
    }

    let plansCache: TreatmentPlan[] = [];
    let paymentsCache: Payment[] = [];
    let installmentsCache: Installment[] = [];
    let financialAuditLogsCache: FinancialAuditLog[] = [];
    const signedPatientImages = imagesRes.error ? [] : await signPatientFiles((imagesRes.data || []) as PatientImage[]);

    if (canViewFinance) {
      const [plansRes, paymentsRes, installmentsRes, auditLogsRes] = await Promise.all([
        supabase.from('treatment_plans').select('*, services(*)').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('payments').select('*, treatment_plans(*), installments(*)').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('installments').select('*, treatment_plans(*)').eq('clinic_id', staff.clinic_id).eq('patient_id', patientId).order('due_date', { ascending: true }),
        supabase.from('financial_audit_logs').select('*, staff_users(full_name,role)').eq('clinic_id', staff.clinic_id).order('created_at', { ascending: false }).limit(100)
      ]);
      plansCache = (plansRes.data || []) as TreatmentPlan[];
      paymentsCache = (paymentsRes.data || []) as Payment[];
      installmentsCache = (installmentsRes.data || []) as Installment[];
      financialAuditLogsCache = ((auditLogsRes.data || []) as FinancialAuditLog[]).filter((log) => log.entity_id === patientId || String((log.new_value as any)?.patient_id || '') === patientId || String((log.old_value as any)?.patient_id || '') === patientId);
      setPlans(plansCache);
      setPayments(paymentsCache);
      setInstallments(installmentsCache);
      setFinancialAuditLogs(financialAuditLogsCache);
    } else {
      setPlans([]);
      setPayments([]);
      setInstallments([]);
      setFinancialAuditLogs([]);
    }
    if (!imagesRes.error) setPatientImages(signedPatientImages);
    await setCache(cacheKey, {
      patient: patientRes.data as Patient | null,
      appointments: (appointmentsRes.data || []) as Appointment[],
      services: (servicesRes.data || []) as Service[],
      workingHours: (workingHoursRes.data || []) as WorkingHour[],
      visits: (visitsRes.data || []) as Visit[],
      patientImages: signedPatientImages,
      dentalChartRows: (dentalChartRes.data || []) as DentalChartRow[],
      plans: plansCache,
      payments: paymentsCache,
      installments: installmentsCache,
      financialAuditLogs: financialAuditLogsCache
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [staff?.clinic_id, patientId, staff?.role]);

  useEffect(() => {
    const onDataChanged = () => load();
    window.addEventListener('online', onDataChanged);
    window.addEventListener('dentalos-offline-data-changed', onDataChanged);
    return () => {
      window.removeEventListener('online', onDataChanged);
      window.removeEventListener('dentalos-offline-data-changed', onDataChanged);
    };
  }, [staff?.clinic_id, patientId, staff?.role]);

  const totals = useMemo(() => plans.reduce((acc, p) => {
    acc.final += Number(p.final_amount || 0);
    acc.paid += Number(p.paid_amount || 0);
    acc.remaining += Number(p.remaining_amount || 0);
    return acc;
  }, { final: 0, paid: 0, remaining: 0 }), [plans]);

  const allVisitTeeth = useMemo(() => visits.flatMap((visit) => visit.visit_teeth || []), [visits]);
  const latestVisit = visits[0] || null;
  const nextAppointment = appointments
    .filter((appointment) => appointment.appointment_date >= todayISO() && !['completed', 'cancelled', 'no_show'].includes(appointment.status))
    .sort((a, b) => `${a.appointment_date}T${a.appointment_time}`.localeCompare(`${b.appointment_date}T${b.appointment_time}`))[0] || null;

  const filteredAppointments = useMemo(() => {
    return appointments
      .filter((a) => !appointmentFilters.date || a.appointment_date === appointmentFilters.date)
      .filter((a) => !appointmentFilters.status || a.status === appointmentFilters.status)
      .filter((a) => !appointmentFilters.service_id || a.service_id === appointmentFilters.service_id)
      .sort((a, b) => {
        const aValue = `${a.appointment_date || ''}T${(a.appointment_time || '00:00').slice(0, 5)}`;
        const bValue = `${b.appointment_date || ''}T${(b.appointment_time || '00:00').slice(0, 5)}`;
        return appointmentFilters.sort === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      });
  }, [appointments, appointmentFilters]);

  const paymentInstallmentOptions = useMemo(() => {
    return installments
      .filter((installment) => installment.treatment_plan_id === paymentForm.treatment_plan_id && installment.status !== 'cancelled')
      .sort((a, b) => (a.installment_number || 9999) - (b.installment_number || 9999) || a.due_date.localeCompare(b.due_date));
  }, [installments, paymentForm.treatment_plan_id]);

  function handlePaymentPlanChange(planId: string) {
    setPaymentForm((current) => ({ ...current, treatment_plan_id: planId, installment_id: '' }));
  }

  function installmentStatusLabel(item: Installment) {
    if (item.status === 'paid') return 'مدفوع';
    if (item.status === 'partial') return 'جزئي';
    if (item.status === 'cancelled') return 'ملغى';
    return item.due_date < todayISO() ? 'متأخر' : 'بانتظار';
  }

  async function validatePatientAppointment() {
    if (!staff) return 'لم يتم تحميل بيانات المستخدم.';
    if (!patientId) return 'لم يتم تحديد المريض.';
    if (!appointmentForm.service_id) return 'اختر الخدمة.';
    const cost = Number(appointmentForm.treatment_cost);
    if (!Number.isFinite(cost) || cost < 0) return 'أدخل تكلفة صحيحة للخدمة.';
    if (!appointmentForm.appointment_date || !appointmentForm.appointment_time) return 'اختر تاريخ ووقت الموعد.';

    const selectedDateTime = new Date(`${appointmentForm.appointment_date}T${appointmentForm.appointment_time}:00`);
    if (Number.isNaN(selectedDateTime.getTime())) return 'تاريخ أو وقت الموعد غير صحيح.';
    if (selectedDateTime < new Date()) return 'لا يمكن إضافة موعد في وقت سابق.';

    const day = getDayOfWeek(appointmentForm.appointment_date);
    let row = workingHours.find((item) => item.day_of_week === day) || null;
    if (getOnlineStatus()) {
      const { data } = await supabase.from('clinic_working_hours').select('*').eq('clinic_id', staff.clinic_id).eq('day_of_week', day).maybeSingle();
      row = data as WorkingHour | null;
    }
    if (row && !row.is_open) return 'لا يمكن إضافة موعد في يوم مغلق حسب أوقات دوام العيادة.';
    const selectedService = services.find((service) => service.id === appointmentForm.service_id);
    const duration = Math.max(5, Number(selectedService?.duration_minutes || 30));
    const appointment = timeToMinutes(appointmentForm.appointment_time);
    const appointmentEnd = appointment + duration;

    if (row) {
      const start = timeToMinutes(row.start_time);
      const end = timeToMinutes(row.end_time);
      const breakStart = row.break_start ? timeToMinutes(row.break_start) : null;
      const breakEnd = row.break_end ? timeToMinutes(row.break_end) : null;
      if (appointment < start || appointmentEnd > end) return `لا يمكن إضافة موعد خارج أوقات الدوام. الدوام لهذا اليوم من ${row.start_time.slice(0, 5)} إلى ${row.end_time.slice(0, 5)}.`;
      if (breakStart !== null && breakEnd !== null && appointment < breakEnd && breakStart < appointmentEnd) return `لا يمكن إضافة موعد يتداخل مع وقت الاستراحة: ${row.break_start?.slice(0, 5)} - ${row.break_end?.slice(0, 5)}.`;
    }

    let sameDay: Array<{ appointment_time: string; services?: { duration_minutes?: number | null } | null }> = [];
    if (getOnlineStatus()) {
      const { data } = await supabase
        .from('appointments')
        .select('id, appointment_time, status, services(duration_minutes)')
        .eq('clinic_id', staff.clinic_id)
        .eq('appointment_date', appointmentForm.appointment_date)
        .not('status', 'in', '(cancelled,no_show)')
        .limit(240);
      sameDay = (data || []) as Array<{ appointment_time: string; services?: { duration_minutes?: number | null } | null }>;
    } else {
      sameDay = appointments
        .filter((item) => item.appointment_date === appointmentForm.appointment_date && !['cancelled', 'no_show'].includes(item.status))
        .map((item) => ({ appointment_time: item.appointment_time, services: { duration_minutes: item.services?.duration_minutes || 30 } }));
    }
    const conflict = sameDay.some((item) => {
      const existingStart = timeToMinutes(item.appointment_time);
      const existingEnd = existingStart + Math.max(5, Number(item.services?.duration_minutes || 30));
      return appointment < existingEnd && existingStart < appointmentEnd;
    });
    if (conflict) return 'يوجد موعد آخر يتداخل مع مدة هذه الخدمة.';
    return null;
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patientId) return;
    setSavingAppointment(true);
    const validationError = await validatePatientAppointment();
    if (validationError) {
      setSavingAppointment(false);
      showToast('لا يمكن إضافة الموعد', validationError, 'warning');
      return;
    }
    const selectedService = services.find((service) => service.id === appointmentForm.service_id) || null;
    const payload = {
      clinic_id: staff.clinic_id,
      patient_id: patientId,
      service_id: appointmentForm.service_id,
      treatment_cost: Number(appointmentForm.treatment_cost || 0),
      appointment_date: appointmentForm.appointment_date,
      appointment_time: appointmentForm.appointment_time,
      status: appointmentForm.status,
      notes: appointmentForm.notes || null
    };

    if (!getOnlineStatus()) {
      const localId = makeLocalId('appointment');
      const localAppointment = { id: localId, ...payload, patients: patient || undefined, services: selectedService || undefined } as Appointment;
      setAppointments((current) => [localAppointment, ...current]);
      await appendToCachedList<Appointment>(offlineKeys.appointments(staff.clinic_id), localAppointment);
      await queueOperation(staff.clinic_id, 'create_appointment', { ...payload, local_id: localId, patients: patient, services: selectedService });
      setSavingAppointment(false);
      showToast('تم حفظ الموعد مؤقتًا', 'سيتم حفظ الموعد على الخادم عند عودة الإنترنت بعد التحقق من تعارض المواعيد.', 'success');
      setOpenAppointment(false);
      setAppointmentForm({ service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
      return;
    }

    const { error } = await supabase.from('appointments').insert(payload);
    setSavingAppointment(false);
    if (error) {
      showToast('تعذر حفظ الموعد', error.message, 'error');
      return;
    }
    await supabase.from('patients').update({ status: 'active', archived_at: null }).eq('clinic_id', staff.clinic_id).eq('id', patientId);
    await logActivity(staff, 'appointment_created', 'appointment', null, null, { patient_id: patientId, appointment_date: appointmentForm.appointment_date, appointment_time: appointmentForm.appointment_time });
    setOpenAppointment(false);
    setAppointmentForm({ service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
    load();
  }

  async function updateAppointmentStatus(row: Appointment, nextStatus: string) {
    if (!getOnlineStatus()) {
      showToast('غير متاح بدون اتصال', 'تغيير حالة الموعد وإنهاء الجلسة من القائمة يحتاجان اتصالًا. يمكن حفظ ملاحظات الجلسة بدون اتصال من زر إنهاء الجلسة عند توفره.', 'warning');
      return;
    }
    const action = getAppointmentStatusActions(row.status).find((item) => item.status === nextStatus);
    if (!staff || !action) return;

    if (action.status === 'completed') {
      if (!canManageMedical) {
        showToast('صلاحية غير متاحة', 'إنهاء الجلسة الطبية وتحديث مخطط الأسنان متاح للطبيب فقط.', 'warning');
        setStatusMenuRow(null);
        return;
      }
      setStatusMenuRow(null);
      setCompletionRow(row);
      setCompletionForm({ procedure_done: '', doctor_notes: '' });
      setCompletionTeeth([]);
      setCompletionStep(1);
      return;
    }

    if (action.confirm) {
      const ok = await requestActionConfirmation(action.confirmTitle || 'تأكيد تغيير الحالة', action.confirmMessage || 'هل تريد تغيير حالة الموعد؟', action.confirmLabel || action.label);
      if (!ok) return;
    }

    const { error } = await supabase.from('appointments').update({ status: action.status }).eq('id', row.id).eq('clinic_id', staff.clinic_id);
    if (error) {
      showToast('تعذر تحديث الحالة', error.message, 'error');
      return;
    }

    setStatusMenuRow(null);
    await logActivity(staff, 'appointment_status_updated', 'appointment', row.id, { status: row.status }, { status: action.status });
    load();
  }

  async function submitAppointmentCompletion(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !completionRow || !patientId || !canManageMedical) return;
    if (!completionTeeth.length) {
      showToast('حدد الأسنان المعالجة', 'اختر سنًا واحدًا على الأقل من مخطط الأسنان قبل إنهاء الجلسة حتى يبقى السجل الطبي مرتبطًا بالأسنان.', 'warning');
      return;
    }
    const procedureSummary = completionForm.procedure_done.trim() || completionTeeth.map((item) => item.procedure_done.trim()).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join('، ');
    if (!procedureSummary) {
      setCompletionStep(2);
      showToast('الإجراء غير مكتمل', 'اكتب الإجراء المنفذ مرة واحدة على الأقل ليتم حفظ الجلسة.', 'warning');
      return;
    }
    const missingToothProcedure = completionTeeth.some((item) => !(item.procedure_done || procedureSummary).trim());
    if (missingToothProcedure) {
      setCompletionStep(2);
      showToast('إجراء السن غير مكتمل', 'اكتب الإجراء المنفذ لكل سن أو اكتب وصف الجلسة العام ليتم استخدامه تلقائيًا.', 'warning');
      return;
    }
    const missingToothNotes = completionTeeth.filter((item) => !item.notes.trim());
    if (missingToothNotes.length) {
      setCompletionStep(4);
      showToast('ملاحظات الأسنان غير مكتملة', 'يجب تعبئة ملاحظة لكل سن محدد قبل حفظ الجلسة.', 'warning');
      return;
    }
    const doctorNotes = completionForm.doctor_notes.trim();
    if (!doctorNotes) {
      setCompletionStep(4);
      showToast('الملاحظات العامة غير مكتملة', 'اكتب الملاحظات الطبية العامة للمريض قبل حفظ الجلسة.', 'warning');
      return;
    }
    const completionPayload = {
      clinicId: staff.clinic_id,
      patientId,
      appointmentId: completionRow.id,
      serviceId: completionRow.service_id,
      visitDate: completionRow.appointment_date,
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
    };

    setSavingCompletion(true);
    if (!getOnlineStatus()) {
      const localVisit = {
        id: makeLocalId('visit'),
        clinic_id: staff.clinic_id,
        patient_id: patientId,
        appointment_id: completionRow.id,
        service_id: completionRow.service_id || null,
        visit_date: completionRow.appointment_date,
        procedure_done: procedureSummary,
        doctor_notes: doctorNotes,
        services: completionRow.services,
        visit_teeth: completionPayload.teeth.map((tooth) => ({
          id: makeLocalId('tooth'),
          clinic_id: staff.clinic_id,
          patient_id: patientId,
          visit_id: 'pending',
          tooth_number: tooth.toothNumber,
          procedure_done: tooth.procedureDone,
          old_status: tooth.oldStatus,
          new_status: tooth.newStatus,
          notes: tooth.notes,
          created_by: staff.id,
          created_at: new Date().toISOString()
        }))
      } as Visit;
      setVisits((current) => [localVisit, ...current]);
      setDentalChartRows((current) => {
        const map = new Map(current.map((row) => [row.tooth_number, row]));
        completionPayload.teeth.forEach((tooth) => {
          map.set(tooth.toothNumber, {
            id: makeLocalId('chart'),
            clinic_id: staff.clinic_id,
            patient_id: patientId,
            tooth_number: tooth.toothNumber,
            status: tooth.newStatus,
            procedure_name: tooth.procedureDone,
            notes: tooth.notes,
            updated_by: staff.id,
            updated_at: new Date().toISOString()
          } as DentalChartRow);
        });
        return Array.from(map.values()).sort((a, b) => a.tooth_number.localeCompare(b.tooth_number));
      });
      setAppointments((current) => current.map((item) => item.id === completionRow.id ? { ...item, status: 'completed' } : item));
      await queueOperation(staff.clinic_id, 'complete_appointment', completionPayload);
      setSavingCompletion(false);
      showToast('تم حفظ إنهاء الجلسة مؤقتًا', 'سيتم تحديث السجل الطبي ومخطط الأسنان على الخادم عند عودة الإنترنت.', 'success');
      setCompletionRow(null);
      setCompletionForm({ procedure_done: '', doctor_notes: '' });
      setCompletionTeeth([]);
      setCompletionStep(1);
      return;
    }

    const result = await completeAppointmentWithVisit(completionPayload);
    setSavingCompletion(false);

    if (result.error) {
      showToast('تعذر إنهاء الموعد', result.error, 'error');
      return;
    }

    await logActivity(staff, 'appointment_completed', 'appointment', completionRow.id, null, { procedure_done: procedureSummary, teeth: completionTeeth.map((item) => item.tooth_number) });
    setCompletionRow(null);
    setCompletionForm({ procedure_done: '', doctor_notes: '' });
    setCompletionTeeth([]);
    setCompletionStep(1);
    load();
  }

  function toggleCompletionTooth(toothNumber: string) {
    setCompletionTeeth((current) => {
      const exists = current.some((item) => item.tooth_number === toothNumber);
      if (exists) return current.filter((item) => item.tooth_number !== toothNumber);
      const chartRow = dentalChartRows.find((row) => row.tooth_number === toothNumber);
      const serviceName = completionRow?.services?.name || '';
      return [...current, {
        tooth_number: toothNumber,
        old_status: chartRow?.status || null,
        new_status: chartRow?.status || 'healthy',
        procedure_done: serviceName || completionForm.procedure_done || '',
        notes: ''
      }].sort((a, b) => a.tooth_number.localeCompare(b.tooth_number));
    });
  }

  function updateCompletionTooth(toothNumber: string, patch: Partial<CompletionToothForm>) {
    setCompletionTeeth((current) => current.map((item) => item.tooth_number === toothNumber ? { ...item, ...patch } : item));
  }

  function applyProcedureToAllCompletionTeeth(value: string) {
    setCompletionForm((current) => ({ ...current, procedure_done: value }));
    setCompletionTeeth((current) => current.map((item) => ({ ...item, procedure_done: value })));
  }

  function applyStatusToAllCompletionTeeth(value: string) {
    setCompletionTeeth((current) => current.map((item) => ({ ...item, new_status: value })));
  }

  function openEditVisit(visit: Visit) {
    setEditingVisit(visit);
    setVisitEditForm({ procedure_done: visit.procedure_done || '', doctor_notes: visit.doctor_notes || '' });
  }

  function closeVisitEdit() {
    if (savingVisitEdit) return;
    setEditingVisit(null);
    setVisitEditForm({ procedure_done: '', doctor_notes: '' });
  }

  async function updateVisitNotes(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !editingVisit || !canManageMedical) return;
    const procedureDone = visitEditForm.procedure_done.trim();
    const doctorNotes = visitEditForm.doctor_notes.trim();
    if (!procedureDone || !doctorNotes) {
      showToast('بيانات غير مكتملة', 'أدخل ما تم إجراؤه والملاحظات الطبية الخاصة بهذه الجلسة.', 'warning');
      return;
    }

    setSavingVisitEdit(true);
    const { error } = await supabase.from('visits').update({ procedure_done: procedureDone, doctor_notes: doctorNotes }).eq('clinic_id', staff.clinic_id).eq('id', editingVisit.id);
    setSavingVisitEdit(false);

    if (error) {
      showToast('تعذر حفظ التعديل', error.message, 'error');
      return;
    }

    await logActivity(staff, 'visit_notes_updated', 'visit', editingVisit.id, null, { procedure_done: procedureDone });
    closeVisitEdit();
    load();
  }

  function selectPlanService(serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    setPlanForm((current) => ({ ...current, service_id: serviceId, title: service ? service.name : '', total_amount: service ? String(service.price || 0) : current.total_amount }));
  }

  function selectAppointmentService(serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    setAppointmentForm((current) => ({ ...current, service_id: serviceId, treatment_cost: service ? String(service.price || 0) : '' }));
  }

  function openCreatePlan() {
    setEditingPlan(null);
    setPlanForm({ service_id: '', title: '', total_amount: '0', discount_amount: '0', status: 'active', notes: '' });
    setOpenPlan(true);
  }

  function openEditPlan(plan: TreatmentPlan) {
    setEditingPlan(plan);
    setPlanForm({
      service_id: plan.service_id || '',
      title: plan.title || plan.services?.name || '',
      total_amount: String(plan.total_amount ?? plan.final_amount ?? 0),
      discount_amount: String(plan.discount_amount ?? 0),
      status: plan.status || 'active',
      notes: plan.notes || ''
    });
    setOpenPlan(true);
  }

  function closePlanModal() {
    setOpenPlan(false);
    setEditingPlan(null);
    setPlanForm({ service_id: '', title: '', total_amount: '0', discount_amount: '0', status: 'active', notes: '' });
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patientId || !canViewFinance) return;
    if (!planForm.service_id) {
      showToast('بيانات غير مكتملة', 'اختر الخدمة أولاً.', 'warning');
      return;
    }
    const total = Number(planForm.total_amount || 0);
    const discount = Number(planForm.discount_amount || 0);
    const finalAmount = Math.max(total - discount, 0);
    const service = services.find((s) => s.id === planForm.service_id);
    const payload = {
      clinic_id: staff.clinic_id,
      patient_id: patientId,
      service_id: planForm.service_id,
      title: service?.name || planForm.title || 'خطة علاج',
      dental_category: service?.category || null,
      total_amount: total,
      discount_amount: discount,
      final_amount: finalAmount,
      remaining_amount: Math.max(finalAmount - Number(editingPlan?.paid_amount || 0), 0),
      status: planForm.status,
      notes: planForm.notes || null
    };
    if (editingPlan) {
      const passwordOk = await requestPasswordConfirmation('تعديل خطة علاج');
      if (!passwordOk) return;
    }

    const request = editingPlan
      ? supabase.from('treatment_plans').update(payload).eq('clinic_id', staff.clinic_id).eq('id', editingPlan.id)
      : supabase.from('treatment_plans').insert({ ...payload, paid_amount: 0 });
    const { error } = await request;
    if (error) {
      showToast('تعذر حفظ خطة العلاج', error.message, 'error');
      return;
    }
    await logActivity(staff, editingPlan ? 'treatment_plan_updated' : 'treatment_plan_created', 'treatment_plan', editingPlan?.id || null, null, payload);
    closePlanModal();
    load();
  }

  async function deletePlan(plan: TreatmentPlan) {
    if (!staff || !canViewFinance) return;
    const check = await canDeleteTreatmentPlanSafely(staff.clinic_id, plan);
    if (!check.ok) {
      await showSecureMessage('لا يمكن حذف خطة العلاج', check.message);
      return;
    }
    const ok = await requestActionConfirmation('تأكيد حذف خطة العلاج', `تم التحقق من اكتمال المواعيد والملف المالي المرتبط بالخطة "${plan.title}". هل تريد حذفها؟`, 'حذف الخطة');
    if (!ok) return;
    const passwordOk = await requestPasswordConfirmation('حذف خطة علاج');
    if (!passwordOk) return;
    const { error } = await supabase.from('treatment_plans').delete().eq('clinic_id', staff.clinic_id).eq('id', plan.id);
    if (error) {
      showToast('تعذر حذف الخطة', error.message, 'error');
      return;
    }
    await logActivity(staff, 'treatment_plan_deleted', 'treatment_plan', plan.id, { title: plan.title }, null);
    load();
  }

  function openEditMedicalNotes() {
    if (!patient) return;
    setMedicalNotesDraft(patient.medical_notes || '');
    setOpenMedicalNotesEdit(true);
  }

  async function updateGeneralMedicalNotes(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patient || !canManageMedical) {
      showToast('صلاحية غير متاحة', 'تعديل الملاحظات الطبية متاح للطبيب فقط.', 'warning');
      return;
    }
    setSavingMedicalNotes(true);
    if (!getOnlineStatus()) {
      const nextNotes = medicalNotesDraft.trim() || null;
      setPatient((current) => current ? { ...current, medical_notes: nextNotes } : current);
      await queueOperation(staff.clinic_id, 'update_patient_medical_notes', { clinic_id: staff.clinic_id, patient_id: patient.id, medical_notes: nextNotes });
      setSavingMedicalNotes(false);
      setOpenMedicalNotesEdit(false);
      showToast('تم حفظ الملاحظات مؤقتًا', 'سيتم تحديث ملف المريض على الخادم عند عودة الإنترنت.', 'success');
      return;
    }
    const { error } = await supabase.from('patients').update({ medical_notes: medicalNotesDraft.trim() || null }).eq('clinic_id', staff.clinic_id).eq('id', patient.id);
    setSavingMedicalNotes(false);
    if (error) {
      showToast('تعذر حفظ الملاحظات', error.message, 'error');
      return;
    }
    await logActivity(staff, 'patient_medical_notes_updated', 'patient', patient.id, { medical_notes: patient.medical_notes }, { medical_notes: medicalNotesDraft.trim() || null });
    setOpenMedicalNotesEdit(false);
    load();
  }

  function openEditPatient() {
    if (!patient) return;
    setPatientForm({ full_name: patient.full_name || '', phone: patient.phone || '', address: patient.address || '', medical_notes: patient.medical_notes || '' });
    setOpenPatientEdit(true);
  }

  async function updatePatient(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patient) return;
    const payload = {
      full_name: patientForm.full_name.trim(),
      phone: patientForm.phone.trim(),
      address: patientForm.address.trim() || null,
      medical_notes: patientForm.medical_notes.trim() || null
    };
    const { error } = await supabase.from('patients').update(payload).eq('clinic_id', staff.clinic_id).eq('id', patient.id);
    if (error) {
      showToast('تعذر حفظ بيانات المريض', error.message, 'error');
      return;
    }
    await logActivity(staff, 'patient_updated', 'patient', patient.id, { full_name: patient.full_name, phone: patient.phone }, payload);
    setOpenPatientEdit(false);
    load();
  }

  async function deletePatient() {
    if (!staff || !patient) return;
    const financialCheck = await canDeletePatientFinancially(staff.clinic_id, patient.id);
    if (!financialCheck.ok) {
      await showSecureMessage('لا يمكن حذف المريض', financialCheck.message);
      return;
    }
    const ok = await requestActionConfirmation('تأكيد حذف المريض', `تم التحقق من اكتمال المواعيد والملف المالي للمريض "${patient.full_name}". هل تريد حذفه نهائياً؟`, 'حذف المريض');
    if (!ok) return;
    const passwordOk = await requestPasswordConfirmation('حذف مريض');
    if (!passwordOk) return;
    const { error } = await supabase.from('patients').delete().eq('clinic_id', staff.clinic_id).eq('id', patient.id);
    if (error) {
      showToast('تعذر حذف المريض', error.message, 'error');
      return;
    }
    await logActivity(staff, 'patient_deleted', 'patient', patient.id, { full_name: patient.full_name }, null);
    router.replace('/patients');
  }

  async function archivePatient() {
    if (!staff || !patient) return;
    const ok = await requestActionConfirmation('تأكيد أرشفة ملف المريض', `سيتم أرشفة ملف "${patient.full_name}" وإيقاف جميع المواعيد المفتوحة وخطط العلاج النشطة المرتبطة به.`, 'أرشفة الملف');
    if (!ok) return;
    const passwordOk = await requestPasswordConfirmation('أرشفة ملف مريض');
    if (!passwordOk) return;
    const now = new Date().toISOString();
    const patientUpdate = await supabase.from('patients').update({ status: 'archived', archived_at: now }).eq('clinic_id', staff.clinic_id).eq('id', patient.id);
    if (patientUpdate.error) {
      showToast('تعذر أرشفة الملف', 'تأكد من تشغيل ملف SQL الخاص بالأرشفة داخل Supabase ثم أعد المحاولة.', 'error');
      return;
    }
    await Promise.all([
      supabase.from('appointments').update({ status: 'cancelled' }).eq('clinic_id', staff.clinic_id).eq('patient_id', patient.id).in('status', ['pending', 'confirmed', 'arrived']),
      supabase.from('treatment_plans').update({ status: 'paused' }).eq('clinic_id', staff.clinic_id).eq('patient_id', patient.id).eq('status', 'active')
    ]);
    await logActivity(staff, 'patient_archived', 'patient', patient.id, { status: patient.status }, { status: 'archived' });
    load();
  }

  async function unarchivePatient() {
    if (!staff || !patient) return;
    const ok = await requestActionConfirmation('إزالة المريض من الأرشيف', `سيعود ملف "${patient.full_name}" إلى حالة النشاط.`, 'إزالة من الأرشيف');
    if (!ok) return;
    const { error } = await supabase.from('patients').update({ status: 'active', archived_at: null }).eq('clinic_id', staff.clinic_id).eq('id', patient.id);
    if (error) {
      showToast('تعذر إزالة الأرشفة', error.message, 'error');
      return;
    }
    await logActivity(staff, 'patient_unarchived', 'patient', patient.id, { status: patient.status }, { status: 'active' });
    load();
  }

  async function savePatientImage(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patient || !imageFile) return;
    if (patientImages.length >= MAX_PATIENT_ATTACHMENTS) {
      showToast('لا يمكن إضافة ملف جديد', 'الحد الأقصى هو 10 عناصر داخل ملف المريض، ويشمل الصور والملفات معاً.', 'warning');
      return;
    }
    if (!isSupportedPatientAttachment(imageFile)) {
      showToast('ملف غير مدعوم', 'يمكن إضافة الصور أو ملفات PDF أو Word أو TXT فقط.', 'warning');
      return;
    }
    if (imageFile.size > MAX_PATIENT_ATTACHMENT_SIZE) {
      showToast('حجم الملف كبير', 'اختر ملفاً أصغر من 10MB للحفاظ على سرعة النظام.', 'warning');
      return;
    }

    setSavingImage(true);
    const safeName = sanitizeFileName(imageFile.name || 'patient-file');
    const storagePath = `${staff.clinic_id}/${patient.id}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage.from('patient-files').upload(storagePath, imageFile, { contentType: imageFile.type || 'application/octet-stream', upsert: false });

    if (upload.error) {
      setSavingImage(false);
      showToast('تعذر رفع الملف', 'تأكد من تشغيل supabase/professional_dashboard_upgrade.sql ومن إنشاء bucket patient-files.', 'error');
      return;
    }

    const { error } = await supabase.from('patient_images').insert({
      clinic_id: staff.clinic_id,
      patient_id: patient.id,
      image_data: storagePath,
      storage_path: storagePath,
      file_name: imageFile.name,
      file_type: imageFile.type || 'application/octet-stream',
      file_size: imageFile.size,
      description: imageDescription.trim() || null
    });
    setSavingImage(false);

    if (error) {
      await supabase.storage.from('patient-files').remove([storagePath]);
      showToast('تعذر حفظ الملف', 'تأكد من تشغيل ملف SQL الخاص بدعم ملفات المرضى داخل Supabase.', 'error');
      return;
    }

    await logActivity(staff, 'patient_file_uploaded', 'patient', patient.id, null, { file_name: imageFile.name });
    setOpenImageModal(false);
    setImageFile(null);
    setImageDescription('');
    load();
  }

  async function deletePatientImage(image: PatientImage) {
    if (!staff || !canDeleteFiles) return;
    const ok = await requestActionConfirmation('حذف ملف من ملف المريض', 'هل تريد حذف هذا الملف من ملف المريض؟', 'حذف الملف');
    if (!ok) return;
    const storagePath = image.storage_path || (!image.image_data.startsWith('data:') && !image.image_data.startsWith('http') ? image.image_data : '');
    if (storagePath) await supabase.storage.from('patient-files').remove([storagePath]);
    const { error } = await supabase.from('patient_images').delete().eq('clinic_id', staff.clinic_id).eq('id', image.id);
    if (error) {
      showToast('تعذر حذف الملف', error.message, 'error');
      return;
    }
    await logActivity(staff, 'patient_file_deleted', 'patient_file', image.id, { file_name: image.file_name }, null);
    load();
  }

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patientId || !canViewFinance) return;
    if (!getOnlineStatus()) {
      showToast('الدفعات غير متاحة بدون اتصال', 'تسجيل الدفعات عملية مالية حساسة وتحتاج اتصالًا مباشرًا بالخادم.', 'warning');
      return;
    }
    if (!paymentForm.treatment_plan_id) {
      showToast('بيانات غير مكتملة', 'يجب تحديد خطة العلاج قبل حفظ الدفعة.', 'warning');
      return;
    }
    const { error } = await supabase.from('payments').insert({
      clinic_id: staff.clinic_id,
      patient_id: patientId,
      treatment_plan_id: paymentForm.treatment_plan_id,
      installment_id: paymentForm.installment_id || null,
      amount: Number(paymentForm.amount || 0),
      payment_method: paymentForm.payment_method,
      payment_type: paymentForm.payment_type,
      payment_date: todayISO(),
      receipt_number: `RC-${todayISO().replaceAll('-', '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      created_by: staff.id,
      notes: paymentForm.notes || null
    });
    if (error) {
      showToast('تعذر حفظ الدفعة', error.message, 'error');
      return;
    }
    await logActivity(staff, 'payment_created', 'payment', null, null, { patient_id: patientId, amount: paymentForm.amount });
    setOpenPayment(false);
    setPaymentForm({ treatment_plan_id: '', installment_id: '', amount: '', payment_method: 'cash', payment_type: 'installment', notes: '' });
    load();
  }

  function printReceipt(payment: Payment) {
    if (!patient) return;
    printPaymentReceipt({
      clinic,
      staff,
      patient,
      payment,
      plan: plans.find((plan) => plan.id === payment.treatment_plan_id) || payment.treatment_plans || null,
      installment: installments.find((item) => item.id === payment.installment_id) || payment.installments || null
    });
  }

  async function deletePayment(payment: Payment) {
    if (!staff || !canViewFinance) return;
    if (!getOnlineStatus()) {
      showToast('الحذف غير متاح بدون اتصال', 'حذف الدفعات يحتاج اتصالًا مباشرًا بالخادم.', 'warning');
      return;
    }
    const ok = await requestActionConfirmation('حذف دفعة مالية', `سيتم حذف دفعة بقيمة ${formatMoney(payment.amount, currencySymbol)} وإعادة حساب الخطة والقسط تلقائياً.`, 'حذف الدفعة');
    if (!ok) return;
    const passwordOk = await requestPasswordConfirmation('حذف دفعة مالية');
    if (!passwordOk) return;
    const { error } = await supabase.from('payments').delete().eq('clinic_id', staff.clinic_id).eq('id', payment.id);
    if (error) {
      showToast('تعذر حذف الدفعة', error.message, 'error');
      return;
    }
    await logActivity(staff, 'payment_deleted', 'payment', payment.id, payment as unknown as Record<string, unknown>, null);
    load();
  }

  async function createInstallment(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !patientId || !canViewFinance) return;
    if (!getOnlineStatus()) {
      showToast('الأقساط غير متاحة بدون اتصال', 'إضافة الأقساط تحتاج اتصالًا مباشرًا بالخادم حتى لا يحدث تضارب مالي.', 'warning');
      return;
    }
    if (!installmentForm.treatment_plan_id) {
      showToast('بيانات غير مكتملة', 'يجب تحديد خطة العلاج قبل حفظ القسط.', 'warning');
      return;
    }
    const amount = Number(installmentForm.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('قيمة غير صحيحة', 'أدخل قيمة قسط صحيحة.', 'warning');
      return;
    }
    const { error } = await supabase.from('installments').insert({
      clinic_id: staff.clinic_id,
      patient_id: patientId,
      treatment_plan_id: installmentForm.treatment_plan_id,
      due_date: installmentForm.due_date,
      amount,
      notes: installmentForm.notes || null,
      created_by: staff.id
    });
    if (error) {
      showToast('تعذر حفظ القسط', error.message, 'error');
      return;
    }
    await logActivity(staff, 'installment_created', 'installment', null, null, { patient_id: patientId, amount, due_date: installmentForm.due_date });
    await logFinancialAudit(staff, 'installment_created', 'installment', null, null, { patient_id: patientId, amount, due_date: installmentForm.due_date, treatment_plan_id: installmentForm.treatment_plan_id });
    setOpenInstallment(false);
    setInstallmentForm({ treatment_plan_id: '', due_date: todayISO(), amount: '', notes: '' });
    load();
  }


  function printPatientFile() {
    window.print();
  }

  if (!patientId) return <AccessDenied title="لم يتم اختيار مريض" description="افتح ملف المريض من صفحة المرضى أو من جدول المواعيد." />;
  if (loading) return <div className="grid gap-4"><SkeletonCard lines={4} /><SkeletonCard lines={5} /></div>;
  if (!patient) return <AccessDenied title="المريض غير موجود" description="تأكد أن المريض تابع لنفس العيادة وأن الرابط صحيح." />;

  const tabItems: Array<{ id: PatientProfileTab; label: string; count?: number; roles?: 'finance' }> = [
    { id: 'overview', label: 'ملخص' },
    { id: 'visits', label: 'الجلسات', count: visits.length },
    { id: 'dental', label: 'الأسنان', count: dentalChartRows.length },
    { id: 'finance', label: 'الخطة والمالية', count: plans.length + payments.length + installments.length, roles: 'finance' },
    { id: 'appointments', label: 'المواعيد', count: appointments.length },
    { id: 'files', label: 'الملفات', count: patientImages.length },
    { id: 'notes', label: 'ملاحظات' }
  ];
  const tabs = tabItems.filter((tab) => tab.roles !== 'finance' || canViewFinance);

  return (
    <div className="space-y-6 patient-profile-modern">
      <PatientHeader
        patient={patient}
        canViewFinance={canViewFinance}
        onPrint={printPatientFile}
        onAddAppointment={() => setOpenAppointment(true)}
        onEditPatient={openEditPatient}
        onArchive={archivePatient}
        onUnarchive={unarchivePatient}
        onCreatePlan={openCreatePlan}
        onDelete={deletePatient}
      />

      {(patient.status || 'active') === 'archived' ? (
        <section className="rounded-3xl border border-warning/25 bg-warning/10 p-5 text-right">
          <p className="font-black text-warning">هذا الملف مؤرشف حالياً.</p>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-600">البيانات الطبية والمالية محفوظة، ويمكن إعادة تنشيط الملف من زر إزالة الأرشفة أو تلقائياً عند إضافة موعد جديد للمريض.</p>
        </section>
      ) : null}

      <div className="profile-tabs-bar">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={`profile-tab-btn ${activeTab === tab.id ? 'is-active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            <span>{tab.label}</span>
            {typeof tab.count === 'number' ? <span className="profile-tab-count number-ltr">{tab.count}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <PatientOverviewTab
          nextAppointment={nextAppointment}
          latestVisit={latestVisit}
          patientImages={patientImages}
          maxAttachments={MAX_PATIENT_ATTACHMENTS}
          canViewFinance={canViewFinance}
          remainingAmount={totals.remaining}
          currencySymbol={currencySymbol}
          medicalNotes={patient.medical_notes}
          onEditMedicalNotes={openEditMedicalNotes}
        />
      ) : null}

      {activeTab === 'dental' ? (
        <PatientDentalChart staff={staff} patientId={patient.id} rows={dentalChartRows} visitTeeth={allVisitTeeth} canEdit={canManageMedical} onReload={load} />
      ) : null}

      {activeTab === 'appointments' ? (
        <section className="premium-card profile-appointments-section">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">مواعيد المريض</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">فلترة وتغيير الحالة وإعادة المتابعة من مكان واحد.</p>
            </div>
            <button className="premium-btn px-4 py-2.5 text-sm" onClick={() => setOpenAppointment(true)}><Icon name="plus" className="h-4 w-4" /> إضافة موعد</button>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <FilterDate value={appointmentFilters.date} onChange={(value) => setAppointmentFilters({ ...appointmentFilters, date: value })} />
            <label><span className="mb-2 block text-xs font-black text-slate-500">الحالة</span><select className="soft-input" value={appointmentFilters.status} onChange={(e) => setAppointmentFilters({ ...appointmentFilters, status: e.target.value })}><option value="">كل الحالات</option>{appointmentStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
            <label><span className="mb-2 block text-xs font-black text-slate-500">الخدمة</span><select className="soft-input" value={appointmentFilters.service_id} onChange={(e) => setAppointmentFilters({ ...appointmentFilters, service_id: e.target.value })}><option value="">كل الخدمات</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <label><span className="mb-2 block text-xs font-black text-slate-500">ترتيب العرض</span><select className="soft-input" value={appointmentFilters.sort} onChange={(e) => setAppointmentFilters({ ...appointmentFilters, sort: e.target.value })}><option value="desc">الأحدث إلى الأقدم</option><option value="asc">الأقدم إلى الأحدث</option></select></label>
          </div>
          <div className="data-table-card">
            <table className="data-table profile-table">
              <thead><tr><th>التاريخ</th><th>الوقت</th><th>الخدمة</th><th>التكلفة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredAppointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td><span className="number-ltr">{formatDate(appointment.appointment_date)}</span></td>
                    <td><span className="number-ltr">{appointment.appointment_time?.slice(0, 5)}</span></td>
                    <td>{appointment.services?.name || '—'}</td>
                    <td className="number-ltr">{canViewFinance ? formatMoney(Number(appointment.treatment_cost || appointment.services?.price || 0), currencySymbol) : '—'}</td>
                    <td>{getAppointmentStatusActions(appointment.status).length ? <button type="button" className="status-picker-button" onClick={() => setStatusMenuRow(appointment)}><StatusBadge tone={appointmentStatusTone(appointment.status)}>{statusLabels[appointment.status]}</StatusBadge></button> : <StatusBadge tone={appointmentStatusTone(appointment.status)}>{statusLabels[appointment.status]}</StatusBadge>}</td>
                    <td><button type="button" className="outline-btn table-action-btn" onClick={() => setStatusMenuRow(appointment)}>تغيير الحالة</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredAppointments.length ? <EmptyState title="لا توجد مواعيد مطابقة" description="غيّر الفلاتر أو أضف موعداً جديداً لهذا المريض." action={<button className="premium-btn" onClick={() => setOpenAppointment(true)}>إضافة موعد</button>} /> : null}
          </div>
        </section>
      ) : null}

      {activeTab === 'visits' ? (
        <section className="premium-card">
          <h2 className="mb-4 text-2xl font-black">سجل جلسات العلاج</h2>
          {visits.length ? <div className="space-y-3">{visits.map((visit) => <VisitCard key={visit.id} visit={visit} canEdit={canManageMedical} onEdit={openEditVisit} />)}</div> : <EmptyState title="لا توجد جلسات علاج مكتملة" description="عند إنهاء الموعد ستظهر ملخصات الجلسات والملاحظات الطبية هنا." />}
        </section>
      ) : null}

      {activeTab === 'files' ? (
        <section className="premium-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">صور وملفات المريض</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">يمكن إضافة حتى 10 عناصر إجمالاً، ويشمل ذلك الصور وملفات PDF وWord وTXT.</p>
            </div>
            <button className="outline-btn" onClick={() => setOpenImageModal(true)} disabled={!imageFeatureAvailable || patientImages.length >= MAX_PATIENT_ATTACHMENTS}><Icon name="upload" /> إضافة صورة أو ملف</button>
          </div>
          {!imageFeatureAvailable ? <div className="rounded-2xl border border-warning/25 bg-warning/10 p-4 text-sm font-bold leading-7 text-slate-600">شغّل ملف SQL الخاص بدعم صور وملفات المرضى لتفعيل هذا القسم.</div> : patientImages.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{patientImages.map((image) => <AttachmentCard key={image.id} image={image} canDelete={canDeleteFiles} onDelete={deletePatientImage} />)}</div>
          ) : <EmptyState title="لا توجد صور أو ملفات" description="أضف الصور الشعاعية أو ملفات PDF أو Word أو TXT من زر إضافة صورة أو ملف." />}
        </section>
      ) : null}

      {activeTab === 'finance' && canViewFinance ? (
        <div className="grid gap-6 profile-finance-tables">
          <section className="premium-card">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">الخطة والمالية</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">يعرض هذا القسم الملخص أولاً، ويمكن فتح التفاصيل عند الحاجة فقط.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="premium-btn px-4 py-2.5 text-sm" onClick={() => setOpenPayment(true)}>تسجيل دفعة</button>
                <button className="outline-btn px-4 py-2.5 text-sm" onClick={openCreatePlan}>إضافة خطة</button>
                <button className="outline-btn px-4 py-2.5 text-sm" onClick={() => setShowFinanceDetails((value) => !value)}>{showFinanceDetails ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <SummaryBox label="إجمالي العلاج" value={formatMoney(totals.final, currencySymbol)} />
              <SummaryBox label="المدفوع" value={formatMoney(totals.paid, currencySymbol)} success />
              <SummaryBox label="المتبقي" value={formatMoney(totals.remaining, currencySymbol)} danger={totals.remaining > 0} />
            </div>
            <p className="mt-4 rounded-2xl border border-border bg-muted/40 p-4 text-sm font-bold leading-7 text-slate-600">
              الاستخدام اليومي البسيط: أضف خطة علاج، ثم سجل الدفعات. أما الأقساط وسجل العمليات والإيصالات فتظهر عند الضغط على عرض التفاصيل.
            </p>
          </section>

          {showFinanceDetails ? (
            <>
              <section className="premium-card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">خطط العلاج</h2><button className="outline-btn px-4 py-2.5 text-sm" onClick={openCreatePlan}>إضافة خطة علاج</button></div>
                <div className="data-table-card"><table className="data-table profile-table"><thead><tr><th>الخطة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td className="font-black">{plan.title}</td><td className="number-ltr">{formatMoney(plan.final_amount, currencySymbol)}</td><td className="number-ltr text-success">{formatMoney(plan.paid_amount, currencySymbol)}</td><td className="number-ltr text-danger">{formatMoney(plan.remaining_amount, currencySymbol)}</td><td><StatusBadge tone={plan.status === 'completed' ? 'success' : plan.status === 'paused' ? 'warning' : 'primary'}>{planStatusLabels[plan.status]}</StatusBadge></td><td><div className="table-actions-row"><button className="outline-btn table-action-btn" onClick={() => openEditPlan(plan)}>تعديل</button><button className="ghost-btn table-action-btn text-danger" onClick={() => deletePlan(plan)}>حذف</button></div></td></tr>)}</tbody></table>{!plans.length ? <EmptyState title="لا توجد خطط علاج" description="أضف خطة علاج ليظهر إجمالي المبالغ والأقساط للمريض." /> : null}</div>
              </section>
              <section className="premium-card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">الأقساط</h2><button className="outline-btn px-4 py-2.5 text-sm" onClick={() => setOpenInstallment(true)}>إضافة قسط</button></div>
                <div className="data-table-card"><table className="data-table profile-table"><thead><tr><th>رقم القسط</th><th>تاريخ الاستحقاق</th><th>الخطة</th><th>قيمة القسط</th><th>المدفوع تلقائيًا</th><th>المتبقي</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>{installments.map((item) => { const remaining = Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0)); return <tr key={item.id}><td className="font-black number-ltr">{item.installment_number || '—'}</td><td className="number-ltr">{formatDate(item.due_date)}</td><td>{item.treatment_plans?.title || '—'}</td><td className="number-ltr">{formatMoney(item.amount, currencySymbol)}</td><td className="number-ltr text-success">{formatMoney(item.paid_amount, currencySymbol)}</td><td className="number-ltr text-danger">{formatMoney(remaining, currencySymbol)}</td><td><StatusBadge tone={item.status === 'paid' ? 'success' : item.status === 'partial' ? 'warning' : item.due_date < todayISO() ? 'danger' : 'primary'}>{installmentStatusLabel(item)}</StatusBadge></td><td>{item.notes || '—'}</td></tr>; })}</tbody></table>{!installments.length ? <EmptyState title="لا توجد أقساط" description="أضف تاريخ الاستحقاق وقيمة القسط فقط، وسيتم حساب المدفوع والحالة تلقائيًا من الدفعات." /> : null}</div>
              </section>
              <section className="premium-card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">الدفعات والإيصالات</h2><button className="outline-btn px-4 py-2.5 text-sm" onClick={() => setOpenPayment(true)}>إضافة دفعة</button></div>
                <div className="data-table-card"><table className="data-table profile-table"><thead><tr><th>رقم الإيصال</th><th>التاريخ</th><th>الخطة</th><th>القسط المرتبط</th><th>المبلغ</th><th>طريقة الدفع</th><th>نوع الدفع</th><th>الإجراءات</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td className="number-ltr font-black">{payment.receipt_number || receiptNumber(payment)}</td><td className="number-ltr">{formatDate(payment.payment_date)}</td><td>{payment.treatment_plans?.title || '—'}</td><td>{getInstallmentLabel(payment.installments)}</td><td className="number-ltr text-success">{formatMoney(payment.amount, currencySymbol)}</td><td>{paymentMethodText[payment.payment_method] || payment.payment_method}</td><td>{paymentTypeText[payment.payment_type] || payment.payment_type}</td><td><div className="table-actions-row"><button className="outline-btn table-action-btn" onClick={() => printReceipt(payment)}>إيصال PDF</button><button className="ghost-btn table-action-btn text-danger" onClick={() => deletePayment(payment)}>حذف</button></div></td></tr>)}</tbody></table>{!payments.length ? <EmptyState title="لا توجد دفعات" description="ستظهر الدفعات والإيصالات هنا بعد إضافتها." /> : null}</div>
              </section>
              <section className="premium-card advanced-only-section">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">سجل العمليات المالية</h2><span className="rounded-full border border-border bg-white px-4 py-2 text-xs font-black text-slate-500">آخر {financialAuditLogs.length} عملية</span></div>
                <div className="data-table-card"><table className="data-table profile-table"><thead><tr><th>التاريخ</th><th>المستخدم</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead><tbody>{financialAuditLogs.map((log) => <tr key={log.id}><td className="number-ltr">{formatDate(log.created_at)}</td><td>{log.staff_users?.full_name || '—'}</td><td className="font-black">{log.action}</td><td>{log.entity_type}</td><td className="text-xs text-slate-500">{JSON.stringify(log.new_value || log.old_value || {}).slice(0, 90)}</td></tr>)}</tbody></table>{!financialAuditLogs.length ? <EmptyState title="لا توجد عمليات مالية مسجلة" description="سيظهر هنا إنشاء الدفعات والأقساط وحذف الدفعات والتعديلات المالية الحساسة." /> : null}</div>
              </section>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'notes' ? (
        <section className="premium-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">الملاحظات الطبية العامة</h2><button type="button" className="outline-btn px-4 py-2 text-sm" onClick={openEditMedicalNotes}>تعديل الملاحظات</button></div>
          <div className="min-h-40 rounded-2xl border border-border bg-white/75 p-4 leading-8 text-slate-600 whitespace-pre-wrap">{patient.medical_notes || 'لا توجد ملاحظات طبية عامة مسجلة.'}</div>
        </section>
      ) : null}

      <Modal open={openImageModal} title="إضافة صورة أو ملف لملف المريض" onClose={() => { if (!savingImage) { setOpenImageModal(false); setImageFile(null); setImageDescription(''); } }}>
        <form onSubmit={savePatientImage} className="grid gap-4 text-right">
          <div className="rounded-2xl border border-border bg-muted/45 p-4 text-sm font-bold leading-7 text-slate-600">المسموح: صور، PDF، Word، TXT. الحد الأقصى الإجمالي داخل الملف هو 10 عناصر، وحجم الملف الواحد حتى 10MB.</div>
          <label><span className="mb-2 block text-sm font-bold">اختر صورة أو ملف</span><input className="soft-input" type="file" accept="image/*,.pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => setImageFile(e.target.files?.[0] || null)} required /></label>
          <label><span className="mb-2 block text-sm font-bold">وصف اختياري</span><textarea className="soft-input" value={imageDescription} onChange={(e) => setImageDescription(e.target.value)} placeholder="مثال: صورة أشعة قبل العلاج، تقرير مختبر، ملاحظات خارجية..." /></label>
          <div className="flex justify-end"><button className="premium-btn" disabled={savingImage || !imageFile}>{savingImage ? 'جاري الرفع...' : 'حفظ الملف'}</button></div>
        </form>
      </Modal>

      <Modal open={openMedicalNotesEdit} title="تعديل الملاحظات الطبية العامة" onClose={() => { if (!savingMedicalNotes) setOpenMedicalNotesEdit(false); }}>
        <form onSubmit={updateGeneralMedicalNotes} className="grid gap-4 text-right"><label><span className="mb-2 block text-sm font-bold">الملاحظات الطبية العامة</span><textarea className="soft-input min-h-44" value={medicalNotesDraft} onChange={(e) => setMedicalNotesDraft(e.target.value)} /></label><div className="flex justify-end"><button className="premium-btn" disabled={savingMedicalNotes}>{savingMedicalNotes ? 'جاري الحفظ...' : 'حفظ الملاحظات'}</button></div></form>
      </Modal>

      <Modal open={openPatientEdit} title="تعديل بيانات المريض" onClose={() => setOpenPatientEdit(false)}>
        <form onSubmit={updatePatient} className="grid gap-4 md:grid-cols-2"><label><span className="mb-2 block text-sm font-bold">الاسم</span><input className="soft-input" required value={patientForm.full_name} onChange={(e) => setPatientForm({ ...patientForm, full_name: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">الهاتف</span><input className="soft-input number-ltr" required value={patientForm.phone} onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })} /></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">العنوان</span><input className="soft-input" value={patientForm.address} onChange={(e) => setPatientForm({ ...patientForm, address: e.target.value })} /></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات طبية</span><textarea className="soft-input" value={patientForm.medical_notes} onChange={(e) => setPatientForm({ ...patientForm, medical_notes: e.target.value })} /></label><div className="md:col-span-2 flex justify-end"><button className="premium-btn">حفظ التعديل</button></div></form>
      </Modal>

      <Modal open={!!statusMenuRow} title="تغيير حالة الموعد" onClose={() => setStatusMenuRow(null)}>
        {statusMenuRow ? <div className="space-y-4 text-right"><div className="rounded-2xl border border-border bg-muted/40 p-4"><p className="font-black text-slate-900">{patient.full_name}</p><p className="mt-1 text-sm font-bold text-slate-500">{statusMenuRow.services?.name || 'خدمة'} — {statusMenuRow.appointment_time?.slice(0, 5)}</p><div className="mt-3"><StatusBadge tone={appointmentStatusTone(statusMenuRow.status)}>{appointmentStatusLabels[statusMenuRow.status]}</StatusBadge></div></div>{getAppointmentStatusActions(statusMenuRow.status).length ? <div className="table-actions-row appointment-status-actions justify-start">{getAppointmentStatusActions(statusMenuRow.status).map((action) => <button key={action.status} type="button" className={`${action.tone === 'danger' ? 'ghost-btn text-danger' : 'outline-btn'} table-action-btn`} onClick={() => updateAppointmentStatus(statusMenuRow, action.status)}>{action.label}</button>)}</div> : <p className="text-sm font-bold text-slate-500">هذا الموعد في حالة نهائية.</p>}</div> : null}
      </Modal>

      <Modal open={!!completionRow} title="إنهاء الجلسة بخطوات بسيطة" className="completion-modal-panel" onClose={() => { if (!savingCompletion) { setCompletionRow(null); setCompletionTeeth([]); setCompletionStep(1); } }}>
        {completionRow ? (
          <form onSubmit={submitAppointmentCompletion} className="grid gap-5 text-right">
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="font-black text-slate-900">{patient.full_name}</p>
              <p className="mt-1 text-sm font-bold text-slate-500 number-ltr">{completionRow.appointment_date} — {completionRow.appointment_time?.slice(0, 5)}</p>
              <p className="mt-2 text-sm font-bold text-primary">{completionRow.services?.name || 'جلسة علاج'}</p>
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
              <div className="grid gap-4">
                <div className="rounded-3xl border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">الإجراء المنفذ</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">اكتب الإجراء مرة واحدة وسيتم تطبيقه على كل الأسنان المحددة.</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{completionTeeth.length} أسنان محددة</span>
                  </div>
                  <textarea className="soft-input min-h-24" value={completionForm.procedure_done} onChange={(e) => applyProcedureToAllCompletionTeeth(e.target.value)} placeholder="مثال: تقويم، حشوات للأسنان المحددة، علاج عصب، تنظيف..." />
                  <div className="selected-teeth-chip-row mt-3">
                    {completionTeeth.map((item) => (
                      <span key={item.tooth_number} className="selected-tooth-chip number-ltr">{item.tooth_number}</span>
                    ))}
                  </div>
                </div>

                <details className="advanced-only-section rounded-3xl border border-border p-4">
                  <summary className="cursor-pointer select-none font-black text-slate-700">تعديل إجراء سن محدد عند الحاجة</summary>
                  <div className="completion-teeth-grid mt-4">
                    {completionTeeth.map((item) => (
                      <label key={item.tooth_number} className="completion-tooth-card compact-card">
                        <span className="block text-xs font-black text-slate-500">سن <span className="number-ltr">{item.tooth_number}</span></span>
                        <input className="soft-input mt-2" value={item.procedure_done} onChange={(e) => updateCompletionTooth(item.tooth_number, { procedure_done: e.target.value })} placeholder={completionForm.procedure_done || 'إجراء خاص'} />
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            ) : null}

            {completionStep === 3 ? (
              <div className="grid gap-4">
                <div className="rounded-3xl border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">الحالة بعد العلاج</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">اختر حالة واحدة لتطبيقها على كل الأسنان المحددة، ثم عدّل سنًا منفردًا عند الحاجة.</p>
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
                  <summary className="cursor-pointer select-none font-black text-slate-700">تعديل حالة سن محدد أو إزالة سن</summary>
                  <div className="completion-teeth-grid mt-4">
                    {completionTeeth.map((item) => (
                      <div key={item.tooth_number} className="completion-tooth-card compact-card">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <strong className="number-ltr">سن {item.tooth_number}</strong>
                          <button type="button" className="ghost-btn px-2 py-1 text-xs text-danger" onClick={() => toggleCompletionTooth(item.tooth_number)}>إزالة</button>
                        </div>
                        <select className="soft-input" value={item.new_status} onChange={(e) => updateCompletionTooth(item.tooth_number, { new_status: e.target.value })}>
                          {dentalStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                        </select>
                      </div>
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
                            <span className="mb-2 block text-xs font-black text-slate-500">ملاحظة لسن <span className="number-ltr">{item.tooth_number}</span></span>
                            <textarea className="soft-input min-h-20" value={item.notes} onChange={(e) => updateCompletionTooth(item.tooth_number, { notes: e.target.value })} placeholder="مثال: ألم عند الضغط، حشوة مؤقتة، يحتاج متابعة..." />
                            {missingNote ? <span className="field-error-message">يجب تعبئة ملاحظة هذا السن.</span> : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <label>
                  <span className="mb-2 block font-bold">ملاحظات طبية عامة للمريض</span>
                  <textarea className={`soft-input min-h-28 ${!completionForm.doctor_notes.trim() ? 'input-error' : ''}`} value={completionForm.doctor_notes} onChange={(e) => setCompletionForm({ ...completionForm, doctor_notes: e.target.value })} placeholder="مثال: توصيات بعد الجلسة، أدوية، حساسية، تعليمات للمريض..." />
                  {!completionForm.doctor_notes.trim() ? <span className="field-error-message">يجب تعبئة الملاحظات الطبية العامة.</span> : null}
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-between gap-3">
              <button type="button" className="outline-btn" onClick={() => { setCompletionRow(null); setCompletionTeeth([]); setCompletionStep(1); }} disabled={savingCompletion}>تراجع</button>
              <div className="flex flex-wrap gap-3">
                {completionStep > 1 ? <button type="button" className="outline-btn" onClick={() => setCompletionStep((value) => Math.max(1, value - 1))} disabled={savingCompletion}>السابق</button> : null}
                {completionStep < 4 ? (
                  <button type="button" className="premium-btn" onClick={() => setCompletionStep((value) => Math.min(4, value + 1))} disabled={completionStep === 1 && !completionTeeth.length}>التالي</button>
                ) : (
                  <button className="premium-btn" disabled={savingCompletion}>{savingCompletion ? 'جاري الحفظ...' : 'حفظ الجلسة وتحديث الأسنان'}</button>
                )}
              </div>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={!!editingVisit} title="تعديل ملخص جلسة العلاج" onClose={closeVisitEdit}>
        {editingVisit ? <form onSubmit={updateVisitNotes} className="grid gap-4 text-right"><div className="rounded-2xl border border-border bg-muted/40 p-4"><p className="font-black text-slate-900">{editingVisit.services?.name || editingVisit.treatment_plans?.title || 'جلسة علاج'}</p><p className="mt-1 text-sm font-bold text-slate-500 number-ltr">{editingVisit.visit_date}</p></div><label><span className="mb-2 block font-bold">وصف مختصر لما تم إجراؤه</span><textarea className="soft-input min-h-28" required value={visitEditForm.procedure_done} onChange={(e) => setVisitEditForm({ ...visitEditForm, procedure_done: e.target.value })} /></label><label><span className="mb-2 block font-bold">ملاحظات طبية</span><textarea className="soft-input min-h-28" required value={visitEditForm.doctor_notes} onChange={(e) => setVisitEditForm({ ...visitEditForm, doctor_notes: e.target.value })} /></label><div className="flex flex-wrap justify-end gap-3"><button type="button" className="outline-btn" onClick={closeVisitEdit} disabled={savingVisitEdit}>تراجع</button><button className="premium-btn" disabled={savingVisitEdit}>{savingVisitEdit ? 'جاري الحفظ...' : 'حفظ التعديل'}</button></div></form> : null}
      </Modal>

      <Modal open={openAppointment} title={`إضافة موعد للمريض: ${patient.full_name}`} onClose={() => setOpenAppointment(false)}>
        <form onSubmit={createAppointment} className="grid gap-4 md:grid-cols-2"><label><span className="mb-2 block text-sm font-bold">الخدمة</span><select className="soft-input" required value={appointmentForm.service_id} onChange={(e) => selectAppointmentService(e.target.value)}><option value="">اختر الخدمة</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><span className="mb-2 block text-sm font-bold">التكلفة</span><input className="soft-input number-ltr" required type="number" min="0" step="0.01" value={appointmentForm.treatment_cost} onChange={(e) => setAppointmentForm({ ...appointmentForm, treatment_cost: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">حالة الموعد</span><select className="soft-input" value={appointmentForm.status} onChange={(e) => setAppointmentForm({ ...appointmentForm, status: e.target.value })}><option value="confirmed">مؤكد</option><option value="pending">بانتظار التأكيد</option></select></label><label><span className="mb-2 block text-sm font-bold">التاريخ</span><input className="soft-input number-ltr" type="date" min={todayISO()} value={appointmentForm.appointment_date} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_date: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">الوقت</span><input className="soft-input number-ltr" type="time" value={appointmentForm.appointment_time} onChange={(e) => setAppointmentForm({ ...appointmentForm, appointment_time: e.target.value })} /></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات</span><textarea className="soft-input" value={appointmentForm.notes} onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })} /></label><div className="md:col-span-2 flex justify-end"><button className="premium-btn" disabled={savingAppointment}>{savingAppointment ? 'جاري الحفظ...' : 'حفظ الموعد'}</button></div></form>
      </Modal>

      <Modal open={openPlan} title={editingPlan ? 'تعديل خطة علاج' : 'إضافة خطة علاج'} onClose={closePlanModal}>
        <form onSubmit={savePlan} className="grid gap-4 md:grid-cols-2"><label><span className="mb-2 block text-sm font-bold">الخدمة / خطة العلاج</span><select className="soft-input" required value={planForm.service_id} onChange={(e) => selectPlanService(e.target.value)}><option value="">اختر الخدمة</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm font-bold text-slate-600">اسم الخطة: <span className="text-primary">{planForm.title || 'اختر خدمة أولاً'}</span></div><label><span className="mb-2 block text-sm font-bold">الحالة</span><select className="soft-input" value={planForm.status} onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}><option value="active">نشطة</option><option value="paused">متوقفة</option><option value="completed">مكتملة</option><option value="cancelled">ملغاة</option></select></label><label><span className="mb-2 block text-sm font-bold">الإجمالي</span><input className="soft-input number-ltr" type="number" step="0.01" value={planForm.total_amount} onChange={(e) => setPlanForm({ ...planForm, total_amount: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">الخصم</span><input className="soft-input number-ltr" type="number" step="0.01" value={planForm.discount_amount} onChange={(e) => setPlanForm({ ...planForm, discount_amount: e.target.value })} /></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات</span><textarea className="soft-input" value={planForm.notes} onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })} /></label><div className="md:col-span-2 flex justify-end"><button className="premium-btn">{editingPlan ? 'حفظ التعديل' : 'حفظ خطة العلاج'}</button></div></form>
      </Modal>

      <Modal open={openInstallment} title="إضافة قسط" onClose={() => setOpenInstallment(false)}>
        <form onSubmit={createInstallment} className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2 rounded-2xl border border-border bg-muted/45 p-4 text-sm font-bold leading-7 text-slate-600">القسط هنا هو موعد استحقاق فقط. لا تُدخل المبلغ المدفوع أو طريقة الدفع هنا؛ عند تسجيل دفعة سيتم ربطها بالقسط وسيحسب النظام المدفوع والحالة تلقائيًا.</div><label><span className="mb-2 block text-sm font-bold">خطة العلاج</span><select className="soft-input" required value={installmentForm.treatment_plan_id} onChange={(e) => setInstallmentForm({ ...installmentForm, treatment_plan_id: e.target.value })}><option value="">اختر خطة العلاج</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label><span className="mb-2 block text-sm font-bold">تاريخ الاستحقاق</span><input className="soft-input number-ltr" required type="date" value={installmentForm.due_date} onChange={(e) => setInstallmentForm({ ...installmentForm, due_date: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">قيمة القسط</span><input className="soft-input number-ltr" required type="number" min="0" step="0.01" value={installmentForm.amount} onChange={(e) => setInstallmentForm({ ...installmentForm, amount: e.target.value })} /></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات</span><textarea className="soft-input" value={installmentForm.notes} onChange={(e) => setInstallmentForm({ ...installmentForm, notes: e.target.value })} /></label><div className="md:col-span-2 flex justify-end"><button className="premium-btn" disabled={!installmentForm.treatment_plan_id || !installmentForm.amount}>حفظ القسط</button></div></form>
      </Modal>

      <Modal open={openPayment} title="إضافة دفعة" onClose={() => setOpenPayment(false)}>
        <form onSubmit={createPayment} className="grid gap-4 md:grid-cols-2"><label><span className="mb-2 block text-sm font-bold">خطة العلاج</span><select className="soft-input" required value={paymentForm.treatment_plan_id} onChange={(e) => handlePaymentPlanChange(e.target.value)}><option value="">اختر خطة العلاج</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label><span className="mb-2 block text-sm font-bold">تطبيق الدفعة على قسط</span><select className="soft-input" value={paymentForm.installment_id} onChange={(e) => setPaymentForm({ ...paymentForm, installment_id: e.target.value })} disabled={!paymentForm.treatment_plan_id || paymentInstallmentOptions.length === 0}><option value="">بدون ربط بقسط محدد</option>{paymentInstallmentOptions.map((item) => { const remaining = Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0)); return <option key={item.id} value={item.id}>{getInstallmentLabel(item)} - المتبقي {formatMoney(remaining, currencySymbol)}</option>; })}</select></label><label><span className="mb-2 block text-sm font-bold">المبلغ المدفوع</span><input className="soft-input number-ltr" required type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></label><label><span className="mb-2 block text-sm font-bold">طريقة الدفع</span><select className="soft-input" value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}><option value="cash">نقداً</option><option value="transfer">حوالة</option><option value="card">بطاقة</option><option value="other">أخرى</option></select></label><label><span className="mb-2 block text-sm font-bold">نوع الدفع</span><select className="soft-input" value={paymentForm.payment_type} onChange={(e) => setPaymentForm({ ...paymentForm, payment_type: e.target.value })}><option value="down_payment">دفعة أولى</option><option value="installment">قسط</option><option value="full_payment">دفعة كاملة</option><option value="extra_payment">دفعة إضافية</option><option value="refund">استرجاع</option></select></label><label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات</span><textarea className="soft-input" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} /></label><div className="md:col-span-2 flex justify-end"><button className="premium-btn" disabled={!paymentForm.treatment_plan_id || !paymentForm.amount}>حفظ الدفعة</button></div></form>
      </Modal>
    </div>
  );
}

function SummaryBox({ label, value, success, danger }: { label: string; value: string; success?: boolean; danger?: boolean }) {
  return <div className="rounded-2xl border border-border bg-white/80 p-4 text-right"><p className="text-sm font-black text-slate-500">{label}</p><p className={`${success ? 'text-success' : danger ? 'text-danger' : 'text-slate-900'} mt-3 text-lg font-black number-ltr`}>{value}</p></div>;
}

function FilterDate({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label><span className="mb-2 block text-xs font-black text-slate-500">فلترة حسب التاريخ</span><input className="soft-input number-ltr" type="date" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function VisitCard({ visit, canEdit, onEdit }: { visit: Visit; canEdit: boolean; onEdit: (visit: Visit) => void }) {
  const teeth = visit.visit_teeth || [];
  return (
    <div className="rounded-2xl border border-border bg-white/80 p-4 text-right shadow-subtle">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-black text-primary">{visit.services?.name || visit.treatment_plans?.title || 'جلسة علاج'}</span>
          <span className="text-sm font-black text-slate-500 number-ltr">{formatDate(visit.visit_date)}</span>
          {teeth.length ? <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-black text-slate-500 number-ltr">{teeth.length} أسنان</span> : null}
        </div>
        {canEdit ? <button type="button" className="outline-btn visit-edit-btn" onClick={() => onEdit(visit)}>تعديل الملاحظات</button> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-muted/35 p-4">
          <p className="mb-2 text-sm font-black text-slate-500">ما تم إجراؤه</p>
          <p className="leading-7 text-slate-800 whitespace-pre-wrap">{visit.procedure_done || '—'}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/35 p-4">
          <p className="mb-2 text-sm font-black text-slate-500">ملاحظات طبية</p>
          <p className="leading-7 text-slate-800 whitespace-pre-wrap">{visit.doctor_notes || '—'}</p>
        </div>
      </div>
      {teeth.length ? (
        <div className="mt-3 rounded-2xl border border-primary/10 bg-primary/5 p-4">
          <p className="mb-3 text-sm font-black text-slate-600">الأسنان المرتبطة بهذه الجلسة</p>
          <div className="grid gap-2 md:grid-cols-2">
            {teeth.map((tooth) => (
              <div key={tooth.id} className="rounded-2xl border border-border bg-white/85 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="number-ltr">سن {tooth.tooth_number}</strong>
                  <span className={`dental-status-pill ${dentalStatusClass(tooth.new_status)}`}>{dentalStatusLabel(tooth.new_status)}</span>
                </div>
                <p className="text-sm font-bold text-slate-700">{tooth.procedure_done}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">{dentalStatusLabel(tooth.old_status)} ← {dentalStatusLabel(tooth.new_status)}</p>
                {tooth.notes ? <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{tooth.notes}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentCard({ image, canDelete, onDelete }: { image: PatientImage; canDelete: boolean; onDelete: (image: PatientImage) => void }) {
  const isImage = isImageAttachment(image);
  const fileName = getAttachmentDisplayName(image);
  return <div className="overflow-hidden rounded-3xl border border-border bg-white shadow-subtle">{isImage ? <img src={image.image_data} alt={image.description || fileName || 'صورة مريض'} className="h-44 w-full object-cover" /> : <div className="flex h-44 flex-col items-center justify-center gap-3 bg-muted/45 p-5 text-center"><div className="text-4xl">{getAttachmentIcon(image)}</div><p className="max-w-full truncate text-base font-black text-slate-800">{fileName}</p><a className="outline-btn px-4 py-2 text-xs" href={image.image_data} target="_blank" rel="noreferrer" download={fileName}>فتح / تحميل الملف</a></div>}<div className="p-4"><p className="min-h-12 text-sm font-bold leading-6 text-slate-700">{image.description || (isImage ? 'لا يوجد وصف.' : fileName)}</p><div className="mt-3 flex items-center justify-between gap-3"><div className="grid gap-1 text-xs font-black text-slate-400"><span className="number-ltr">{formatDate(image.created_at)}</span>{image.file_size ? <span className="number-ltr">{formatFileSize(image.file_size)}</span> : null}</div>{canDelete ? <button className="ghost-btn px-3 py-2 text-xs text-danger" onClick={() => onDelete(image)}>حذف</button> : null}</div></div></div>;
}

export default function PatientProfilePage() {
  return <AppShell>{(ctx) => <PatientProfileContent {...ctx} />}</AppShell>;
}
