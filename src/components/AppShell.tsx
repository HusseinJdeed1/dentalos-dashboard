'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Clinic, StaffUser, ThemeId, Role, Patient, Appointment, Service, TreatmentPlan } from '@/lib/types';
import { isRoleAllowed } from '@/lib/permissions';
import { clsx, todayISO } from '@/lib/utils';
import { appointmentStatusLabels, themes } from '@/lib/constants';
import { Icon } from './Icons';
import { LoadingIndicator } from './LoadingIndicator';
import { OfflineSyncStatus } from './OfflineSyncStatus';
import { cacheCoreContext, getCache, getOnlineStatus, offlineKeys, syncPendingOperations } from '@/lib/offline';

const nav: Array<{ href: string; label: string; icon: string; roles?: Role[] }> = [
  { href: '/dashboard', label: 'الرئيسية', icon: 'home' },
  { href: '/appointments', label: 'المواعيد', icon: 'calendar' },
  { href: '/working-hours', label: 'أوقات الدوام', icon: 'clock' },
  { href: '/patients', label: 'المرضى', icon: 'users' },
  { href: '/archive', label: 'الأرشيف', icon: 'archive', roles: ['admin','doctor'] },
  { href: '/treatment-plans', label: 'خطط العلاج', icon: 'tooth', roles: ['admin','doctor'] },
  { href: '/finance', label: 'الدفعات والأقساط', icon: 'card', roles: ['admin','doctor'] },
  { href: '/expenses', label: 'المصروفات', icon: 'wallet', roles: ['admin','doctor'] },
  { href: '/reports', label: 'التقارير', icon: 'chart', roles: ['admin','doctor'] },
  { href: '/activity', label: 'سجل النشاط', icon: 'history', roles: ['admin','doctor'] },
  { href: '/team', label: 'الفريق والصلاحيات', icon: 'users', roles: ['admin','doctor'] },
  { href: '/services', label: 'الخدمات', icon: 'tooth' },
  { href: '/settings', label: 'الإعدادات', icon: 'settings', roles: ['admin','doctor'] }
];


type SearchResult = {
  type: 'patient' | 'appointment';
  title: string;
  subtitle: string;
  href: string;
  badge: string;
  accent: 'patient' | 'appointment';
  meta?: string;
};

type AppointmentSearchRow = Appointment & {
  patients?: Patient | Patient[] | null;
  services?: Service | Service[] | null;
};

const OPEN_ALERT_STATUSES = ['pending', 'confirmed', 'arrived'];

function archiveThresholdISO() {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString().slice(0, 10);
}

function isPatientActive(patient: Patient) {
  return (patient.status || 'active') !== 'archived';
}

const arabicStatusSearch: Record<string, string> = {
  'بانتظار': 'pending',
  'انتظار': 'pending',
  'معلق': 'pending',
  'مؤكد': 'confirmed',
  'موكد': 'confirmed',
  'حضر': 'arrived',
  'وصل': 'arrived',
  'مكتمل': 'completed',
  'منتهي': 'completed',
  'ملغي': 'cancelled',
  'ملغى': 'cancelled',
  'لم يحضر': 'no_show'
};

function currentTimeForAlerts() {
  return new Date().toTimeString().slice(0, 8);
}

function countMissingVisitNotes(row: { procedure_done?: string | null; doctor_notes?: string | null }) {
  return !String(row.procedure_done || '').trim() || !String(row.doctor_notes || '').trim();
}

function escapeSearchTerm(value: string) {
  return value.replace(/[%,_]/g, '').trim();
}

