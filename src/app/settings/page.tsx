'use client';

import { useEffect, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { Modal } from '@/components/Modal';
import { AppShell, type AppContext } from '@/components/AppShell';
import { themes } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { currencies, getCurrencySymbol } from '@/lib/utils';
import { showToast } from '@/lib/toast';
import { exportPatientData } from '@/lib/patientExport';
import { buildPatientImportPreview, buildPatientImportTemplateCsv, parsePatientImportFile, type PatientImportPreviewRow } from '@/lib/patientImport';
import { logActivity } from '@/lib/audit';
import { uploadClinicAsset, uploadStaffAvatarAsset } from '@/lib/storageAssets';
import type { ThemeId } from '@/lib/types';


function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return message.includes('column') || message.includes('avatar_url') || message.includes('logo_url') || message.includes('schema cache');
}

function showSaveError(error: unknown) {
  const message = String((error as { message?: string; code?: string })?.message || '');
  const code = String((error as { code?: string })?.code || '');

  if (isMissingColumnError(error)) {
    showToast('تعذر حفظ الصورة', 'شغّل الملف supabase/professional_hardening_1_10.sql داخل Supabase ثم أعد المحاولة.', 'error');
    return;
  }

  if (message.includes('update_own_staff_avatar') || code === '42883') {
    showToast('تعذر حفظ صورة الطبيب', 'شغّل الملف supabase/doctor_profile_avatar_fix.sql داخل Supabase ثم أعد المحاولة.', 'error');
    return;
  }

  showToast('تعذر الحفظ', message || 'يرجى المحاولة مرة أخرى.', 'error');
}

function canManageClinicSettings(role?: string | null) {
  return role === 'admin' || role === 'doctor';
}

