'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell, type AppContext } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icons';
import { StatusBadge } from '@/components/StatusBadge';
import { canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { showSecureMessage } from '@/lib/secureActions';
import { showToast } from '@/lib/toast';
import { exportPatientData } from '@/lib/patientExport';
import { buildPatientImportTemplateCsv, parsePatientImportFile, type ImportedPatientRow } from '@/lib/patientImport';
import { logActivity } from '@/lib/audit';
import { appendToCachedList, getCache, getOnlineStatus, makeLocalId, offlineKeys, queueOperation, setCache } from '@/lib/offline';
import type { Appointment, Patient, TreatmentPlan } from '@/lib/types';
import { formatDate, formatMoney, getCurrencySymbol, todayISO } from '@/lib/utils';

type PatientForm = { full_name: string; phone: string; address: string; medical_notes: string };
type PatientFilter = 'active' | 'archived' | 'has_remaining' | 'has_upcoming' | 'all';
type SortMode = 'newest' | 'name' | 'last_visit';

const emptyPatientForm: PatientForm = { full_name: '', phone: '', address: '', medical_notes: '' };
const PATIENTS_PAGE_SIZE = 24;

function PatientsContent({ staff, clinic }: AppContext) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PatientFilter>('active');
  const [sort, setSort] = useState<SortMode>('newest');
  const [form, setForm] = useState<PatientForm>(emptyPatientForm);
  const [exporting, setExporting] = useState<false | 'excel' | 'json' | 'zip'>(false);
  const [openImport, setOpenImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportedPatientRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const canViewFinance = canViewFullFinancials(staff);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);

  async function load() {
    if (!staff) return;
    const cachedPatientsKey = offlineKeys.patients(staff.clinic_id);
    const cachedAppointmentsKey = offlineKeys.appointments(staff.clinic_id);
    if (!getOnlineStatus()) {
      const [cachedPatients, cachedAppointments] = await Promise.all([
        getCache<Patient[]>(cachedPatientsKey),
        getCache<Appointment[]>(cachedAppointmentsKey)
      ]);
      setPatients(cachedPatients || []);
      setAppointments((cachedAppointments || []).filter((appointment) => appointment.appointment_date >= todayISO()));
      setPlans([]);
      return;
    }
    const [patientsRes, appointmentsRes, plansRes] = await Promise.all([
      supabase.from('patients').select('*').eq('clinic_id', staff.clinic_id).order('created_at', { ascending: false }),
      supabase.from('appointments').select('id, patient_id, appointment_date, appointment_time, status').eq('clinic_id', staff.clinic_id).gte('appointment_date', todayISO()).order('appointment_date', { ascending: true }).limit(500),
      canViewFinance ? supabase.from('treatment_plans').select('id, patient_id, remaining_amount, status').eq('clinic_id', staff.clinic_id).gt('remaining_amount', 0).limit(500) : Promise.resolve({ data: [], error: null } as any)
    ]);

    if (patientsRes.error) await showSecureMessage('تعذر تحميل المرضى', patientsRes.error.message);
    const patientRows = (patientsRes.data || []) as Patient[];
    const appointmentRows = (appointmentsRes.data || []) as Appointment[];
    setPatients(patientRows);
    setAppointments(appointmentRows);
    setPlans((plansRes.data || []) as TreatmentPlan[]);
    await Promise.all([
      setCache(cachedPatientsKey, patientRows),
      setCache(offlineKeys.recentPatients(staff.clinic_id), patientRows.slice(0, 30)),
      setCache(cachedAppointmentsKey, appointmentRows)
    ]);
  }

  useEffect(() => { load(); }, [staff?.clinic_id, staff?.role]);
  useEffect(() => {
    const onDataChanged = () => load();
    window.addEventListener('online', onDataChanged);
    window.addEventListener('dentalos-offline-data-changed', onDataChanged);
    return () => {
      window.removeEventListener('online', onDataChanged);
      window.removeEventListener('dentalos-offline-data-changed', onDataChanged);
    };
  }, [staff?.clinic_id, staff?.role]);
  useEffect(() => { setPage(1); }, [q, filter, sort]);
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1') openCreate();
  }, []);

  function openCreate() {
    setForm(emptyPatientForm);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setForm(emptyPatientForm);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;

    const payload = { clinic_id: staff.clinic_id, full_name: form.full_name.trim(), phone: form.phone.trim(), address: form.address.trim() || null, medical_notes: form.medical_notes.trim() || null, status: 'active' as const };
    if (!getOnlineStatus()) {
      const localPatient = { id: makeLocalId('patient'), ...payload, created_at: new Date().toISOString() } as Patient;
      setPatients((current) => [localPatient, ...current]);
      await appendToCachedList<Patient>(offlineKeys.patients(staff.clinic_id), localPatient);
      await appendToCachedList<Patient>(offlineKeys.recentPatients(staff.clinic_id), localPatient);
      await queueOperation(staff.clinic_id, 'create_patient', { ...payload, local_id: localPatient.id });
      showToast('تم حفظ المريض مؤقتًا', 'سيتم إنشاء ملف المريض على الخادم تلقائيًا عند عودة الإنترنت.', 'success');
      closeModal();
      return;
    }

    const { error } = await supabase.from('patients').insert(payload);
    if (error) {
      await showSecureMessage('تعذر إضافة المريض', error.message);
      return;
    }

    await logActivity(staff, 'patient_created', 'patient', null, null, payload);
    closeModal();
    load();
  }

  const upcomingByPatient = useMemo(() => {
    const map = new Map<string, Appointment>();
    appointments.forEach((appointment) => {
      if (['completed', 'cancelled', 'no_show'].includes(appointment.status)) return;
      if (!map.has(appointment.patient_id)) map.set(appointment.patient_id, appointment);
    });
    return map;
  }, [appointments]);

  const remainingByPatient = useMemo(() => {
    const map = new Map<string, number>();
    plans.forEach((plan) => map.set(plan.patient_id, (map.get(plan.patient_id) || 0) + Number(plan.remaining_amount || 0)));
    return map;
  }, [plans]);


  async function handleExport(mode: 'excel' | 'json' | 'zip') {
    if (!staff) return;
    if (!getOnlineStatus()) {
      showToast('التصدير غير متاح بدون اتصال', 'النسخ الاحتياطي والتصدير يحتاجان اتصالًا بالخادم.', 'warning');
      return;
    }
    setExporting(mode);
    try {
      await exportPatientData(staff, clinic, mode);
    } catch (error) {
      showToast('تعذر تصدير بيانات المرضى', String((error as { message?: string })?.message || 'حدث خطأ غير متوقع.'), 'error');
    } finally {
      setExporting(false);
    }
  }


  function downloadImportTemplate() {
    const blob = new Blob([buildPatientImportTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'patients-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleImportFile(file: File | null) {
    setImportFile(file);
    setImportPreview([]);
    if (!file) return;
    try {
      const rows = await parsePatientImportFile(file);
      setImportPreview(rows.slice(0, 200));
      if (!rows.length) showToast('لا توجد بيانات صالحة', 'تأكد من وجود أعمدة full_name و phone أو الاسم والهاتف.', 'warning');
    } catch (error) {
      showToast('تعذر قراءة الملف', String((error as { message?: string })?.message || error), 'error');
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !importFile) return;
    if (!getOnlineStatus()) {
      showToast('الاستيراد غير متاح بدون اتصال', 'استيراد المرضى يحتاج اتصالًا لتجنب التكرار والتعارض.', 'warning');
      return;
    }
    setImporting(true);
    try {
      const rows = await parsePatientImportFile(importFile);
      const uniqueRows = rows.filter((row, index, all) => all.findIndex((other) => other.full_name === row.full_name && other.phone === row.phone) === index);
      if (!uniqueRows.length) {
        showToast('لا توجد بيانات للاستيراد', 'أدخل ملفاً يحتوي على مرضى صالحين.', 'warning');
        return;
      }
      const payload = uniqueRows.map((row) => ({
        clinic_id: staff.clinic_id,
        full_name: row.full_name,
        phone: row.phone,
        address: row.address || null,
        medical_notes: row.medical_notes || null,
        status: 'active'
      }));
      const { error } = await supabase.from('patients').insert(payload);
      if (error) throw error;
      await logActivity(staff, 'patients_imported', 'patient', null, null, { count: payload.length, file_name: importFile.name });
      showToast('تم استيراد المرضى', `تمت إضافة ${payload.length} مريض.`, 'success');
      setOpenImport(false);
      setImportFile(null);
      setImportPreview([]);
      load();
    } catch (error) {
      showToast('تعذر استيراد المرضى', String((error as { message?: string })?.message || error), 'error');
    } finally {
      setImporting(false);
    }
  }

  const query = q.trim().toLowerCase();
  const list = patients
    .filter((p) => {
      if (filter === 'active') return (p.status || 'active') !== 'archived';
      if (filter === 'archived') return (p.status || 'active') === 'archived';
      if (filter === 'has_remaining') return (remainingByPatient.get(p.id) || 0) > 0;
      if (filter === 'has_upcoming') return upcomingByPatient.has(p.id);
      return true;
    })
    .filter((p) => {
      if (!query) return true;
      return [p.full_name, p.phone, p.address, p.medical_notes].filter(Boolean).join(' ').toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name, 'ar');
      if (sort === 'last_visit') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

  const totalPages = Math.max(1, Math.ceil(list.length / PATIENTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedList = list.slice((currentPage - 1) * PATIENTS_PAGE_SIZE, currentPage * PATIENTS_PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">المرضى</h1>
          <p className="text-slate-500">إدارة ملفات المرضى النشطة والمؤرشفة مع بحث وفلاتر عملية.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/archive" className="outline-btn"><Icon name="archive" /> الأرشيف</Link>
          <button className="premium-btn" onClick={openCreate}><Icon name="plus" /> إضافة مريض</button>
        </div>
      </div>

      <div className="premium-card grid gap-3 lg:grid-cols-[1fr_190px_190px]">
        <input className="soft-input" placeholder="بحث بالاسم أو الهاتف أو العنوان..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="soft-input" value={filter} onChange={(e) => setFilter(e.target.value as PatientFilter)}>
          <option value="active">المرضى النشطون</option>
          <option value="archived">المؤرشفون</option>
          <option value="has_upcoming">لديهم موعد قادم</option>
          {canViewFinance ? <option value="has_remaining">لديهم مبلغ متبقٍ</option> : null}
          <option value="all">الكل</option>
        </select>
        <select className="soft-input" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="newest">الأحدث</option>
          <option value="name">الاسم</option>
          <option value="last_visit">آخر إضافة</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pagedList.map((p) => {
          const next = upcomingByPatient.get(p.id);
          const remaining = remainingByPatient.get(p.id) || 0;
          return (
            <article key={p.id} className="premium-card patient-list-card relative">
              <div className="patient-card-status-corner">
                <StatusBadge tone={(p.status || 'active') === 'archived' ? 'warning' : 'primary'}>{(p.status || 'active') === 'archived' ? 'مؤرشف' : 'نشط'}</StatusBadge>
              </div>
              <div className="flex items-start justify-end gap-3 text-right">
                <div>
                  <h2 className="text-xl font-black text-slate-900">{p.full_name}</h2>
                  <p className="mt-2 text-sm font-bold text-slate-500 number-ltr">{p.phone}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm font-bold text-slate-600">
                <p>العنوان: {p.address || '—'}</p>
                <p>الموعد القادم: <span className="number-ltr">{next ? `${formatDate(next.appointment_date)} · ${next.appointment_time?.slice(0, 5)}` : 'لا يوجد'}</span></p>
                {canViewFinance ? <p>المتبقي: <span className={remaining > 0 ? 'text-danger number-ltr' : 'number-ltr'}>{formatMoney(remaining, currencySymbol)}</span></p> : null}
              </div>
              <Link href={`/patients/profile?id=${p.id}`} className="outline-btn mt-5 w-full justify-center"><Icon name="file" className="h-4 w-4" /> فتح الملف</Link>
            </article>
          );
        })}
      </div>
      {list.length > PATIENTS_PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button className="outline-btn" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</button>
          <span className="rounded-2xl border border-border bg-white px-4 py-2 text-sm font-black text-slate-600">صفحة {currentPage} من {totalPages}</span>
          <button className="outline-btn" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>التالي</button>
        </div>
      ) : null}
      {!list.length ? <EmptyState title="لا توجد بيانات مطابقة" description="غيّر الفلتر أو اضغط إضافة مريض لإنشاء ملف جديد." action={<button className="premium-btn" onClick={openCreate}>إضافة مريض</button>} /> : null}

      <Modal open={open} title="إضافة مريض" onClose={closeModal}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <label><span className="mb-2 block text-sm font-bold">الاسم</span><input className="soft-input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label><span className="mb-2 block text-sm font-bold">الهاتف</span><input className="soft-input number-ltr" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">العنوان</span><input className="soft-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          <label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">ملاحظات طبية</span><textarea className="soft-input" value={form.medical_notes} onChange={(e) => setForm({ ...form, medical_notes: e.target.value })} /></label>
          <div className="md:col-span-2 flex justify-end"><button className="premium-btn">حفظ</button></div>
        </form>
      </Modal>
    </div>
  );
}

export default function PatientsPage() {
  return <AppShell>{(ctx) => <PatientsContent {...ctx} />}</AppShell>;
}
