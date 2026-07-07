'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/audit';
import { showToast } from '@/lib/toast';
import { formatDate } from '@/lib/utils';
import type { DentalChartRow, StaffUser, VisitTooth } from '@/lib/types';

type Props = {
  staff: StaffUser | null;
  patientId: string;
  rows: DentalChartRow[];
  visitTeeth?: VisitTooth[];
  onReload: () => void;
  canEdit?: boolean;
};

export const toothGroups = [
  ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'],
  ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38']
];

export const dentalStatusOptions = [
  { value: 'healthy', label: 'سليم' },
  { value: 'watch', label: 'مراقبة' },
  { value: 'caries', label: 'نخر' },
  { value: 'filled', label: 'حشوة' },
  { value: 'root_canal', label: 'عصب' },
  { value: 'crown', label: 'تلبيسة' },
  { value: 'missing', label: 'مفقود' },
  { value: 'implant', label: 'زرعة' }
] as const;

export type DentalStatusValue = typeof dentalStatusOptions[number]['value'];

export function dentalStatusLabel(status?: string | null) {
  return dentalStatusOptions.find((item) => item.value === status)?.label || 'غير محدد';
}

export function dentalStatusClass(status?: string | null) {
  if (status === 'healthy') return 'is-healthy';
  if (status === 'caries') return 'is-danger';
  if (status === 'filled' || status === 'crown' || status === 'implant') return 'is-success';
  if (status === 'root_canal') return 'is-warning';
  if (status === 'missing') return 'is-muted';
  return 'is-watch';
}

export function PatientDentalChart({ staff, patientId, rows, visitTeeth = [], onReload, canEdit = false }: Props) {
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ status: 'healthy', procedure_name: '', notes: '' });
  const byTooth = useMemo(() => new Map(rows.map((row) => [row.tooth_number, row])), [rows]);
  const historyByTooth = useMemo(() => {
    const map = new Map<string, VisitTooth[]>();
    visitTeeth.forEach((row) => {
      const list = map.get(row.tooth_number) || [];
      list.push(row);
      map.set(row.tooth_number, list);
    });
    return map;
  }, [visitTeeth]);
  const selectedRow = selectedTooth ? byTooth.get(selectedTooth) || null : null;
  const selectedHistory = selectedTooth ? historyByTooth.get(selectedTooth) || [] : [];

  function openTooth(tooth: string) {
    const row = byTooth.get(tooth);
    setSelectedTooth(tooth);
    setForm({ status: row?.status || 'healthy', procedure_name: row?.procedure_name || '', notes: row?.notes || '' });
  }

  async function saveTooth(e: React.FormEvent) {
    e.preventDefault();
    if (!staff || !selectedTooth || !canEdit) {
      showToast('صلاحية غير متاحة', 'تعديل مخطط الأسنان متاح للطبيب فقط.', 'warning');
      return;
    }
    setSaving(true);
    const payload = {
      clinic_id: staff.clinic_id,
      patient_id: patientId,
      tooth_number: selectedTooth,
      status: form.status,
      procedure_name: form.procedure_name.trim() || null,
      notes: form.notes.trim() || null,
      updated_by: staff.id,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('patient_dental_chart')
      .upsert(payload, { onConflict: 'clinic_id,patient_id,tooth_number' });
    setSaving(false);
    if (error) {
      showToast('تعذر حفظ مخطط الأسنان', 'شغّل ملف SQL الخاص بمخطط الأسنان ثم أعد المحاولة.', 'error');
      return;
    }
    await logActivity(staff, 'dental_chart_updated', 'dental_chart', selectedRow?.id || null, selectedRow, payload);
    setSelectedTooth(null);
    onReload();
  }

  return (
    <section className="premium-card patient-dental-chart-card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-right">
        <div>
          <h2 className="text-2xl font-black">مخطط الأسنان</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">مخطط يربط حالة كل سن بسجل الجلسات والإجراءات المنفذة فعلياً.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black text-slate-500">
          {dentalStatusOptions.slice(0, 5).map((item) => <span key={item.value} className={`dental-status-pill ${dentalStatusClass(item.value)}`}>{item.label}</span>)}
        </div>
      </div>

      <div className="dental-arch-wrap">
        {toothGroups.map((group, index) => (
          <div key={index} className="dental-arch-row">
            {group.map((tooth) => {
              const row = byTooth.get(tooth);
              const hasHistory = Boolean(historyByTooth.get(tooth)?.length);
              return (
                <button key={tooth} type="button" className={`tooth-button ${dentalStatusClass(row?.status)} ${hasHistory ? 'has-visit-history' : ''}`} onClick={() => openTooth(tooth)} title={`${tooth} - ${dentalStatusLabel(row?.status)}`}>
                  <span className="tooth-shape">{tooth}</span>
                  <small>{dentalStatusLabel(row?.status)}</small>
                  {hasHistory ? <em className="tooth-history-dot" title="له سجل جلسات">•</em> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {rows.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.slice(0, 6).map((row) => (
            <button key={row.id} className="rounded-2xl border border-border bg-white/80 p-4 text-right shadow-subtle" onClick={() => openTooth(row.tooth_number)}>
              <div className="mb-2 flex items-center justify-between gap-2"><strong className="number-ltr">سن {row.tooth_number}</strong><span className={`dental-status-pill ${dentalStatusClass(row.status)}`}>{dentalStatusLabel(row.status)}</span></div>
              <p className="text-sm font-bold text-slate-600">{row.procedure_name || row.notes || 'لا توجد ملاحظات إضافية.'}</p>
            </button>
          ))}
        </div>
      ) : <EmptyState title="لم يتم تحديد حالات أسنان بعد" description="عند إنهاء الجلسات أو الضغط على أي سن سيتم تحديث المخطط هنا." />}

      <Modal open={Boolean(selectedTooth)} title={`تعديل سن ${selectedTooth || ''}`} onClose={() => !saving && setSelectedTooth(null)}>
        <form onSubmit={saveTooth} className="grid gap-4 text-right">
          {!canEdit ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black leading-7 text-amber-800">هذا القسم للعرض فقط. تعديل حالة السن متاح للطبيب أو المدير.</div> : null}
          <label><span className="mb-2 block text-sm font-bold">حالة السن الحالية</span><select className="soft-input" disabled={!canEdit || saving} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{dentalStatusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span className="mb-2 block text-sm font-bold">الإجراء / العلاج الحالي</span><input className="soft-input" disabled={!canEdit || saving} value={form.procedure_name} onChange={(e) => setForm({ ...form, procedure_name: e.target.value })} placeholder="مثال: حشوة، علاج عصب، تلبيسة..." /></label>
          <label><span className="mb-2 block text-sm font-bold">ملاحظات</span><textarea className="soft-input min-h-32" disabled={!canEdit || saving} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>

          {selectedHistory.length ? (
            <div className="rounded-2xl border border-border bg-muted/35 p-4">
              <p className="mb-3 text-sm font-black text-slate-500">تاريخ السن داخل الجلسات</p>
              <div className="space-y-2">
                {selectedHistory.slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-white/80 p-3 text-sm font-bold text-slate-700">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span>{item.procedure_done || 'إجراء غير محدد'}</span>
                      <span className="number-ltr text-xs text-slate-400">{formatDate(item.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-500">{dentalStatusLabel(item.old_status)} ← {dentalStatusLabel(item.new_status)}</p>
                    {item.notes ? <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{item.notes}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {canEdit ? <div className="flex justify-end"><button className="premium-btn" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ السن'}</button></div> : null}
        </form>
      </Modal>
    </section>
  );
}