function PageContent({ clinic, staff, refreshClinic, refreshStaff }: AppContext) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    theme_id: 'dental-clean' as ThemeId,
    currency_code: 'SAR',
    currency_symbol: 'ر.س',
    logo_url: ''
  });
  const [personalTheme, setPersonalTheme] = useState<ThemeId>('dental-clean');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [clinicLogoFile, setClinicLogoFile] = useState<File | null>(null);
  const [savingClinic, setSavingClinic] = useState(false);
  const [savingProfileImage, setSavingProfileImage] = useState(false);
  const [savingClinicLogo, setSavingClinicLogo] = useState(false);
  const [exportingPatients, setExportingPatients] = useState<false | 'excel' | 'json' | 'zip'>(false);
  const [openImportPatients, setOpenImportPatients] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<PatientImportPreviewRow[]>([]);
  const [latestImportBatch, setLatestImportBatch] = useState<{ id: string; inserted_count: number; file_name?: string | null; created_at?: string | null } | null>(null);
  const [importingPatients, setImportingPatients] = useState(false);

  useEffect(() => {
    if (clinic) {
      const currencyCode = clinic.currency_code || 'SAR';
      setForm({
        name: clinic.name || '',
        phone: clinic.phone || '',
        address: clinic.address || '',
        theme_id: clinic.theme_id || 'dental-clean',
        currency_code: currencyCode,
        currency_symbol: getCurrencySymbol(currencyCode, clinic.currency_symbol),
        logo_url: clinic.logo_url || ''
      });
    }
  }, [clinic]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('dentalos-theme-preference') as ThemeId | null;
      setPersonalTheme(saved && themes.some((theme) => theme.id === saved) ? saved : 'dental-clean');
    } catch {
      setPersonalTheme('dental-clean');
    }
  }, []);


  useEffect(() => {
    async function loadLatestImportBatch() {
      if (!staff?.clinic_id || !canManageClinicSettings(staff?.role)) return;
      const { data } = await supabase
        .from('patient_import_batches')
        .select('id, inserted_count, file_name, created_at, status')
        .eq('clinic_id', staff.clinic_id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLatestImportBatch(data as any || null);
    }
    loadLatestImportBatch();
  }, [staff?.clinic_id, staff?.role]);

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
      reader.readAsDataURL(file);
    });
  }

  async function saveClinicIdentity(e?: React.FormEvent) {
    e?.preventDefault();
    if (!clinic) return;
    if (!canManageClinicSettings(staff?.role)) {
      showToast('صلاحية غير متاحة', 'تعديل اسم العيادة وبياناتها متاح للطبيب فقط.', 'warning');
      return;
    }
    setSavingClinic(true);
    try {
      const { error } = await supabase.from('clinics').update({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null
      }).eq('id', clinic.id);
      if (error) throw error;
      await refreshClinic();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingClinic(false);
    }
  }

  async function saveCurrency(e?: React.FormEvent) {
    e?.preventDefault();
    if (!clinic) return;
    if (!canManageClinicSettings(staff?.role)) {
      showToast('صلاحية غير متاحة', 'تغيير عملة العيادة متاح للطبيب فقط.', 'warning');
      return;
    }
    setSavingClinic(true);
    try {
      const { error } = await supabase.from('clinics').update({
        currency_code: form.currency_code,
        currency_symbol: form.currency_symbol
      }).eq('id', clinic.id);
      if (error) throw error;
      await refreshClinic();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingClinic(false);
    }
  }

  async function setClinicTheme(theme_id: ThemeId) {
    if (!canManageClinicSettings(staff?.role) || !clinic) return;
    setForm({ ...form, theme_id });
    const { error } = await supabase.from('clinics').update({ theme_id }).eq('id', clinic.id);
    if (error) showSaveError(error); else refreshClinic();
  }

  function setPersonalAppearance(theme_id: ThemeId) {
    setPersonalTheme(theme_id);
    try {
      window.localStorage.setItem('dentalos-theme-preference', theme_id);
      window.dispatchEvent(new CustomEvent('dentalos-theme-preference-changed', { detail: { themeId: theme_id } }));
    } catch {
      // ignore local storage limitations
    }
  }

  async function saveOwnStaffAvatar(avatar_url: string | null) {
    const { data, error } = await supabase.rpc('update_own_staff_avatar', { p_avatar_url: avatar_url });
    if (error) throw error;
    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error('لم يتم تحديث صورة الطبيب. تحقق من تشغيل ملف صلاحيات الصورة الشخصية في Supabase.');
    }
  }

  async function uploadStaffAvatar() {
    if (!staff || !avatarFile) return;
    if (!avatarFile.type.startsWith('image/')) { showToast('ملف غير مناسب', 'اختر صورة فقط.', 'warning'); return; }
    if (avatarFile.size > 1400 * 1024) { showToast('حجم الصورة كبير', 'اختر صورة أصغر من 1.4MB.', 'warning'); return; }
    setSavingProfileImage(true);
    try {
      const { url: avatar_url } = await uploadStaffAvatarAsset(staff.clinic_id, staff.id, avatarFile);
      await saveOwnStaffAvatar(avatar_url);
      setAvatarFile(null);
      await refreshStaff();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingProfileImage(false);
    }
  }

  async function removeStaffAvatar() {
    if (!staff) return;
    setSavingProfileImage(true);
    try {
      await saveOwnStaffAvatar(null);
      await refreshStaff();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingProfileImage(false);
    }
  }

  async function uploadClinicLogo() {
    if (!clinic || !clinicLogoFile) return;
    if (!canManageClinicSettings(staff?.role)) { showToast('صلاحية غير متاحة', 'تغيير شعار العيادة متاح للطبيب فقط.', 'warning'); return; }
    if (!clinicLogoFile.type.startsWith('image/')) { showToast('ملف غير مناسب', 'اختر صورة فقط.', 'warning'); return; }
    if (clinicLogoFile.size > 1800 * 1024) { showToast('حجم الصورة كبير', 'اختر صورة أصغر من 1.8MB.', 'warning'); return; }
    setSavingClinicLogo(true);
    try {
      const { url: logo_url } = await uploadClinicAsset(clinic.id, clinicLogoFile);
      const { error } = await supabase.from('clinics').update({ logo_url }).eq('id', clinic.id);
      if (error) throw error;
      setClinicLogoFile(null);
      setForm({ ...form, logo_url });
      await refreshClinic();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingClinicLogo(false);
    }
  }

  async function removeClinicLogo() {
    if (!clinic) return;
    if (!canManageClinicSettings(staff?.role)) { showToast('صلاحية غير متاحة', 'تغيير شعار العيادة متاح للطبيب فقط.', 'warning'); return; }
    setSavingClinicLogo(true);
    try {
      const { error } = await supabase.from('clinics').update({ logo_url: null }).eq('id', clinic.id);
      if (error) throw error;
      setForm({ ...form, logo_url: '' });
      await refreshClinic();
    } catch (error) {
      showSaveError(error);
    } finally {
      setSavingClinicLogo(false);
    }
  }


  async function handleImportFile(file: File | null) {
    setImportFile(file);
    setImportPreview([]);
    if (!file || !staff) return;
    try {
      const rows = await parsePatientImportFile(file);
      let existingPhones: string[] = [];
      if (rows.length) {
        const { data, error } = await supabase
          .from('patients')
          .select('phone')
          .eq('clinic_id', staff.clinic_id)
          .limit(10000);
        if (!error) existingPhones = (data || []).map((row: { phone?: string | null }) => row.phone || '').filter(Boolean);
      }
      const preview = buildPatientImportPreview(rows, existingPhones);
      setImportPreview(preview);
      const validCount = preview.filter((row) => row.can_import).length;
      if (!preview.length) showToast('لا توجد بيانات صالحة', 'تأكد من وجود أعمدة الاسم والهاتف داخل الملف.', 'warning');
      else if (validCount === 0) showToast('لا توجد صفوف قابلة للاستيراد', 'كل الصفوف ناقصة أو مكررة. راجع المعاينة قبل المتابعة.', 'warning');
    } catch (error) {
      showToast('تعذر قراءة الملف', String((error as { message?: string })?.message || error), 'error');
    }
  }

  function downloadImportTemplate() {
    const blob = new Blob([buildPatientImportTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dentalos-patients-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitPatientsImport(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !importFile) return;
    const validRows = importPreview.filter((row) => row.can_import);
    const blockedCount = importPreview.length - validRows.length;
    if (!validRows.length) {
      showToast('لا توجد صفوف قابلة للاستيراد', 'راجع الأخطاء والتكرارات في المعاينة قبل الاستيراد.', 'warning');
      return;
    }
    if (blockedCount > 0) {
      const ok = window.confirm(`سيتم استيراد ${validRows.length} مريض فقط، وتجاهل ${blockedCount} صف فيه خطأ أو تكرار. هل تريد المتابعة؟`);
      if (!ok) return;
    }
    setImportingPatients(true);
    try {
      const { data: batch, error: batchError } = await supabase.from('patient_import_batches').insert({
        clinic_id: staff.clinic_id,
        staff_id: staff.id,
        file_name: importFile.name,
        total_rows: importPreview.length,
        valid_rows: validRows.length,
        skipped_rows: blockedCount,
        status: 'processing'
      }).select('id').single();
      if (batchError) throw batchError;
      const batchId = (batch as { id: string }).id;
      const payload = validRows.map((row) => ({
        clinic_id: staff.clinic_id,
        full_name: row.full_name,
        phone: row.phone,
        address: row.address || null,
        medical_notes: row.medical_notes || null,
        status: 'active',
        import_batch_id: batchId
      }));
      const { error } = await supabase.from('patients').insert(payload);
      if (error) throw error;
      await supabase.from('patient_import_batches').update({ status: 'completed', inserted_count: payload.length }).eq('id', batchId).eq('clinic_id', staff.clinic_id);
      await logActivity(staff, 'patients_imported', 'patient', null, null, { count: payload.length, skipped: blockedCount, file_name: importFile.name, source: 'settings', import_batch_id: batchId });
      showToast('تم استيراد المرضى', `تمت إضافة ${payload.length} مريض.`, 'success');
      setLatestImportBatch({ id: batchId, inserted_count: payload.length, file_name: importFile.name, created_at: new Date().toISOString() });
      setOpenImportPatients(false);
      setImportFile(null);
      setImportPreview([]);
    } catch (error) {
      showToast('تعذر استيراد المرضى', String((error as { message?: string })?.message || error), 'error');
    } finally {
      setImportingPatients(false);
    }
  }

  async function rollbackLatestImportBatch() {
    if (!staff || !latestImportBatch) return;
    const ok = window.confirm(`سيتم حذف المرضى الذين أضيفوا في آخر عملية استيراد (${latestImportBatch.inserted_count} مريض) بشرط ألا يكون لهم مواعيد أو دفعات. هل تريد المتابعة؟`);
    if (!ok) return;
    setImportingPatients(true);
    try {
      const { error } = await supabase.rpc('rollback_patient_import_batch', { p_batch_id: latestImportBatch.id });
      if (error) throw error;
      await logActivity(staff, 'patients_import_rolled_back', 'patient_import_batch', latestImportBatch.id, latestImportBatch, null);
      showToast('تم التراجع عن آخر استيراد', 'تم حذف المرضى المستوردين الذين لا يملكون بيانات مرتبطة.', 'success');
      setLatestImportBatch(null);
    } catch (error) {
      showToast('تعذر التراجع عن الاستيراد', String((error as { message?: string })?.message || error), 'error');
    } finally {
      setImportingPatients(false);
    }
  }

  async function handlePatientExport(mode: 'excel' | 'json' | 'zip') {
    if (!staff) return;
    setExportingPatients(mode);
    try {
      await exportPatientData(staff, clinic, mode);
    } catch (error) {
      showToast('تعذر تصدير بيانات المرضى', String((error as { message?: string })?.message || 'حدث خطأ غير متوقع.'), 'error');
    } finally {
      setExportingPatients(false);
    }
  }

  function setCurrency(currency_code: string) {
    setForm({ ...form, currency_code, currency_symbol: getCurrencySymbol(currency_code) });
  }

  if (!canManageClinicSettings(staff?.role)) {
    return <AccessDenied title="الإعدادات غير متاحة" description="تعديل بيانات العيادة متاح للطبيب فقط." />;
  }

  const canEditClinic = canManageClinicSettings(staff?.role);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-black">الإعدادات</h1>
        <p className="text-slate-500">إدارة هوية العيادة، الصور، المظهر، والعملة.</p>
      </div>
      {!canEditClinic ? <span className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">تعديل هوية العيادة متاح للطبيب فقط</span> : null}
    </div>

    <section className="premium-card space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">هوية العيادة</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">من هنا يتم تغيير اسم العيادة والشعار الظاهر أعلى القائمة الجانبية.</p>
        </div>
        <div className="h-24 w-40 overflow-hidden rounded-3xl border border-border bg-muted shadow-subtle">
          {clinic?.logo_url ? <img src={clinic.logo_url} alt={clinic?.name || 'شعار العيادة'} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-center font-black text-primary">DentalOS<br/><span className="text-xs text-slate-500">الشعار الافتراضي</span></div>}
        </div>
      </div>

      <form onSubmit={saveClinicIdentity} className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="mb-2 block font-bold">اسم العيادة</span>
          <input className="soft-input" value={form.name} disabled={!canEditClinic || savingClinic} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="مثال: عيادة الابتسامة لطب الأسنان" />
        </label>
        <label>
          <span className="mb-2 block font-bold">هاتف العيادة</span>
          <input className="soft-input number-ltr" value={form.phone} disabled={!canEditClinic || savingClinic} onChange={e => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="md:col-span-2">
          <span className="mb-2 block font-bold">عنوان العيادة</span>
          <input className="soft-input" value={form.address} disabled={!canEditClinic || savingClinic} onChange={e => setForm({ ...form, address: e.target.value })} />
        </label>
        <div className="md:col-span-2 flex justify-end">
          <button type="submit" className="premium-btn" disabled={!canEditClinic || savingClinic}>{savingClinic ? 'جاري الحفظ...' : 'حفظ اسم وبيانات العيادة'}</button>
        </div>
      </form>

      <div className="rounded-3xl border border-border bg-white p-4">
        <div className="mb-3">
          <h3 className="text-lg font-black">شعار أو صورة غلاف العيادة</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">اختر صورة لتظهر أعلى القائمة الجانبية. عند إزالة الصورة يعود الشعار الافتراضي تلقائياً.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input className="soft-input" type="file" accept="image/*" disabled={!canEditClinic || savingClinicLogo} onChange={(e) => setClinicLogoFile(e.target.files?.[0] || null)} />
          <button type="button" className="premium-btn" onClick={uploadClinicLogo} disabled={!canEditClinic || !clinicLogoFile || savingClinicLogo}>{savingClinicLogo ? 'جاري الحفظ...' : 'حفظ شعار العيادة'}</button>
          <button type="button" className="outline-btn" onClick={removeClinicLogo} disabled={!canEditClinic || !clinic?.logo_url || savingClinicLogo}>استخدام الشعار الافتراضي</button>
        </div>
      </div>
    </section>

    <section className="premium-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">الصورة الشخصية</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">تظهر بجانب اسم المستخدم في الشريط العلوي.</p>
        </div>
        <div className="h-20 w-20 overflow-hidden rounded-full border border-border bg-primary/10 shadow-subtle">
          {staff?.avatar_url ? <img src={staff.avatar_url} alt="الصورة الشخصية" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center font-black text-primary">{staff?.full_name?.[0] || 'د'}</div>}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input className="soft-input" type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
        <button type="button" className="premium-btn" onClick={uploadStaffAvatar} disabled={!avatarFile || savingProfileImage}>{savingProfileImage ? 'جاري الحفظ...' : 'حفظ الصورة الشخصية'}</button>
        <button type="button" className="outline-btn" onClick={removeStaffAvatar} disabled={!staff?.avatar_url || savingProfileImage}>إزالة الصورة</button>
      </div>
    </section>

    <form onSubmit={saveCurrency} className="premium-card grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <h2 className="text-2xl font-black">العملة</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">تستخدم في الأسعار والدفعات والتقارير.</p>
      </div>
      <label>
        <span className="mb-2 block font-bold">عملة العيادة</span>
        <select className="soft-input" value={form.currency_code} disabled={!canEditClinic || savingClinic} onChange={(e) => setCurrency(e.target.value)}>
          {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.label} - {currency.symbol}</option>)}
        </select>
      </label>
      <label>
        <span className="mb-2 block font-bold">رمز العملة الظاهر</span>
        <input className="soft-input" value={form.currency_symbol} disabled={!canEditClinic || savingClinic} onChange={e => setForm({ ...form, currency_symbol: e.target.value })} />
      </label>
      <div className="md:col-span-2 flex justify-end"><button className="premium-btn" disabled={!canEditClinic || savingClinic}>{savingClinic ? 'جاري الحفظ...' : 'حفظ العملة'}</button></div>
    </form>


    <section className="premium-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">النسخ الاحتياطي والتصدير</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">تصدير كامل بيانات المرضى المرتبطة بهذه العيادة فقط، مع تسجيل العملية في سجل النشاط.</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <button type="button" className="premium-btn justify-center" onClick={() => setOpenImportPatients(true)}>
          استيراد مرضى Excel / CSV
        </button>
        <button type="button" className="outline-btn justify-center" onClick={() => handlePatientExport('excel')} disabled={Boolean(exportingPatients)}>
          {exportingPatients === 'excel' ? 'جاري تجهيز Excel...' : 'تصدير بيانات المرضى Excel'}
        </button>
        <button type="button" className="outline-btn justify-center" onClick={() => handlePatientExport('json')} disabled={Boolean(exportingPatients)}>
          {exportingPatients === 'json' ? 'جاري تجهيز النسخة...' : 'تصدير نسخة احتياطية JSON'}
        </button>
        <button type="button" className="outline-btn justify-center" onClick={() => handlePatientExport('zip')} disabled={Boolean(exportingPatients)}>
          {exportingPatients === 'zip' ? 'جاري تجهيز ZIP...' : 'تصدير نسخة ZIP كاملة'}
        </button>
      </div>
      <p className="mt-4 text-xs font-bold leading-6 text-slate-500">
        ملف Excel أصبح بصيغة XLSX حقيقية، وZIP يحتوي CSV وJSON والملفات الممكن تنزيلها من Storage.
      </p>
      {latestImportBatch ? <p className="mt-2 rounded-2xl border border-border bg-muted/40 p-3 text-xs font-black leading-6 text-slate-500">آخر استيراد: {latestImportBatch.file_name || 'ملف'} · عدد المرضى: {latestImportBatch.inserted_count}</p> : null}
    </section>

    <section className="premium-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">المظهر</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">هذا الاختيار خاص بهذا الجهاز فقط ولا يغير مظهر العيادة لباقي المستخدمين.</p>
        </div>
        <button type="button" onClick={() => setPersonalAppearance('dental-clean')} className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${personalTheme === 'dental-clean' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-slate-600 hover:bg-muted'}`}>
          استخدام الافتراضي
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {themes.map((theme) => {
          const active = personalTheme === theme.id;
          return <button key={theme.id} type="button" onClick={() => setPersonalAppearance(theme.id)} className={`rounded-3xl border p-4 text-right transition ${active ? 'border-primary bg-primary/10' : 'border-border bg-white hover:bg-muted'}`}>
            <div data-theme={theme.id} className="mb-3 flex gap-2"><span className="h-8 w-8 rounded-2xl bg-primary"/><span className="h-8 w-8 rounded-2xl bg-accent"/><span className="h-8 w-8 rounded-2xl bg-muted"/></div>
            <p className="font-black">{theme.name}</p>
            <p className="mt-2 text-xs text-slate-500">{theme.description}</p>
          </button>;
        })}
      </div>
    </section>

    <Modal open={openImportPatients} title="استيراد مرضى من Excel أو CSV" onClose={() => { if (!importingPatients) setOpenImportPatients(false); }}>
      <form onSubmit={submitPatientsImport} className="grid gap-4 text-right">
        <div className="rounded-2xl border border-border bg-muted/45 p-4 text-sm font-bold leading-7 text-slate-600">
          الاستيراد أصبح متاحاً من الإعدادات فقط حتى تبقى صفحة المرضى بسيطة. استخدم ملف CSV أو XLSX يحتوي الأعمدة: full_name, phone, address, medical_notes. يمكن أيضاً استخدام: الاسم، الهاتف، العنوان، ملاحظات.
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" className="outline-btn px-4 py-2 text-sm" onClick={downloadImportTemplate}>تحميل قالب CSV</button></div>
        <label><span className="mb-2 block text-sm font-bold">اختر الملف</span><input className="soft-input" type="file" accept=".xlsx,.csv,.txt,.tsv" onChange={(e) => handleImportFile(e.target.files?.[0] || null)} required /></label>
        {importPreview.length ? (
          <div className="rounded-2xl border border-border bg-white/75 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-black text-slate-600">معاينة أول {Math.min(importPreview.length, 8)} صفوف من أصل {importPreview.length}</p>
              <div className="flex flex-wrap gap-2 text-xs font-black">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">قابل للاستيراد: {importPreview.filter((row) => row.can_import).length}</span>
                <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">سيتم تجاهله: {importPreview.filter((row) => !row.can_import).length}</span>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-2xl border border-border bg-white">
              {importPreview.slice(0, 30).map((row) => <div key={row.row_number} className={`grid gap-2 border-b border-border p-3 text-sm font-bold last:border-b-0 ${row.can_import ? 'bg-white' : 'bg-rose-50/60'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{row.full_name || 'بدون اسم'} · <span className="number-ltr">{row.phone || 'بدون هاتف'}</span></span>
                  <span className={`rounded-full px-3 py-1 text-xs ${row.can_import ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{row.can_import ? 'جاهز' : 'يحتاج مراجعة'}</span>
                </div>
                {row.errors.length ? <p className="text-xs font-black leading-6 text-rose-700">الصف {row.row_number}: {row.errors.join('، ')}</p> : <p className="text-xs text-slate-400">{row.address || 'بدون عنوان'}</p>}
              </div>)}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {latestImportBatch ? <button type="button" className="ghost-btn text-danger" disabled={importingPatients} onClick={rollbackLatestImportBatch}>التراجع عن آخر استيراد</button> : <span />}
          <button className="premium-btn" disabled={importingPatients || !importPreview.some((row) => row.can_import)}>{importingPatients ? 'جاري الاستيراد...' : 'استيراد الصفوف الصالحة'}</button>
        </div>
      </form>
    </Modal>
  </div>;
}

export default function SettingsPage(){return <AppShell>{ctx => <PageContent {...ctx}/>}</AppShell>}
