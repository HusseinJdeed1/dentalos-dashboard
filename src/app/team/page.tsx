'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { isRoleAllowed } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import type { Role, StaffUser } from '@/lib/types';

const roleLabels: Record<Role, string> = { admin: 'مدير', doctor: 'طبيب', secretary: 'سكرتيرة' };

type TeamForm = {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: Role;
  is_active: boolean;
};

const emptyForm: TeamForm = {
  email: '',
  password: '',
  full_name: '',
  phone: '',
  role: 'secretary',
  is_active: true
};

async function parseFunctionError(error: unknown, fallback: string) {
  let message = String((error as { message?: string })?.message || fallback);
  const context = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
  if (context?.json) {
    try {
      const details = await context.json();
      if (details?.error) message = details.error;
    } catch {
      // keep fallback
    }
  }
  return message;
}

function PageContent({ staff }: AppContext) {
  const canManage = isRoleAllowed(staff, ['admin', 'doctor']);
  const [rows, setRows] = useState<StaffUser[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [form, setForm] = useState<TeamForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const availableRoles = useMemo(() => {
    const base: Array<{ value: Role; label: string }> = [
      { value: 'secretary', label: 'سكرتيرة' },
      { value: 'doctor', label: 'طبيب' }
    ];
    if (staff?.role === 'admin') base.push({ value: 'admin', label: 'مدير' });
    return base;
  }, [staff?.role]);

  async function load() {
    if (!staff || !canManage) return;
    const { data, error } = await supabase.from('staff_users').select('*').eq('clinic_id', staff.clinic_id).order('created_at', { ascending: false });
    if (error) showToast('تعذر تحميل الفريق', error.message, 'error');
    setRows((data || []) as StaffUser[]);
  }

  useEffect(() => { load(); }, [staff?.clinic_id, canManage]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row: StaffUser) {
    setEditing(row);
    setForm({
      email: row.email || '',
      password: '',
      full_name: row.full_name || '',
      phone: row.phone || '',
      role: row.role,
      is_active: row.is_active !== false
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setSaving(false);
  }

  async function createStaffMember() {
    if (!staff) return;
    const email = form.email.trim().toLowerCase();
    const password = form.password.trim();
    const full_name = form.full_name.trim();
    const phone = form.phone.trim();

    if (!email || !email.includes('@')) throw new Error('أدخل بريدًا إلكترونيًا صحيحًا للموظف.');
    if (!password || password.length < 8) throw new Error('كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل.');
    if (!full_name) throw new Error('أدخل الاسم الكامل للموظف.');
    if (form.role === 'admin' && staff.role !== 'admin') throw new Error('إضافة مدير متاحة للمدير فقط.');

    const { data, error } = await supabase.functions.invoke('create-staff-member', {
      body: {
        email,
        password,
        full_name,
        phone: phone || null,
        role: form.role,
        is_active: form.is_active
      }
    });

    if (error) throw new Error(await parseFunctionError(error, 'تعذر إنشاء حساب الموظف.'));
    const response = data as { staff?: StaffUser; error?: string } | null;
    if (response?.error) throw new Error(response.error);

    showToast('تم إنشاء حساب الموظف', 'أرسل البريد وكلمة المرور المؤقتة للموظف ليتمكن من تسجيل الدخول.', 'success');
  }

  async function updateStaffMember() {
    if (!staff || !editing) return;
    if (editing.id === staff.id && (form.role !== editing.role || form.is_active === false)) {
      throw new Error('لا يمكنك تغيير دور حسابك الحالي أو تعطيله من نفس الحساب.');
    }
    if (editing.role === 'admin' && staff.role !== 'admin') throw new Error('تعديل حساب المدير متاح للمدير فقط.');
    if (form.role === 'admin' && staff.role !== 'admin') throw new Error('تحويل المستخدم إلى مدير متاح للمدير فقط.');

    const payload = {
      staff_id: editing.id,
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      role: form.role,
      is_active: form.is_active
    };

    const { error } = await supabase.functions.invoke('update-staff-member', { body: payload });
    if (error) throw new Error(await parseFunctionError(error, 'تعذر تعديل حساب الموظف.'));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    setSaving(true);
    try {
      if (editing) await updateStaffMember();
      else await createStaffMember();
      closeModal();
      await load();
    } catch (error) {
      showToast('تعذر حفظ الموظف', String((error as { message?: string })?.message || 'حدث خطأ غير متوقع.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: StaffUser) {
    if (!staff) return;
    if (row.id === staff.id) {
      showToast('لا يمكن تعطيل حسابك الحالي', 'استخدم حساب مدير آخر لتغيير حالة هذا الحساب.', 'warning');
      return;
    }
    const next = row.is_active === false;
    const { error } = await supabase.functions.invoke('set-staff-active', { body: { staff_id: row.id, is_active: next } });
    if (error) {
      showToast('تعذر تغيير حالة الحساب', await parseFunctionError(error, 'تعذر تغيير حالة الحساب.'), 'error');
      return;
    }
    load();
  }

  if (!canManage) return <AccessDenied title="إدارة الفريق غير متاحة" description="إدارة الفريق والصلاحيات متاحة للطبيب أو المدير فقط." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-right">
          <h1 className="text-3xl font-black">الفريق والصلاحيات</h1>
          <p className="mt-2 text-slate-500">إضافة طاقم العمل وإدارة الأدوار بدون حاجة الطبيب للوصول إلى Supabase أو نسخ أي user_id.</p>
        </div>
        <button className="premium-btn" onClick={openCreate}><Icon name="plus" /> إضافة موظف</button>
      </div>

      <section className="rounded-3xl border border-primary/20 bg-primary/5 p-5 text-right text-sm font-bold leading-7 text-slate-600">
        عند إضافة موظف، أدخل الاسم والبريد وكلمة المرور المؤقتة فقط. سيتم إنشاء حساب الدخول وربطه بالعيادة تلقائيًا عبر دالة آمنة على Supabase Edge Functions.
      </section>

      <section className="premium-card">
        {rows.length ? (
          <div className="data-table-card">
            <table className="data-table">
              <thead>
                <tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الهاتف</th><th>الحالة</th><th>الإجراءات</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const canEditRow = staff?.role === 'admin' || row.role !== 'admin';
                  return (
                    <tr key={row.id}>
                      <td className="font-black">{row.full_name}</td>
                      <td className="number-ltr text-sm">{row.email || '—'}</td>
                      <td>{roleLabels[row.role]}</td>
                      <td className="number-ltr">{row.phone || '—'}</td>
                      <td><StatusBadge tone={row.is_active === false ? 'warning' : 'success'}>{row.is_active === false ? 'معطّل' : 'نشط'}</StatusBadge></td>
                      <td>
                        <div className="table-actions-row">
                          <button className="outline-btn table-action-btn" onClick={() => openEdit(row)} disabled={!canEditRow}>تعديل</button>
                          <button className="ghost-btn table-action-btn text-danger" onClick={() => toggleActive(row)} disabled={row.id === staff?.id || !canEditRow}>{row.is_active === false ? 'تفعيل' : 'تعطيل'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="لا يوجد أعضاء فريق" description="أضف الموظف من هذه الصفحة بالبريد وكلمة مرور مؤقتة فقط." />}
      </section>

      <Modal open={open} title={editing ? 'تعديل موظف' : 'إضافة موظف جديد'} onClose={closeModal}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="mb-2 block text-sm font-bold">البريد الإلكتروني</span>
            <input className="soft-input number-ltr" type="email" required={!editing} disabled={!!editing || saving} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="staff@example.com" />
          </label>
          {!editing ? (
            <label>
              <span className="mb-2 block text-sm font-bold">كلمة مرور مؤقتة</span>
              <input className="soft-input number-ltr" type="password" required minLength={8} disabled={saving} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 أحرف على الأقل" />
            </label>
          ) : null}
          <label>
            <span className="mb-2 block text-sm font-bold">الاسم الكامل</span>
            <input className="soft-input" required disabled={saving} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">الهاتف</span>
            <input className="soft-input number-ltr" disabled={saving} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">الدور</span>
            <select className="soft-input" disabled={saving || editing?.id === staff?.id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {availableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-3 md:col-span-2">
            <input type="checkbox" checked={form.is_active} disabled={saving || editing?.id === staff?.id} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span className="font-bold">الحساب نشط</span>
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button className="premium-btn" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إنشاء الحساب'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function TeamPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
