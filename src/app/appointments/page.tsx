'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { appointmentStatusLabels } from '@/lib/constants';
import { completeAppointmentWithVisit } from '@/lib/appointmentCompletion';
import { appointmentStatusOptions, appointmentStatusTone, getAppointmentStatusActions } from '@/lib/appointmentWorkflow';
import { canManageMedicalRecords } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { Appointment, Patient, Service, WorkingHour } from '@/lib/types';
import { formatMoney, getCurrencySymbol, getDayOfWeek, timeToMinutes, todayISO } from '@/lib/utils';
import { requestActionConfirmation, showSecureMessage } from '@/lib/secureActions';
import { showToast } from '@/lib/toast';
import { logActivity } from '@/lib/audit';
import { appendToCachedList, getCache, getOnlineStatus, makeLocalId, offlineKeys, queueOperation, setCache } from '@/lib/offline';

type AppointmentFilters = {
  date: string;
  status: string;
  service_id: string;
  search: string;
  sort: 'desc' | 'asc';
};

function appointmentDateTimeValue(row: Appointment) {
  return `${row.appointment_date || ''}T${(row.appointment_time || '00:00').slice(0, 5)}`;
}

function AppointmentsContent({ staff, clinic }: AppContext) {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHour[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<AppointmentFilters>({ date: todayISO(), status: '', service_id: '', search: '', sort: 'asc' });
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [statusMenuRow, setStatusMenuRow] = useState<Appointment | null>(null);
  const [completionRow, setCompletionRow] = useState<Appointment | null>(null);
  const [completionForm, setCompletionForm] = useState({ procedure_done: '', doctor_notes: '' });
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState({ patient_id: '', service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
  const [lockedAppointmentSlot, setLockedAppointmentSlot] = useState<{ date: string; time: string } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const canManageMedical = canManageMedicalRecords(staff);

  async function load() {
    if (!staff) return;
    const cachedAppointmentsKey = offlineKeys.appointments(staff.clinic_id);
    const cachedPatientsKey = offlineKeys.recentPatients(staff.clinic_id);
    const cachedServicesKey = offlineKeys.services(staff.clinic_id);
    const cachedWorkingHoursKey = offlineKeys.workingHours(staff.clinic_id);
    if (!getOnlineStatus()) {
      const [cachedAppointments, cachedPatients, cachedServices, cachedWorkingHours] = await Promise.all([
        getCache<Appointment[]>(cachedAppointmentsKey),
        getCache<Patient[]>(cachedPatientsKey),
        getCache<Service[]>(cachedServicesKey),
        getCache<WorkingHour[]>(cachedWorkingHoursKey)
      ]);
      setRows(cachedAppointments || []);
      setPatients(cachedPatients || []);
      setPatientResults([]);
      setServices(cachedServices || []);
      setWorkingHours(cachedWorkingHours || []);
      return;
    }
    const [appointmentsRes, patientsRes, servicesRes, workingHoursRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, patients(*), services(*)')
        .eq('clinic_id', staff.clinic_id)
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false }),
      supabase.from('patients').select('*').eq('clinic_id', staff.clinic_id).order('created_at', { ascending: false }).limit(10),
      supabase.from('services').select('*').eq('clinic_id', staff.clinic_id).eq('is_active', true).order('name'),
      supabase.from('clinic_working_hours').select('*').eq('clinic_id', staff.clinic_id)
    ]);

    if (appointmentsRes.error) showToast('تعذر تحميل المواعيد', appointmentsRes.error.message, 'error');
    if (patientsRes.error) showToast('تعذر تحميل المرضى', patientsRes.error.message, 'error');
    if (servicesRes.error) showToast('تعذر تحميل الخدمات', servicesRes.error.message, 'error');
    if (workingHoursRes.error) showToast('تعذر تحميل أوقات الدوام', workingHoursRes.error.message, 'error');

    const appointmentRows = (appointmentsRes.data || []) as Appointment[];
    const recentPatients = (patientsRes.data || []) as Patient[];
    const serviceRows = (servicesRes.data || []) as Service[];
    const workingHourRows = (workingHoursRes.data || []) as WorkingHour[];
    setRows(appointmentRows);
    setPatients(recentPatients);
    setPatientResults([]);
    setServices(serviceRows);
    setWorkingHours(workingHourRows);
    await Promise.all([
      setCache(cachedAppointmentsKey, appointmentRows),
      setCache(cachedPatientsKey, recentPatients),
      setCache(cachedServicesKey, serviceRows),
      setCache(cachedWorkingHoursKey, workingHourRows)
    ]);
  }

  useEffect(() => { load(); }, [staff?.clinic_id]);

  useEffect(() => {
    setIsOnline(getOnlineStatus());
    const onOnline = () => { setIsOnline(true); load(); };
    const onOffline = () => setIsOnline(false);
    const onDataChanged = () => load();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('dentalos-offline-data-changed', onDataChanged);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('dentalos-offline-data-changed', onDataChanged);
    };
  }, [staff?.clinic_id]);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1') setOpen(true);
  }, []);


  useEffect(() => {
    if (!staff) return;
    const query = patientSearch.trim();
    if (selectedPatient) {
      setPatientResults([]);
      return;
    }
    if (!query || query.length < 2) {
      setPatientResults([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      const cleanQuery = query.replace(/[,%]/g, ' ').trim();
      if (!cleanQuery || cleanQuery.length < 2) {
        setPatientResults([]);
        return;
      }

      if (!getOnlineStatus()) {
        const cachedPatients = (await getCache<Patient[]>(offlineKeys.patients(staff.clinic_id))) || patients;
        const normalized = cleanQuery.toLowerCase();
        setPatientResults(cachedPatients.filter((patient) => `${patient.full_name} ${patient.phone || ''}`.toLowerCase().includes(normalized)).slice(0, 8));
        return;
      }

      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', staff.clinic_id)
        .or(`full_name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`)
        .order('created_at', { ascending: false })
        .limit(8);

      if (!error) setPatientResults((data || []) as Patient[]);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [patientSearch, selectedPatient, patients, staff?.clinic_id]);

  const filteredRows = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const baseDate = filters.date || todayISO();
    const range = getDateRange(baseDate, viewMode);
    return rows
      .filter((row) => {
        if (filters.date) return row.appointment_date >= range.start && row.appointment_date <= range.end;
        if (viewMode === 'day') return row.appointment_date === todayISO();
        return row.appointment_date >= range.start && row.appointment_date <= range.end;
      })
      .filter((row) => !filters.status || row.status === filters.status)
      .filter((row) => !filters.service_id || row.service_id === filters.service_id)
      .filter((row) => {
        if (!query) return true;
        const haystack = [
          row.patients?.full_name,
          row.patients?.phone,
          row.services?.name,
          row.appointment_date,
          row.appointment_time?.slice(0, 5),
          appointmentStatusLabels[row.status as keyof typeof appointmentStatusLabels],
          row.notes
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const result = appointmentDateTimeValue(a).localeCompare(appointmentDateTimeValue(b));
        return filters.sort === 'asc' ? result : -result;
      });
  }, [rows, filters, viewMode]);

  async function validateWorkingHour() {
    if (!staff) return 'لم يتم تحميل بيانات المستخدم.';
    if (!form.patient_id) return 'اختر المريض أولاً.';
    if (!form.service_id) return 'اختر الخدمة. سيتم إنشاء أو استخدام خطة علاج بنفس اسم الخدمة تلقائياً.';
    const cost = Number(form.treatment_cost);
    if (!Number.isFinite(cost) || cost < 0) return 'أدخل تكلفة صحيحة للخدمة. يتم تعبئتها افتراضياً ويمكن تعديلها قبل حفظ الموعد.';
    if (!form.appointment_date || !form.appointment_time) return 'اختر تاريخ ووقت الموعد.';

    const selectedDateTime = new Date(`${form.appointment_date}T${form.appointment_time}:00`);
    const now = new Date();
    if (Number.isNaN(selectedDateTime.getTime())) return 'تاريخ أو وقت الموعد غير صحيح.';
    if (selectedDateTime < now) return 'لا يمكن إضافة موعد في وقت سابق. اختر وقتاً لاحقاً من الوقت الحالي.';

    const day = getDayOfWeek(form.appointment_date);
    let row = workingHours.find((item) => item.day_of_week === day) || null;
    if (getOnlineStatus()) {
      const { data } = await supabase
        .from('clinic_working_hours')
        .select('*')
        .eq('clinic_id', staff.clinic_id)
        .eq('day_of_week', day)
        .maybeSingle();
      row = data as WorkingHour | null;
    }

    if (row && !row.is_open) return 'لا يمكن إضافة موعد في يوم مغلق حسب أوقات دوام العيادة.';
    const selectedService = services.find((service) => service.id === form.service_id);
    const duration = Math.max(5, Number(selectedService?.duration_minutes || 30));
    const appointment = timeToMinutes(form.appointment_time);
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
        .eq('appointment_date', form.appointment_date)
        .not('status', 'in', '(cancelled,no_show)')
        .limit(240);
      sameDay = (data || []) as Array<{ appointment_time: string; services?: { duration_minutes?: number | null } | null }>;
    } else {
      sameDay = rows
        .filter((row) => row.appointment_date === form.appointment_date && !['cancelled', 'no_show'].includes(row.status))
        .map((row) => ({ appointment_time: row.appointment_time, services: { duration_minutes: row.services?.duration_minutes || 30 } }));
    }

    const conflict = sameDay.some((item) => {
      const existingStart = timeToMinutes(item.appointment_time);
      const existingEnd = existingStart + Math.max(5, Number(item.services?.duration_minutes || 30));
      return appointment < existingEnd && existingStart < appointmentEnd;
    });
    if (conflict) return 'يوجد موعد آخر يتداخل مع مدة هذه الخدمة.';
    return null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    setSaving(true);
    const validationError = await validateWorkingHour();
    if (validationError) {
      setSaving(false);
      await showSecureMessage('لا يمكن إضافة الموعد', validationError);
      return;
    }

    const selectedService = services.find((service) => service.id === form.service_id);
    const selectedPatientRow = selectedPatient || patients.find((patient) => patient.id === form.patient_id) || null;
    const payload = {
      clinic_id: staff.clinic_id,
      patient_id: form.patient_id,
      service_id: form.service_id,
      treatment_cost: Number(form.treatment_cost || 0),
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      status: form.status,
      notes: form.notes || null
    };

    if (!getOnlineStatus()) {
      const localId = makeLocalId('appointment');
      const localAppointment = {
        id: localId,
        ...payload,
        patients: selectedPatientRow || undefined,
        services: selectedService || undefined
      } as Appointment;
      setRows((current) => [localAppointment, ...current]);
      await appendToCachedList<Appointment>(offlineKeys.appointments(staff.clinic_id), localAppointment);
      await queueOperation(staff.clinic_id, 'create_appointment', { ...payload, local_id: localId, patients: selectedPatientRow, services: selectedService });
      setSaving(false);
      showToast('تم حفظ الموعد مؤقتًا', 'سيتم إرسال الموعد إلى الخادم تلقائيًا عند عودة الإنترنت. سيُراجع النظام تعارض المواعيد أثناء المزامنة.', 'success');
      setOpen(false);
      setLockedAppointmentSlot(null);
      setForm({ patient_id: '', service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
      setSelectedPatient(null);
      setPatientSearch('');
      return;
    }

    const { error } = await supabase.from('appointments').insert(payload);

    setSaving(false);
    if (error) {
      await showSecureMessage('تعذر إضافة الموعد', error.message);
      return;
    }
    await supabase
      .from('patients')
      .update({ status: 'active', archived_at: null })
      .eq('clinic_id', staff.clinic_id)
      .eq('id', form.patient_id);
    await logActivity(staff, 'appointment_created', 'appointment', null, null, { patient_id: form.patient_id, appointment_date: form.appointment_date, appointment_time: form.appointment_time });
    setOpen(false);
    setLockedAppointmentSlot(null);
    setForm({ patient_id: '', service_id: '', treatment_cost: '', appointment_date: todayISO(), appointment_time: '09:00', status: 'confirmed', notes: '' });
    setSelectedPatient(null);
    setPatientSearch('');
    load();
  }


  function selectPatientForAppointment(patient: Patient) {
    setSelectedPatient(patient);
    setPatientSearch(patient.full_name || '');
    setForm((current) => ({ ...current, patient_id: patient.id }));
  }

  function clearSelectedPatient() {
    setSelectedPatient(null);
    setPatientSearch('');
    setForm((current) => ({ ...current, patient_id: '' }));
    setPatientResults([]);
  }

  function selectAppointmentService(serviceId: string) {
    const service = services.find((item) => item.id === serviceId);
    setForm((current) => ({
      ...current,
      service_id: serviceId,
      treatment_cost: service ? String(service.price || 0) : ''
    }));
  }

  const selectedAppointmentService = services.find((service) => service.id === form.service_id);


  async function updateAppointmentStatus(row: Appointment, nextStatus: string) {
    if (!getOnlineStatus()) {
      await showSecureMessage('لا يمكن تغيير حالة الموعد بدون اتصال', 'تغيير الحالة وإنهاء الجلسة يحتاجان اتصالاً حتى لا يحدث تضارب في السجل الطبي.');
      return;
    }
    const action = getAppointmentStatusActions(row.status).find((item) => item.status === nextStatus);
    if (!action) return;

    if (action.status === 'completed') {
      if (!canManageMedical) {
        await showSecureMessage('صلاحية غير متاحة', 'إنهاء الجلسة الطبية متاح للطبيب فقط.');
        setStatusMenuRow(null);
        return;
      }
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
      .eq('clinic_id', staff?.clinic_id || '');

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
    if (!staff || !completionRow || !canManageMedical) return;
    setSavingCompletion(true);
    const result = await completeAppointmentWithVisit({
      clinicId: staff.clinic_id,
      patientId: completionRow.patient_id,
      appointmentId: completionRow.id,
      serviceId: completionRow.service_id,
      visitDate: completionRow.appointment_date,
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
    await logActivity(staff, 'appointment_completed', 'appointment', completionRow.id, null, { procedure_done: completionForm.procedure_done });
    load();
  }

  function resetFilters() {
    setFilters({ date: todayISO(), status: '', service_id: '', search: '', sort: 'asc' });
    setViewMode('day');
  }

  function showDayAppointments(date = todayISO()) {
    setFilters((current) => ({ ...current, date, sort: 'asc' }));
    setViewMode('day');
  }

  function openAppointmentAt(date: string, time: string) {
    setLockedAppointmentSlot({ date, time });
    setForm((current) => ({
      ...current,
      appointment_date: date,
      appointment_time: time,
      status: current.status || 'confirmed'
    }));
    setOpen(true);
  }

  function closeAppointmentModal() {
    if (saving) return;
    setOpen(false);
    setLockedAppointmentSlot(null);
  }

  const calendarBaseDate = filters.date || todayISO();
  const calendarRange = getDateRange(calendarBaseDate, viewMode);
  const calendarDays = getCalendarDays(calendarRange.start, calendarRange.end);
  const rowsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    filteredRows.forEach((row) => {
      const bucket = map.get(row.appointment_date) || [];
      bucket.push(row);
      map.set(row.appointment_date, bucket);
    });
    return map;
  }, [filteredRows]);
  const allRowsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    rows.forEach((row) => {
      const bucket = map.get(row.appointment_date) || [];
      bucket.push(row);
      map.set(row.appointment_date, bucket);
    });
    return map;
  }, [rows]);
  const selectedDayRows = rowsByDate.get(calendarRange.start) || [];
  const selectedDayAllRows = allRowsByDate.get(calendarRange.start) || [];
  const dayTimeline = useMemo(
    () => makeDayTimeline(calendarRange.start, selectedDayRows, selectedDayAllRows, workingHours),
    [calendarRange.start, selectedDayRows, selectedDayAllRows, workingHours]
  );
  const calendarTitle = getCalendarTitle(calendarRange.start, calendarRange.end, viewMode);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!isOnline ? <span className="pending-sync-badge">وضع بدون اتصال: الإضافات الآمنة ستُحفظ مؤقتًا</span> : null}
        <div>
          <h1 className="text-3xl font-black">المواعيد</h1>
          <p className="text-slate-500">تنظيم المواعيد والحضور والتأكيد مع عرض يومي أو أسبوعي أو شهري.</p>
        </div>
      </div>

      {patients.length === 0 ? (
        <div className="premium-card border-warning/30 bg-warning/5">
          <p className="font-black text-warning">لا يمكن إضافة موعد قبل إضافة مريض.</p>
          <Link className="outline-btn mt-3" href="/patients"><Icon name="plus" /> إضافة مريض الآن</Link>
        </div>
      ) : null}

      <div className="premium-card">
        <div className="mb-5 grid gap-3 lg:grid-cols-[1.4fr_1fr_auto_1fr_1fr_1fr_auto]">
          <input
            className="soft-input"
            placeholder="بحث باسم المريض، الهاتف، الخدمة، الوقت..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <input className="soft-input number-ltr" type="date" value={filters.date} onChange={(e) => { const nextDate = e.target.value || todayISO(); setFilters({ ...filters, date: nextDate }); if (viewMode === 'day') showDayAppointments(nextDate); }} />
          <button type="button" className="outline-btn whitespace-nowrap" onClick={() => showDayAppointments(todayISO())}>اليوم</button>
          <select className="soft-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">كل الحالات</option>
            {appointmentStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select className="soft-input" value={filters.service_id} onChange={(e) => setFilters({ ...filters, service_id: e.target.value })}>
            <option value="">كل الخدمات</option>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
          <select className="soft-input" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as 'desc' | 'asc' })}>
            <option value="desc">الأحدث إلى الأقدم</option>
            <option value="asc">الأقدم إلى الأحدث</option>
          </select>
          <button className="outline-btn whitespace-nowrap" onClick={resetFilters}>مسح الفلاتر</button>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['day','week','month'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => { setViewMode(mode); if (!filters.date) setFilters((current) => ({ ...current, date: todayISO() })); if (mode === 'day') showDayAppointments(filters.date || todayISO()); }} className={`outline-btn px-4 py-2 text-sm ${viewMode === mode ? 'is-active-filter' : ''}`}>
                {mode === 'day' ? 'عرض يومي' : mode === 'week' ? 'عرض أسبوعي' : 'عرض شهري'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="outline-btn px-4 py-2 text-sm" onClick={() => showDayAppointments(todayISO())}>مواعيد اليوم</button>
            <span className="rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-slate-500">{filteredRows.length} موعد</span>
          </div>
        </div>

        <div className="appointment-calendar-title mb-4">
          <span>{calendarTitle.label}</span>
          <strong className="number-ltr">{calendarTitle.range}</strong>
        </div>

        {viewMode === 'day' ? (
          <div className="appointment-calendar-day mb-5">
            {dayTimeline.map((slot) => (
              <div key={slot.time} className={`appointment-time-slot ${slot.items.length ? 'has-appointment' : slot.isAvailable ? 'is-available' : 'is-unavailable'}`}>
                <div className="min-w-0 flex-1 w-full">
                  {slot.items.length ? slot.items.map((row) => (
                    <Link key={row.id} href={`/patients/profile?id=${row.patient_id}`} className="appointment-calendar-card booked-appointment-card">
                      <div className="appointment-card-top-row">
                        <span className="appointment-card-service">{row.services?.name || 'خدمة'}</span>
                        <span className="appointment-card-time number-ltr">{slot.time}</span>
                      </div>
                      <div className="appointment-card-main-row">
                        <strong>{row.patients?.full_name || 'مريض'}</strong>
                        <span className="appointment-card-status">{appointmentStatusLabels[row.status as keyof typeof appointmentStatusLabels] || row.status}</span>
                      </div>
                    </Link>
                  )) : slot.isAvailable ? (
                    <div className="appointment-add-slot-card">
                      <div className="appointment-slot-top-row">
                        <span className="appointment-slot-status">متاح</span>
                        <span className="appointment-slot-time number-ltr">{slot.time}</span>
                      </div>
                      <button type="button" className="appointment-slot-add-btn" onClick={() => openAppointmentAt(calendarRange.start, slot.time)}>
                        <Icon name="plus" className="h-4 w-4" />
                        إضافة موعد
                      </button>
                    </div>
                  ) : (
                    <div className="appointment-unavailable-card">
                      <div className="appointment-slot-top-row">
                        <span className="appointment-slot-status is-muted">غير متاح</span>
                        <span className="appointment-slot-time number-ltr">{slot.time}</span>
                      </div>
                      {slot.unavailableReason ? <span className="appointment-unavailable-reason">{slot.unavailableReason}</span> : null}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="appointment-calendar-grid mb-5">
            {calendarDays.map((date) => {
              const dayRows = rowsByDate.get(date) || [];
              const availableSlots = countAvailableSlots(date, allRowsByDate.get(date) || [], workingHours);
              return (
                <div
                  key={date}
                  role="button"
                  tabIndex={0}
                  onClick={() => showDayAppointments(date)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') showDayAppointments(date); }}
                  className={`appointment-calendar-cell is-clickable ${filters.date === date ? 'is-selected' : ''}`}
                  title="اضغط لعرض مواعيد هذا اليوم"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="grid gap-0.5 text-right">
                      <span className="text-sm font-black text-slate-900">{getArabicDayName(date)}</span>
                      <span className="number-ltr text-xs font-black text-slate-500">{date}</span>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-black text-primary">{dayRows.length} موعد</span>
                  </div>
                  <div className="appointment-available-count">
                    عدد المواعيد المتاحة: <span className="number-ltr">{availableSlots}</span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {dayRows.slice(0, 3).map((row) => (
                      <Link key={row.id} href={`/patients/profile?id=${row.patient_id}`} onClick={(event) => event.stopPropagation()} className="appointment-mini-card">
                        <span className="number-ltr">{row.appointment_time?.slice(0, 5)}</span>
                        <strong>{row.patients?.full_name || 'مريض'}</strong>
                      </Link>
                    ))}
                    {dayRows.length > 3 ? <span className="text-xs font-black text-slate-400 text-center">+{dayRows.length - 3} مواعيد أخرى</span> : null}
                    {!dayRows.length ? <span className="appointment-empty-day-message">لا توجد مواعيد محددة</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      <Modal open={!!statusMenuRow} title="تغيير حالة الموعد" onClose={() => setStatusMenuRow(null)}>
        {statusMenuRow ? (
          <div className="space-y-4 text-right">
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="font-black text-slate-900">{statusMenuRow.patients?.full_name || 'مريض'}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {statusMenuRow.services?.name || 'خدمة'} — {statusMenuRow.appointment_date} — {statusMenuRow.appointment_time?.slice(0, 5)}
              </p>
              <div className="mt-3">
                <StatusBadge tone={appointmentStatusTone(statusMenuRow.status)}>{appointmentStatusLabels[statusMenuRow.status as keyof typeof appointmentStatusLabels] || statusMenuRow.status}</StatusBadge>
              </div>
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
              <p className="font-black text-slate-900">{completionRow.patients?.full_name || 'المريض'}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {completionRow.services?.name || 'خدمة'} — {completionRow.appointment_date} — {completionRow.appointment_time?.slice(0, 5)}
              </p>
            </div>
            <label>
              <span className="mb-2 block font-bold">وصف مختصر لما تم إجراؤه في الجلسة</span>
              <textarea
                className="soft-input min-h-28"
                required
                placeholder="مثال: تم تنظيف الأسنان، إزالة الجير، فحص اللثة، أو تنفيذ جزء من خطة العلاج..."
                value={completionForm.procedure_done}
                onChange={(e) => setCompletionForm({ ...completionForm, procedure_done: e.target.value })}
              />
            </label>
            <label>
              <span className="mb-2 block font-bold">ملاحظات طبية للمريض</span>
              <textarea
                className="soft-input min-h-28"
                required
                placeholder="مثال: حساسية، ألم، توصيات، أدوية، تعليمات بعد الجلسة..."
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

      <Modal open={open} title="إضافة موعد" onClose={closeAppointmentModal}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <span className="mb-2 block font-bold">المريض</span>
            {selectedPatient ? (
              <div className="selected-patient-card">
                <div className="text-right">
                  <p className="font-black text-slate-900">{selectedPatient.full_name}</p>
                  <p className="mt-1 text-sm font-bold text-slate-500 number-ltr">{selectedPatient.phone || 'بدون هاتف'}</p>
                </div>
                <button type="button" className="outline-btn px-4 py-2" onClick={clearSelectedPatient}>تغيير المريض</button>
              </div>
            ) : (
              <div className="patient-combobox">
                <input
                  className="soft-input"
                  placeholder="ابحث باسم المريض أو رقم الهاتف..."
                  value={patientSearch}
                  onChange={(e) => {
                    setPatientSearch(e.target.value);
                    setForm((current) => ({ ...current, patient_id: '' }));
                  }}
                />
                {patientSearch.trim().length < 2 ? (
                  <div className="patient-search-hint">
                    اكتب حرفين على الأقل من اسم المريض أو رقم الهاتف لعرض النتائج.
                    <Link className="text-primary" href="/patients?new=1">إضافة مريض جديد</Link>
                  </div>
                ) : (
                  <div className="patient-search-results">
                    {patientResults.slice(0, 6).map((patient) => (
                      <button key={patient.id} type="button" className="patient-result-item" onClick={() => selectPatientForAppointment(patient)}>
                        <span className="patient-result-name">{patient.full_name}</span>
                        <span className="patient-result-phone number-ltr">{patient.phone || 'بدون هاتف'}</span>
                      </button>
                    ))}
                    {patientResults.length === 0 ? (
                      <div className="patient-no-result">
                        لا يوجد مريض مطابق. <Link className="text-primary" href="/patients?new=1">إضافة مريض جديد</Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          <label><span className="mb-2 block font-bold">الخدمة</span><select className="soft-input" required value={form.service_id} onChange={(e) => selectAppointmentService(e.target.value)}><option value="">اختر الخدمة</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label><span className="mb-2 block font-bold">التكلفة</span><input className="soft-input number-ltr" required type="number" min="0" step="0.01" value={form.treatment_cost} onChange={(e) => setForm({ ...form, treatment_cost: e.target.value })} /><span className="mt-2 block text-xs font-bold text-slate-500">تُملأ من التكلفة الافتراضية للخدمة ويمكن تعديلها قبل الحفظ.</span></label>
          {lockedAppointmentSlot ? (
            <div className="appointment-locked-slot-note md:col-span-2">
              تم اختيار الموعد تلقائيًا من بطاقة الوقت المتاح.
            </div>
          ) : (
            <>
              <label><span className="mb-2 block font-bold">التاريخ</span><input className="soft-input number-ltr" type="date" min={todayISO()} value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} /></label>
              <label><span className="mb-2 block font-bold">الوقت</span><input className="soft-input number-ltr" type="time" value={form.appointment_time} onChange={(e) => setForm({ ...form, appointment_time: e.target.value })} /></label>
            </>
          )}
          <label><span className="mb-2 block font-bold">حالة الموعد</span><select className="soft-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="confirmed">مؤكد</option><option value="pending">بانتظار التأكيد</option></select></label>
          <label className="md:col-span-2"><span className="mb-2 block font-bold">ملاحظات</span><textarea className="soft-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="md:col-span-2 flex justify-end"><button disabled={saving} className="premium-btn">{saving ? 'جاري الحفظ...' : 'حفظ الموعد'}</button></div>
        </form>
      </Modal>
    </div>
  );
}


function getArabicDayName(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-SY', { weekday: 'long' }).format(date);
}

function getArabicMonthName(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-SY', { month: 'long', year: 'numeric' }).format(date);
}

function getCalendarTitle(start: string, end: string, mode: 'day' | 'week' | 'month') {
  if (mode === 'day') {
    return { label: `مواعيد يوم ${getArabicDayName(start)}`, range: start };
  }
  if (mode === 'week') {
    return { label: `أسبوع يبدأ يوم ${getArabicDayName(start)}`, range: `${start} — ${end}` };
  }
  return { label: `مواعيد شهر ${getArabicMonthName(start)}`, range: `${start} — ${end}` };
}

function getDateRange(base: string, mode: 'day' | 'week' | 'month') {
  const date = new Date(`${base}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { start: todayISO(), end: todayISO() };
  if (mode === 'day') return { start: base, end: base };
  const start = new Date(date);
  const end = new Date(date);
  if (mode === 'week') {
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    end.setDate(start.getDate() + 6);
  } else {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }
  const toIso = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  return { start: toIso(start), end: toIso(end) };
}

function getCalendarDays(startIso: string, endIso: string) {
  const days: string[] = [];
  const current = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  while (current <= end && days.length < 42) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function minutesToTime(value: number) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getWorkingWindow(date: string, workingHours: WorkingHour[]) {
  const day = getDayOfWeek(date);
  const row = workingHours.find((item) => item.day_of_week === day);
  if (row && !row.is_open) return null;
  return {
    start: row?.start_time ? timeToMinutes(row.start_time) : 8 * 60,
    end: row?.end_time ? timeToMinutes(row.end_time) : 18 * 60,
    breakStart: row?.break_start ? timeToMinutes(row.break_start) : null,
    breakEnd: row?.break_end ? timeToMinutes(row.break_end) : null
  };
}

function appointmentBlocksSlot(slotStart: number, slotEnd: number, appointment: Appointment) {
  if (['cancelled', 'no_show'].includes(appointment.status)) return false;
  const start = timeToMinutes(appointment.appointment_time);
  const end = start + Math.max(5, Number(appointment.services?.duration_minutes || 30));
  return start < slotEnd && slotStart < end;
}

function isSlotInWorkingWindow(slotStart: number, slotEnd: number, window: NonNullable<ReturnType<typeof getWorkingWindow>>) {
  if (slotStart < window.start || slotEnd > window.end) return false;
  if (window.breakStart !== null && window.breakEnd !== null && slotStart < window.breakEnd && window.breakStart < slotEnd) return false;
  return true;
}

function isFutureSlot(date: string, time: string) {
  return new Date(`${date}T${time}:00`).getTime() > Date.now();
}

function makeDayTimeline(date: string, displayRows: Appointment[], allRows: Appointment[], workingHours: WorkingHour[]) {
  const sortedDisplay = [...displayRows].sort((a, b) => String(a.appointment_time).localeCompare(String(b.appointment_time)));
  const window = getWorkingWindow(date, workingHours);
  const appointmentStarts = allRows.map((row) => timeToMinutes(row.appointment_time));
  const appointmentEnds = allRows.map((row) => timeToMinutes(row.appointment_time) + Number(row.services?.duration_minutes || 30));
  const min = Math.min(window?.start ?? 8 * 60, ...appointmentStarts);
  const max = Math.max(window?.end ?? 18 * 60, ...appointmentEnds);
  const slots: Array<{ time: string; items: Appointment[]; isAvailable: boolean; unavailableReason?: string }> = [];

  for (let minute = min; minute <= max; minute += 30) {
    const slotEnd = minute + 30;
    const time = minutesToTime(minute);
    const items = sortedDisplay.filter((row) => appointmentBlocksSlot(minute, slotEnd, row));
    const isBusy = allRows.some((row) => appointmentBlocksSlot(minute, slotEnd, row));
    const isInsideWorkingWindow = Boolean(window && isSlotInWorkingWindow(minute, slotEnd, window));
    const isFuture = isFutureSlot(date, time);
    const isAvailable = Boolean(window && isInsideWorkingWindow && !isBusy && isFuture);
    let unavailableReason = '';
    if (!items.length && !isAvailable) {
      if (!window) unavailableReason = 'العيادة مغلقة في هذا اليوم';
      else if (!isInsideWorkingWindow) unavailableReason = 'خارج وقت الدوام أو ضمن الاستراحة';
      else if (!isFuture) unavailableReason = 'وقت سابق لا يمكن الحجز فيه';
      else if (isBusy) unavailableReason = 'محجوز بموعد آخر';
      else unavailableReason = 'غير قابل للحجز';
    }
    slots.push({ time, items, isAvailable, unavailableReason });
  }
  return slots;
}

function countAvailableSlots(date: string, rows: Appointment[], workingHours: WorkingHour[]) {
  const window = getWorkingWindow(date, workingHours);
  if (!window) return 0;
  let count = 0;
  for (let minute = window.start; minute + 30 <= window.end; minute += 30) {
    const slotEnd = minute + 30;
    const time = minutesToTime(minute);
    if (!isFutureSlot(date, time)) continue;
    if (!isSlotInWorkingWindow(minute, slotEnd, window)) continue;
    if (rows.some((row) => appointmentBlocksSlot(minute, slotEnd, row))) continue;
    count += 1;
  }
  return count;
}

export default function AppointmentsPage() {
  return <AppShell>{(ctx) => <AppointmentsContent {...ctx} />}</AppShell>;
}
