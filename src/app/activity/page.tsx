'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { ActivityLog } from '@/lib/types';
import { formatDate } from '@/lib/utils';

type ActivityFilter = { action: string; entity: string; search: string };

const actionLabels: Record<string, string> = {
  appointment_created: 'إضافة موعد',
  appointment_updated: 'تعديل موعد',
  appointment_status_updated: 'تغيير حالة موعد',
  appointment_completed: 'إنهاء موعد',
  appointment_cancelled: 'إلغاء موعد',
  patient_created: 'إضافة مريض',
  patient_updated: 'تعديل بيانات مريض',
  patient_deleted: 'حذف مريض',
  patient_archived: 'أرشفة مريض',
  patient_unarchived: 'إزالة الأرشفة',
  patient_file_uploaded: 'رفع ملف للمريض',
  patient_file_deleted: 'حذف ملف من المريض',
  patient_medical_notes_updated: 'تعديل ملاحظات طبية',
  patients_imported: 'استيراد مرضى',
  patient_import_undone: 'التراجع عن استيراد مرضى',
  treatment_plan_created: 'إضافة خطة علاج',
  treatment_plan_updated: 'تعديل خطة علاج',
  treatment_plan_deleted: 'حذف خطة علاج',
  installment_created: 'إضافة قسط',
  installment_updated: 'تعديل قسط',
  installment_deleted: 'حذف قسط',
  payment_created: 'إضافة دفعة',
  payment_updated: 'تعديل دفعة',
  payment_deleted: 'حذف دفعة',
  receipt_printed: 'طباعة إيصال',
  visit_created: 'إضافة جلسة',
  visit_notes_updated: 'تعديل جلسة',
  visit_teeth_updated: 'تحديث أسنان الجلسة',
  dental_chart_updated: 'تحديث مخطط الأسنان',
  staff_created: 'إضافة موظف',
  staff_updated: 'تعديل موظف',
  staff_disabled: 'تعطيل موظف',
  staff_enabled: 'تفعيل موظف',
  settings_updated: 'تعديل الإعدادات',
  export_patients: 'تصدير بيانات المرضى'
};

const entityLabels: Record<string, string> = {
  appointment: 'المواعيد',
  patient: 'المرضى',
  patient_file: 'ملفات المرضى',
  treatment_plan: 'خطط العلاج',
  installment: 'الأقساط',
  payment: 'الدفعات',
  visit: 'الجلسات',
  dental_chart: 'مخطط الأسنان',
  visit_tooth: 'أسنان الجلسة',
  staff: 'الفريق',
  settings: 'الإعدادات',
  export: 'التصدير',
  import: 'الاستيراد'
};

const valueLabels: Record<string, string> = {
  full_name: 'الاسم',
  phone: 'الهاتف',
  address: 'العنوان',
  medical_notes: 'الملاحظات الطبية',
  status: 'الحالة',
  appointment_date: 'تاريخ الموعد',
  appointment_time: 'وقت الموعد',
  service_id: 'الخدمة',
  treatment_cost: 'التكلفة',
  notes: 'الملاحظات',
  title: 'العنوان',
  total_amount: 'الإجمالي',
  final_amount: 'المبلغ النهائي',
  paid_amount: 'المدفوع',
  remaining_amount: 'المتبقي',
  amount: 'المبلغ',
  payment_method: 'طريقة الدفع',
  payment_type: 'نوع الدفعة',
  payment_date: 'تاريخ الدفعة',
  due_date: 'تاريخ الاستحقاق',
  tooth_number: 'رقم السن',
  old_status: 'الحالة السابقة',
  new_status: 'الحالة الجديدة',
  procedure_done: 'الإجراء المنفذ',
  doctor_notes: 'ملاحظات الطبيب',
  file_name: 'اسم الملف',
  file_type: 'نوع الملف',
  count: 'العدد',
  role: 'الدور',
  is_active: 'نشط',
  email: 'البريد الإلكتروني'
};

const displayValueMaps: Record<string, Record<string, string>> = {
  status: { active: 'نشط', archived: 'مؤرشف', pending: 'بانتظار', confirmed: 'مؤكد', arrived: 'حضر', completed: 'مكتمل', cancelled: 'ملغى', no_show: 'لم يحضر', paid: 'مدفوع', partial: 'مدفوع جزئياً' },
  payment_method: { cash: 'نقداً', card: 'بطاقة', transfer: 'حوالة', other: 'أخرى' },
  payment_type: { down_payment: 'دفعة أولى', installment: 'قسط', full_payment: 'دفعة كاملة', extra_payment: 'دفعة إضافية', refund: 'استرجاع' },
  role: { admin: 'مدير', doctor: 'طبيب', secretary: 'سكرتيرة' }
};

function actionLabel(action: string) {
  return actionLabels[action] || prettifyKey(action);
}

function entityLabel(entity: string) {
  return entityLabels[entity] || prettifyKey(entity);
}

function prettifyKey(key: string) {
  return key.replace(/_/g, ' ');
}

function formatActivityValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'فارغ';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return new Intl.NumberFormat('en-US').format(value);
  if (typeof value === 'string') return displayValueMaps[key]?.[value] || value;
  if (Array.isArray(value)) return value.map((item) => formatActivityValue(key, item)).join('، ');
  if (typeof value === 'object') return 'بيانات مرفقة';
  return String(value);
}

