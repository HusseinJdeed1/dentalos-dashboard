'use client';

import { useEffect, useState } from 'react';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import type { Service } from '@/lib/types';
import { formatMoney, getCurrencySymbol } from '@/lib/utils';
import { canChangeServiceSafely, requestActionConfirmation, requestPasswordConfirmation, showSecureMessage } from '@/lib/secureActions';

const serviceCategoryLabels: Record<string, string> = {
  consultation: 'استشارة',
  cleaning: 'تنظيف',
  filling: 'حشوات',
  root_canal: 'معالجة عصب',
  orthodontics: 'تقويم',
  implant: 'زرعات',
  whitening: 'تبييض',
  other: 'أخرى'
};

const categories = [
  { value: 'consultation', label: 'استشارة' },
  { value: 'cleaning', label: 'تنظيف' },
  { value: 'filling', label: 'حشوات' },
  { value: 'root_canal', label: 'معالجة عصب' },
  { value: 'orthodontics', label: 'تقويم' },
  { value: 'implant', label: 'زرعات' },
  { value: 'whitening', label: 'تبييض' },
  { value: 'other', label: 'أخرى' }
];

type ServiceForm = { name: string; category: string; duration_minutes: string; price: string; description: string; is_active: boolean };
const emptyForm: ServiceForm = { name: '', category: 'consultation', duration_minutes: '30', price: '', description: '', is_active: true };

function PageContent({ staff, clinic }: AppContext) {
  const [rows, setRows] = useState<Service[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);

  async function load() {
    if (!staff) return;
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('clinic_id', staff.clinic_id)
      .order('name');
    if (error) showToast('تعذر تنفيذ العملية', error.message, 'error');
    setRows((data || []) as Service[]);
  }

  useEffect(() => { load(); }, [staff?.clinic_id]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  async function openEdit(service: Service) {
    if (!staff) return;
    const check = await canChangeServiceSafely(staff.clinic_id, service.id, 'تعديل الخدمة');
    if (!check.ok) {
      await showSecureMessage('لا يمكن تعديل الخدمة', check.message);
      return;
    }
    setEditing(service);
    setForm({
      name: service.name || '',
      category: service.category || 'other',
      duration_minutes: String(service.duration_minutes || 30),
      price: String(service.price ?? ''),
      description: service.description || '',
      is_active: Boolean(service.is_active)
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      await showSecureMessage('بيانات غير مكتملة', 'أدخل تكلفة افتراضية صحيحة للخدمة.');
      return;
    }

    if (editing) {
      const check = await canChangeServiceSafely(staff.clinic_id, editing.id, 'تعديل الخدمة');
      if (!check.ok) {
        await showSecureMessage('لا يمكن تعديل الخدمة', check.message);
        return;
      }
    }

    const ok = await requestPasswordConfirmation(editing ? 'تعديل خدمة' : 'إضافة خدمة');
    if (!ok) return;

    const payload = {
      clinic_id: staff.clinic_id,
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes || 30),
      price,
      is_active: form.is_active,
      is_installment_available: ['orthodontics', 'implant', 'root_canal'].includes(form.category)
    };

    const request = editing
      ? supabase.from('services').update(payload).eq('clinic_id', staff.clinic_id).eq('id', editing.id)
      : supabase.from('services').insert(payload);

    const { error } = await request;
    if (error) {
      await showSecureMessage('تعذر حفظ الخدمة', error.message);
      return;
    }
    closeModal();
    load();
  }

  async function deleteService(service: Service) {
    if (!staff) return;
    const check = await canChangeServiceSafely(staff.clinic_id, service.id, 'حذف الخدمة');
    if (!check.ok) {
      await showSecureMessage('لا يمكن حذف الخدمة', check.message);
      return;
    }

    const ok = await requestPasswordConfirmation('حذف خدمة');
    if (!ok) return;
    const confirmed = await requestActionConfirmation(
      'تأكيد حذف الخدمة',
      `تم التحقق من عدم وجود مواعيد غير مكتملة أو ملفات مالية غير مكتملة مرتبطة بالخدمة "${service.name}". هل تريد حذفها؟`,
      'حذف الخدمة'
    );
    if (!confirmed) return;
    const { error } = await supabase.from('services').delete().eq('clinic_id', staff.clinic_id).eq('id', service.id);
    if (error) {
      await showSecureMessage('تعذر حذف الخدمة', error.message);
      return;
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">الخدمات</h1>
          <p className="text-slate-500">إدارة قائمة خدمات العيادة مع التكلفة الافتراضية التي تُستخدم عند إنشاء خطة علاج من الموعد.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="premium-btn" onClick={openCreate}><Icon name="plus" /> إضافة خدمة</button>
        </div>
      </div>

      <div className="premium-card">
        <div className="data-table-card services-table-card">
          <table className="data-table services-table">
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
          <thead>
            <tr>
              <th>الخدمة</th>
              <th className="text-center">التصنيف</th>
              <th className="text-center">التكلفة الافتراضية</th>
              <th className="text-center">المدة</th>
              <th className="text-center">الحالة</th>
              <th className="text-center">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-black">{r.name}</td>
                <td className="text-center">{serviceCategoryLabels[r.category || ''] || r.category || '—'}</td>
                <td className="text-center"><span className="number-ltr">{formatMoney(r.price || 0, currencySymbol)}</span></td>
                <td className="text-center"><span className="number-ltr">{r.duration_minutes}</span> دقيقة</td>
                <td className="text-center"><StatusBadge tone={r.is_active ? 'success' : 'muted'}>{r.is_active ? 'مفعلة' : 'معطلة'}</StatusBadge></td>
                <td>
                  <div className="service-row-actions">
                    <button className="outline-btn service-action-btn" onClick={() => openEdit(r)}>تعديل</button>
                    <button className="ghost-btn service-action-btn text-danger" onClick={() => deleteService(r)}>حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          {!rows.length ? <p className="py-8 text-center text-slate-500">لا توجد خدمات بعد.</p> : null}
        </div>
      </div>

      <Modal open={open} title={editing ? 'تعديل خدمة' : 'إضافة خدمة'} onClose={closeModal}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">اسم الخدمة</span><input className="soft-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label><span className="mb-2 block text-sm font-bold">التصنيف</span><select className="soft-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          <label><span className="mb-2 block text-sm font-bold">مدة الموعد بالدقائق</span><input className="soft-input number-ltr" type="number" min="5" step="5" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></label>
          <label><span className="mb-2 block text-sm font-bold">التكلفة الافتراضية</span><input className="soft-input number-ltr" required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
          <label><span className="mb-2 block text-sm font-bold">الحالة</span><select className="soft-input" value={form.is_active ? 'active' : 'inactive'} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}><option value="active">مفعلة</option><option value="inactive">معطلة</option></select></label>
          <label className="md:col-span-2"><span className="mb-2 block text-sm font-bold">وصف اختياري</span><textarea className="soft-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="md:col-span-2 flex justify-end"><button className="premium-btn">{editing ? 'حفظ التعديل' : 'حفظ الخدمة'}</button></div>
        </form>
      </Modal>
    </div>
  );
}

export default function ServicesPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