function detectDateQuery(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function detectTimeQuery(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(ص|م|am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] || '00';
  const suffix = (match[3] || '').toLowerCase();
  if (suffix === 'م' || suffix === 'pm') {
    if (hour < 12) hour += 12;
  }
  if (suffix === 'ص' || suffix === 'am') {
    if (hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23 || Number(minute) > 59) return null;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function detectStatusQuery(value: string) {
  const q = value.trim().toLowerCase();
  if (['pending','confirmed','arrived','completed','cancelled','no_show'].includes(q)) return q;
  const found = Object.entries(arabicStatusSearch).find(([key]) => q.includes(key));
  return found?.[1] || null;
}

function normalizeAppointmentRow(row: AppointmentSearchRow): SearchResult {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  const service = Array.isArray(row.services) ? row.services[0] : row.services;
  const statusLabel = appointmentStatusLabels[row.status as keyof typeof appointmentStatusLabels] || row.status;
  const time = row.appointment_time?.slice(0, 5) || '';
  return {
    type: 'appointment',
    accent: 'appointment',
    badge: 'موعد',
    title: patient?.full_name ? `موعد ${patient.full_name}` : 'موعد',
    subtitle: `${row.appointment_date} · ${time} · ${service?.name || 'خدمة غير محددة'} · ${statusLabel}`,
    meta: patient?.phone ? `هاتف: ${patient.phone}` : 'اضغط لفتح ملف المريض المرتبط بالموعد',
    href: `/patients/profile?id=${row.patient_id}`
  };
}


function getInitials(name?: string | null) {
  const clean = String(name || '').trim();
  if (!clean) return 'د';
  return clean.split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
}

export type AppContext = { clinic: Clinic | null; staff: StaffUser | null; refreshClinic: () => Promise<void>; refreshStaff: () => Promise<void> };

export function AppShell({ children }: { children: (ctx: AppContext) => React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bootError, setBootError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [alertCount, setAlertCount] = useState(0);
  const [appearanceTheme, setAppearanceTheme] = useState<ThemeId>('dental-clean');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [managementNavOpen, setManagementNavOpen] = useState(false);
  const [offlineBoot, setOfflineBoot] = useState(false);

  useEffect(() => {
    function handleOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (userMenuOpen && !target.closest('[data-dropdown-root="user-menu"]')) setUserMenuOpen(false);
      if (searchOpen && !target.closest('[data-dropdown-root="global-search"]')) setSearchOpen(false);
      if (managementNavOpen && !target.closest('[data-dropdown-root="management-nav"]')) setManagementNavOpen(false);
    }

    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, [userMenuOpen, searchOpen, managementNavOpen]);

  async function refreshClinic() {
    if (!staff?.clinic_id) return;
    const { data, error } = await supabase.from('clinics').select('*').eq('id', staff.clinic_id).single();
    if (!error) setClinic(data as Clinic | null);
  }

  async function refreshStaff() {
    if (!staff?.id) return;
    const { data, error } = await supabase.from('staff_users').select('*').eq('id', staff.id).single();
    if (!error) setStaff(data as StaffUser | null);
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker registration skipped', error));
    }
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        setBootError('');

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) {
          router.replace('/login');
          return;
        }

        const { data, error } = await supabase.auth.getUser();
        if (error) {
          const message = String(error.message || '');
          const name = String(error.name || '');
          if (name === 'AuthSessionMissingError' || message.includes('Auth session missing')) {
            router.replace('/login');
            return;
          }
          throw error;
        }
        if (!data.user) { router.replace('/login'); return; }
        const { data: staffRow, error: staffError } = await supabase.from('staff_users').select('*').eq('user_id', data.user.id).single();
        if (staffError) throw staffError;
        if (!staffRow) { setLoading(false); return; }
        if (staffRow.is_active === false) {
          setBootError('تم تعطيل هذا الحساب من إدارة الفريق. تواصل مع الطبيب أو مدير العيادة.');
          setLoading(false);
          return;
        }
        setOfflineBoot(false);
        setStaff(staffRow as StaffUser);
        supabase.rpc('update_own_last_seen').then(() => undefined);
        const { data: clinicRow, error: clinicError } = await supabase.from('clinics').select('*').eq('id', staffRow.clinic_id).single();
        if (clinicError) throw clinicError;
        setClinic(clinicRow as Clinic | null);
        await cacheCoreContext(staffRow as StaffUser, clinicRow as Clinic | null);
        syncPendingOperations(staffRow.clinic_id).catch(() => undefined);
      } catch (error) {
        const message = String((error as { message?: string; name?: string })?.message || '');
        const name = String((error as { message?: string; name?: string })?.name || '');
        if (name === 'AuthSessionMissingError' || message.includes('Auth session missing')) {
          router.replace('/login');
          setLoading(false);
          return;
        }
        console.error('Boot failed', error);
        const [cachedStaff, cachedClinic] = await Promise.all([
          getCache<StaffUser>(offlineKeys.staff()),
          getCache<Clinic>(offlineKeys.clinic())
        ]);
        if (!getOnlineStatus() && cachedStaff && cachedClinic && cachedStaff.is_active !== false) {
          setStaff(cachedStaff);
          setClinic(cachedClinic);
          setOfflineBoot(true);
          setBootError('');
          return;
        }
        setBootError('تعذر الاتصال بالخادم أو قاعدة البيانات حالياً. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.');
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, [router]);

  useEffect(() => {
    async function loadAlertCount() {
      if (!staff?.clinic_id) return;
      try {
        const today = todayISO();
        const now = currentTimeForAlerts();

        const { data, error } = await supabase.rpc('dashboard_alert_counts');
        if (!error && Array.isArray(data) && data[0]) {
          const row = data[0] as Record<string, number>;
          setAlertCount(
            Number(row.pending_count || 0) +
            Number(row.today_open_count || 0) +
            Number(row.overdue_count || 0) +
            Number(row.no_show_followup_count || 0) +
            Number(row.missing_visit_notes_count || 0) +
            Number(row.active_plans_without_next_count || 0)
          );
          return;
        }

        const [allAppointmentsRes, upcomingRes, visitsRes, plansRes] = await Promise.all([
          supabase.from('appointments').select('id, patient_id, service_id, appointment_date, appointment_time, status').eq('clinic_id', staff.clinic_id).limit(120),
          supabase.from('appointments').select('patient_id, service_id').eq('clinic_id', staff.clinic_id).gte('appointment_date', today).in('status', OPEN_ALERT_STATUSES).limit(120),
          supabase.from('visits').select('id, procedure_done, doctor_notes').eq('clinic_id', staff.clinic_id).limit(120),
          isRoleAllowed(staff, ['admin', 'doctor'])
            ? supabase.from('treatment_plans').select('id, patient_id, service_id, status').eq('clinic_id', staff.clinic_id).eq('status', 'active').limit(120)
            : Promise.resolve({ data: [], error: null } as any)
        ]);

        const appointments = (allAppointmentsRes.data || []) as Array<{ patient_id: string; service_id?: string | null; appointment_date: string; appointment_time: string; status: string }>;
        const upcoming = (upcomingRes.data || []) as Array<{ patient_id: string; service_id?: string | null }>;
        const visits = (visitsRes.data || []) as Array<{ procedure_done?: string | null; doctor_notes?: string | null }>;
        const plans = (plansRes.data || []) as Array<{ patient_id: string; service_id?: string | null; status: string }>;
        const futurePatientIds = new Set(upcoming.map((row) => row.patient_id));
        const futurePatientServiceKeys = new Set(upcoming.map((row) => `${row.patient_id}:${row.service_id || 'none'}`));

        const pending = appointments.filter((row) => row.status === 'pending').length;
        const todayOpen = appointments.filter((row) => row.appointment_date === today && OPEN_ALERT_STATUSES.includes(row.status)).length;
        const overdue = appointments.filter((row) => {
          if (!OPEN_ALERT_STATUSES.includes(row.status)) return false;
          const appointmentTime = (row.appointment_time || '00:00:00').slice(0, 8);
          return row.appointment_date < today || (row.appointment_date === today && appointmentTime < now);
        }).length;
        const noShowNeedFollowup = appointments.filter((row) => row.status === 'no_show' && !futurePatientIds.has(row.patient_id)).length;
        const missingVisitNotes = visits.filter(countMissingVisitNotes).length;
        const activePlansWithoutNextAppointment = plans.filter((plan) => {
          if (plan.service_id && futurePatientServiceKeys.has(`${plan.patient_id}:${plan.service_id || 'none'}`)) return false;
          return !futurePatientIds.has(plan.patient_id);
        }).length;

        setAlertCount(pending + todayOpen + overdue + noShowNeedFollowup + missingVisitNotes + activePlansWithoutNextAppointment);
      } catch (error) {
        console.error('Alert count failed', error);
        setAlertCount(0);
      }
    }

    loadAlertCount();
  }, [staff?.clinic_id, staff?.role]);

  useEffect(() => {
    if (!staff?.clinic_id || !isRoleAllowed(staff, ['admin', 'doctor'])) return;
    supabase.rpc('archive_inactive_patients', { target_clinic_id: staff.clinic_id }).then(({ error }) => {
      if (error && !String(error.message || '').includes('Could not find the function')) {
        console.warn('Auto archive check failed', error.message);
      }
    });
  }, [staff?.clinic_id, staff?.role]);

  useEffect(() => {
    function applySavedTheme(themeId?: ThemeId | null) {
      try {
        const nextTheme = themeId === undefined
          ? window.localStorage.getItem('dentalos-theme-preference') as ThemeId | null
          : themeId;
        if (nextTheme && themes.some((themeItem) => themeItem.id === nextTheme)) {
          setAppearanceTheme(nextTheme);
        } else {
          setAppearanceTheme('dental-clean');
        }
      } catch {
        setAppearanceTheme('dental-clean');
      }
    }

    applySavedTheme();

    function handleThemeChange(event: Event) {
      const detail = (event as CustomEvent<{ themeId: ThemeId | null }>).detail;
      applySavedTheme(detail?.themeId ?? null);
    }

    window.addEventListener('dentalos-theme-preference-changed', handleThemeChange);
    return () => window.removeEventListener('dentalos-theme-preference-changed', handleThemeChange);
  }, []);

  useEffect(() => {
    if (!staff?.clinic_id) return;
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError('');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError('');
        const safeQuery = escapeSearchTerm(query);
        const dateQuery = detectDateQuery(safeQuery);
        const timeQuery = detectTimeQuery(safeQuery);
        const statusQuery = detectStatusQuery(safeQuery);

        const patientsRes = await supabase
          .from('patients')
          .select('id, full_name, phone')
          .eq('clinic_id', staff.clinic_id)
          .or(`full_name.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%`)
          .limit(8);

        if (patientsRes.error) throw patientsRes.error;

        const patients = (patientsRes.data || []) as Patient[];
        const patientIds = patients.map((patient) => patient.id);
        const appointmentMap = new Map<string, AppointmentSearchRow>();
        const appointmentSelect = 'id, patient_id, service_id, appointment_date, appointment_time, status, notes, patients(id,full_name,phone), services(id,name)';

        const appointmentQueries = [];

        if (patientIds.length) {
          appointmentQueries.push(
            supabase
              .from('appointments')
              .select(appointmentSelect)
              .eq('clinic_id', staff.clinic_id)
              .in('patient_id', patientIds)
              .order('appointment_date', { ascending: false })
              .limit(8)
          );
        }

        if (dateQuery) {
          appointmentQueries.push(
            supabase
              .from('appointments')
              .select(appointmentSelect)
              .eq('clinic_id', staff.clinic_id)
              .eq('appointment_date', dateQuery)
              .order('appointment_time', { ascending: true })
              .limit(8)
          );
        }

        if (timeQuery) {
          appointmentQueries.push(
            supabase
              .from('appointments')
              .select(appointmentSelect)
              .eq('clinic_id', staff.clinic_id)
              .eq('appointment_time', timeQuery)
              .order('appointment_date', { ascending: false })
              .limit(8)
          );
        }

        if (statusQuery) {
          appointmentQueries.push(
            supabase
              .from('appointments')
              .select(appointmentSelect)
              .eq('clinic_id', staff.clinic_id)
              .eq('status', statusQuery)
              .order('appointment_date', { ascending: false })
              .limit(8)
          );
        }

        appointmentQueries.push(
          supabase
            .from('appointments')
            .select(appointmentSelect)
            .eq('clinic_id', staff.clinic_id)
            .ilike('notes', `%${safeQuery}%`)
            .order('appointment_date', { ascending: false })
            .limit(6)
        );

        const servicesRes = await supabase
          .from('services')
          .select('id')
          .eq('clinic_id', staff.clinic_id)
          .ilike('name', `%${safeQuery}%`)
          .limit(8);

        if (!servicesRes.error && servicesRes.data?.length) {
          appointmentQueries.push(
            supabase
              .from('appointments')
              .select(appointmentSelect)
              .eq('clinic_id', staff.clinic_id)
              .in('service_id', servicesRes.data.map((service) => service.id))
              .order('appointment_date', { ascending: false })
              .limit(8)
          );
        }

        const appointmentResponses = await Promise.all(appointmentQueries);
        appointmentResponses.forEach((res) => {
          if (res.error) return;
          ((res.data || []) as unknown as AppointmentSearchRow[]).forEach((row) => appointmentMap.set(row.id, row));
        });

        if (cancelled) return;

        const patientItems: SearchResult[] = patients.map((patient) => ({
          type: 'patient',
          accent: 'patient',
          badge: 'مريض',
          title: patient.full_name,
          subtitle: patient.phone ? `رقم الهاتف: ${patient.phone}` : 'ملف مريض',
          meta: 'اضغط لفتح ملف المريض ومواعيده',
          href: `/patients/profile?id=${patient.id}`
        }));

        const appointmentItems = Array.from(appointmentMap.values()).slice(0, 10).map(normalizeAppointmentRow);

        setSearchResults([...appointmentItems, ...patientItems].slice(0, 12));
        setSearchOpen(true);
      } catch (error) {
        console.error('Search failed', error);
        if (!cancelled) {
          setSearchResults([]);
          setSearchError('تعذر تنفيذ البحث الآن. تحقق من اتصال Supabase ثم جرّب مرة أخرى.');
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, staff?.clinic_id]);

  function runSearch() {
    const first = searchResults[0];
    if (first) {
      setSearchOpen(false);
      setSearchQuery('');
      router.push(first.href);
      return;
    }
    if (searchQuery.trim()) {
      router.push(`/patients?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  }


  const managementNavHrefs = useMemo(() => new Set(['/working-hours', '/archive', '/treatment-plans', '/finance', '/expenses', '/reports', '/activity', '/team', '/settings']), []);
  const allowedQuickNav = useMemo(() => nav.filter((item) => isRoleAllowed(staff, item.roles) && !managementNavHrefs.has(item.href)), [staff, managementNavHrefs]);
  const allowedManagementNav = useMemo(() => nav.filter((item) => isRoleAllowed(staff, item.roles) && managementNavHrefs.has(item.href)), [staff, managementNavHrefs]);
  const managementIsActive = allowedManagementNav.some((item) => pathname === item.href);

  useEffect(() => {
    setManagementNavOpen(managementIsActive);
  }, [managementIsActive]);

  function renderNavItem(item: (typeof nav)[number], onClick?: () => void) {
    const isActive = pathname === item.href;
    const isSettings = item.href === '/settings';
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClick}
        className={clsx('flex items-center justify-between rounded-xl px-4 py-3.5 text-[15px] font-bold transition', isActive ? 'bg-gradient-to-l from-primary to-accent text-primaryForeground shadow-subtle' : 'text-slate-800 hover:bg-muted')}
      >
        <span>{item.label}</span>
        <span className={clsx('grid h-9 w-9 place-items-center rounded-xl transition', isSettings && !isActive ? 'bg-slate-100 text-slate-700' : isSettings && isActive ? 'bg-white/20 text-white' : '')}>
          <Icon name={item.icon} className={isSettings ? 'h-5 w-5' : 'h-6 w-6'} />
        </span>
      </Link>
    );
  }

  const theme = useMemo<ThemeId>(() => appearanceTheme || 'dental-clean', [appearanceTheme]);

  async function logout() { await supabase.auth.signOut(); router.replace('/login'); }

  if (loading) return (
    <div data-theme="dental-clean" className="grid min-h-screen place-items-center bg-background p-6">
      <div className="premium-card w-full max-w-sm text-center">
        <LoadingIndicator />
      </div>
    </div>
  );
  if (bootError) return <div data-theme="dental-clean" className="grid min-h-screen place-items-center p-6"><div className="premium-card max-w-xl text-center"><h1 className="text-xl font-black text-danger">تعذر فتح لوحة التحكم</h1><p className="mt-3 text-sm font-bold text-slate-500">{bootError}</p><button className="premium-btn mt-5" onClick={() => window.location.reload()}>إعادة المحاولة</button></div></div>;
  if (!staff) return <div data-theme="dental-clean" className="grid min-h-screen place-items-center p-6"><div className="premium-card max-w-xl"><h1 className="text-xl font-black">لم يتم ربط الحساب بعيادة</h1><p className="mt-3 text-sm text-slate-500">لم يتم ربط هذا الحساب بأي عيادة. تواصل مع مدير العيادة أو أضف الحساب من صفحة الفريق والصلاحيات.</p><button className="ghost-btn mt-5" onClick={logout}>تسجيل الخروج</button></div></div>;

  return <div data-theme={theme} className="min-h-screen bg-background">
    {mobileNavOpen ? (
      <div className="fixed inset-0 z-[130] xl:hidden" role="dialog" aria-modal="true">
        <button type="button" className="absolute inset-0 bg-slate-950/35" aria-label="إغلاق القائمة" onClick={() => setMobileNavOpen(false)} />
        <aside className="absolute right-0 top-0 h-full w-[min(86vw,330px)] overflow-y-auto border-l border-border bg-white px-5 py-6 shadow-premium">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <div className="text-right">
              <p className="text-sm font-black text-primary">{clinic?.name || 'DentalOS'}</p>
              <p className="text-xs font-bold text-slate-500">القائمة الرئيسية</p>
            </div>
            <button type="button" className="ghost-btn px-3 py-2" onClick={() => setMobileNavOpen(false)}>إغلاق</button>
          </div>
          <nav className="space-y-2">
            {allowedQuickNav.map((item) => renderNavItem(item, () => setMobileNavOpen(false)))}
            {allowedManagementNav.length ? (
              <details data-dropdown-root="management-nav" className="nav-management-group" open={managementNavOpen} onToggle={(event) => setManagementNavOpen((event.currentTarget as HTMLDetailsElement).open)}>
                <summary className={clsx('nav-management-summary', managementIsActive ? 'is-active' : '')}>
                  <span>الإدارة والمزيد</span>
                  <Icon name="chevronDown" className={clsx("dropdown-chevron h-4 w-4", managementNavOpen ? "is-open" : "")} />
                </summary>
                <div className="mt-2 space-y-2 border-r border-border pr-2">
                  {allowedManagementNav.map((item) => renderNavItem(item, () => setMobileNavOpen(false)))}
                </div>
              </details>
            ) : null}
          </nav>
        </aside>
      </div>
    ) : null}

    {/* RIGHT RED SECTION: fixed sidebar exactly like the reference */}
    <aside className="fixed right-0 top-0 z-50 hidden h-screen w-[320px] overflow-y-auto border-l border-border bg-white/95 px-5 py-6 pb-8 shadow-premium backdrop-blur xl:block">
      <div className="mb-7 flex flex-col items-center border-b border-border pb-6 text-center">
        {clinic?.logo_url ? (
          <div className="mb-3 h-28 w-full overflow-hidden rounded-3xl border border-border bg-muted shadow-subtle">
            <img src={clinic.logo_url} alt={clinic?.name || 'شعار العيادة'} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="mb-3 grid h-20 w-20 place-items-center text-primary">
            <svg viewBox="0 0 64 64" className="h-20 w-20" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M22 8c-8 0-14 7-14 17 0 8 4 15 6 22 2 6 3 11 8 11 4 0 4-12 10-12s6 12 10 12c5 0 6-5 8-11 2-7 6-14 6-22 0-10-6-17-14-17-4 0-7 2-10 4-3-2-6-4-10-4Z"/>
            </svg>
          </div>
        )}
        <p className="text-sm font-bold text-primary">{clinic?.name || 'لوحة تحكم عيادة الأسنان'}</p>
        <h1 className="text-xl font-black text-primary">DentalOS</h1>
      </div>


      <nav className="space-y-2">
        {allowedQuickNav.map((item) => renderNavItem(item))}
        {allowedManagementNav.length ? (
          <details data-dropdown-root="management-nav" className="nav-management-group" open={managementNavOpen} onToggle={(event) => setManagementNavOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary className={clsx('nav-management-summary', managementIsActive ? 'is-active' : '')}>
              <span>الإدارة والمزيد</span>
              <Icon name="chevronDown" className={clsx("dropdown-chevron h-4 w-4", managementNavOpen ? "is-open" : "")} />
            </summary>
            <div className="mt-2 space-y-2 border-r border-border pr-2">
              {allowedManagementNav.map((item) => renderNavItem(item))}
            </div>
          </details>
        ) : null}
      </nav>


    </aside>

    <div className="xl:mr-[320px]">
      {/* TOP RED SECTION: one horizontal bar above the dashboard content */}
      <header className="sticky top-0 z-[80] border-b border-border bg-white/90 px-4 py-3 shadow-subtle backdrop-blur lg:px-6">
        <div className="grid min-h-[60px] items-center gap-4 lg:grid-cols-[280px_minmax(320px,1fr)_320px]">
          <div className="flex items-center gap-3">
            <button type="button" className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-white xl:hidden" onClick={() => setMobileNavOpen(true)} aria-label="فتح القائمة">☰</button>
            <div className="relative" data-dropdown-root="user-menu">
              <button
                type="button"
                onClick={() => setUserMenuOpen((value) => !value)}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-white transition hover:bg-muted"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                title="قائمة الحساب"
              >
                <Icon name="chevronDown" className={clsx("dropdown-chevron h-5 w-5", userMenuOpen ? "is-open" : "")} />
              </button>
              {userMenuOpen ? (
                <div className="absolute right-0 top-[54px] z-[120] w-[210px] rounded-3xl border border-border bg-white p-2 text-right shadow-premium" role="menu">
                  {isRoleAllowed(staff, ['admin','doctor']) ? (
                    <Link href="/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 text-sm font-black text-slate-800 transition hover:bg-muted" role="menuitem">
                      <span>الإعدادات</span>
                      <Icon name="settings" className="h-5 w-5 text-primary" />
                    </Link>
                  ) : null}
                  <button type="button" onClick={logout} className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-sm font-black text-danger transition hover:bg-danger/10" role="menuitem">
                    <span>تسجيل الخروج</span>
                    <Icon name="logout" className="h-5 w-5 text-danger" />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="h-11 w-11 overflow-hidden rounded-full bg-slate-200">
              {staff.avatar_url ? (
                <img src={staff.avatar_url} alt={staff.full_name || 'الصورة الشخصية'} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center bg-gradient-to-br from-sky-100 to-primary/20 font-black text-primary">{getInitials(staff.full_name)}</div>
              )}
            </div>
            <span className="whitespace-nowrap font-black text-slate-900">{staff.full_name || 'المستخدم'}</span>
            <Link href="/alerts" className="relative grid h-12 w-12 place-items-center rounded-2xl border border-border bg-white" title={`عدد التنبيهات: ${alertCount}`}>
              <Icon name="bell" className="h-6 w-6"/>
              {alertCount > 0 ? (
                <span dir="ltr" className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-black leading-none text-white shadow-subtle">{alertCount > 99 ? '+99' : alertCount}</span>
              ) : null}
            </Link>
          </div>

          <div className="relative mx-auto w-full max-w-[520px]" data-dropdown-root="global-search">
            <input
              className="soft-input h-12 bg-white pr-12 text-center"
              placeholder="ابحث عن مريض، موعد، فاتورة..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch();
                if (e.key === 'Escape') setSearchOpen(false);
              }}
            />
            <button type="button" onClick={runSearch} className="absolute right-3 top-3 grid h-6 w-6 place-items-center text-slate-500" aria-label="بحث">
              <Icon name="search" className="h-5 w-5" />
            </button>
            {searchOpen && searchQuery.trim().length >= 2 ? (
              <div className="absolute left-0 right-0 top-[56px] z-[70] max-h-[420px] overflow-y-auto rounded-2xl border border-border bg-white text-right shadow-premium">
                {searchLoading ? <div className="p-4"><LoadingIndicator label="جاري البحث..." compact /></div> : null}
                {searchError && !searchLoading ? <div className="p-4 text-sm font-bold text-danger">{searchError}</div> : null}
                {!searchLoading && !searchError && searchResults.length === 0 ? <div className="p-4 text-sm font-bold text-slate-500">لا توجد نتائج مطابقة</div> : null}
                {!searchLoading && !searchError && searchResults.map((item, index) => (
                  <Link
                    key={`${item.href}-${index}-${item.subtitle}`}
                    href={item.href}
                    onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                    className="search-result-item"
                  >
                    <div className={`search-result-badge ${item.accent === 'appointment' ? 'search-result-badge-appointment' : 'search-result-badge-patient'}`}>
                      {item.badge}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-black text-slate-900">{item.title}</p>
                        <Icon name={item.type === 'appointment' ? 'calendar' : 'users'} className="h-5 w-5 shrink-0 text-primary" />
                      </div>
                      <p className="mt-1 truncate text-xs font-bold text-slate-500">{item.subtitle}</p>
                      {item.meta ? <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">{item.meta}</p> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="hidden items-center justify-between gap-3 rounded-2xl border border-border bg-white px-4 py-2.5 lg:flex">
            <Icon name="chevronDown" className="h-4 w-4 text-slate-500" />
            <span className="font-black">{clinic?.name || 'لوحة العيادة'}</span>
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon name="hospital" /></div>
          </div>
        </div>
      </header>

      <OfflineSyncStatus staff={staff} />
      {offlineBoot ? (
        <div className="mx-4 mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-right text-sm font-bold text-slate-700 lg:mx-5 2xl:mx-6">
          تعمل الآن من نسخة محفوظة محليًا. العمليات الآمنة ستُحفظ مؤقتًا وتُزامن عند عودة الإنترنت.
        </div>
      ) : null}
      <main className="overflow-x-auto p-4 lg:p-5 2xl:p-6">{children({ clinic, staff, refreshClinic, refreshStaff })}</main>
    </div>
  </div>;
}