function detailsFromActivity(row: ActivityLog) {
  const oldValue = row.old_value || {};
  const newValue = row.new_value || {};
  const keys = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)]))
    .filter((key) => !['clinic_id', 'id', 'created_at', 'updated_at', 'archived_at', 'created_by', 'staff_id', 'patient_id', 'entity_id'].includes(key))
    .slice(0, 8);

  return keys.map((key) => ({
    key,
    label: valueLabels[key] || prettifyKey(key),
    oldText: Object.prototype.hasOwnProperty.call(oldValue, key) ? formatActivityValue(key, oldValue[key]) : '',
    newText: Object.prototype.hasOwnProperty.call(newValue, key) ? formatActivityValue(key, newValue[key]) : ''
  }));
}

function activitySummary(row: ActivityLog) {
  const values = row.new_value || row.old_value || {};
  const name = [values.full_name, values.title, values.file_name, values.name, values.receipt_number].find(Boolean);
  if (name) return `${actionLabel(row.action)}: ${String(name)}`;
  if (typeof values.count === 'number') return `${actionLabel(row.action)}: ${values.count} عنصر`;
  return actionLabel(row.action);
}

function PageContent({ staff }: AppContext) {
  const canView = canViewFullFinancials(staff);
  const [rows, setRows] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ActivityFilter>({ action: '', entity: '', search: '' });

  async function load() {
    if (!staff || !canView) return;
    setLoading(true);
    const { data } = await supabase
      .from('activity_logs')
      .select('*, staff_users(full_name, role)')
      .eq('clinic_id', staff.clinic_id)
      .order('created_at', { ascending: false })
      .limit(200);
    setRows((data || []) as ActivityLog[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [staff?.clinic_id, canView]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows
      .filter((row) => !filters.action || row.action === filters.action)
      .filter((row) => !filters.entity || row.entity_type === filters.entity)
      .filter((row) => {
        if (!q) return true;
        return [row.action, row.entity_type, row.staff_users?.full_name, JSON.stringify(row.old_value || {}), JSON.stringify(row.new_value || {})]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });
  }, [rows, filters]);

  const actions = Array.from(new Set(rows.map((row) => row.action)));
  const entities = Array.from(new Set(rows.map((row) => row.entity_type)));

  if (!canView) return <AccessDenied title="سجل النشاط غير متاح" description="سجل النشاط متاح للطبيب أو المدير فقط." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-right">
          <h1 className="text-3xl font-black">سجل النشاط</h1>
          <p className="mt-2 text-slate-500">تتبع من قام بالتعديل ومتى حدثت العمليات المهمة داخل العيادة.</p>
        </div>
        <button className="outline-btn" onClick={load}><Icon name="clock" /> تحديث</button>
      </div>

      <section className="premium-card grid gap-3 md:grid-cols-3">
        <input className="soft-input" placeholder="بحث داخل السجل..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <select className="soft-input" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
          <option value="">كل العمليات</option>
          {actions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
        </select>
        <select className="soft-input" value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
          <option value="">كل الأقسام</option>
          {entities.map((entity) => <option key={entity} value={entity}>{entityLabel(entity)}</option>)}
        </select>
      </section>

      <section className="premium-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black">آخر العمليات</h2>
          <span className="rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-slate-500">{loading ? 'جاري التحميل...' : `${filtered.length} عملية`}</span>
        </div>
        {filtered.length ? (
          <div className="space-y-3">
            {filtered.map((row) => {
              const details = detailsFromActivity(row);
              return (
                <div key={row.id} className="rounded-2xl border border-border bg-white/80 p-4 text-right shadow-subtle">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-900">{activitySummary(row)}</p>
                      <p className="mt-1 text-sm font-bold text-slate-500">القسم: {entityLabel(row.entity_type)} · بواسطة: {row.staff_users?.full_name || 'مستخدم'} · <span className="number-ltr">{formatDate(row.created_at)}</span></p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-4 py-2 text-xs font-black text-primary">{entityLabel(row.entity_type)}</span>
                  </div>
                  {details.length ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {details.map((detail) => (
                        <div key={detail.key} className="rounded-2xl border border-border/80 bg-muted/35 px-3 py-2 text-sm">
                          <p className="font-black text-slate-700">{detail.label}</p>
                          {detail.oldText && detail.newText && detail.oldText !== detail.newText ? (
                            <p className="mt-1 font-bold text-slate-500">من <span className="text-slate-700">{detail.oldText}</span> إلى <span className="text-primary">{detail.newText}</span></p>
                          ) : (
                            <p className="mt-1 font-bold text-slate-600">{detail.newText || detail.oldText}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-2xl bg-muted/35 px-3 py-2 text-sm font-bold text-slate-500">لا توجد تفاصيل إضافية لهذه العملية.</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="لا توجد عمليات مطابقة" description="ستظهر هنا العمليات المهمة مثل تعديل مريض أو تغيير حالة موعد أو حذف ملف." />}
      </section>
    </div>
  );
}

export default function ActivityPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
