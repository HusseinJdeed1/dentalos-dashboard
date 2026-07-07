'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { StatusBadge } from '@/components/StatusBadge';
import { weekDays } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import type { WorkingHour } from '@/lib/types';

function defaultRow(clinicId: string, day: number): WorkingHour {
  const isFriday = day === 5;
  return {
    clinic_id: clinicId,
    day_of_week: day,
    is_open: !isFriday,
    start_time: day === 4 ? '09:00' : '09:00',
    end_time: day === 4 ? '14:00' : '17:00',
    break_start: day === 4 || isFriday ? null : '13:00',
    break_end: day === 4 || isFriday ? null : '14:00',
    slot_duration_minutes: 30
  };
}

function WorkingHoursContent({ staff }: AppContext) {
  const [rows, setRows] = useState<WorkingHour[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canEdit = staff?.role === 'admin' || staff?.role === 'doctor' || staff?.role === 'secretary';

  async function load() {
    if (!staff) return;
    const { data } = await supabase
      .from('clinic_working_hours')
      .select('*')
      .eq('clinic_id', staff.clinic_id)
      .order('day_of_week', { ascending: true });

    const existing = (data || []) as WorkingHour[];
    const fullRows = weekDays.map(({ day }) => existing.find((row) => row.day_of_week === day) || defaultRow(staff.clinic_id, day));
    setRows(fullRows);
  }

  useEffect(() => { load(); }, [staff?.clinic_id]);

  const summary = useMemo(() => {
    const openDays = rows.filter((r) => r.is_open).length;
    const avgSlot = rows.find((r) => r.is_open)?.slot_duration_minutes || 30;
    return { openDays, avgSlot };
  }, [rows]);

  function update(day: number, patch: Partial<WorkingHour>) {
    setRows((current) => current.map((row) => row.day_of_week === day ? { ...row, ...patch } : row));
    setSaved(false);
  }

  async function save() {
    if (!staff || !canEdit) return;
    setSaving(true);
    setSaved(false);
    const payload = rows.map((row) => ({
      clinic_id: staff.clinic_id,
      day_of_week: row.day_of_week,
      is_open: row.is_open,
      start_time: row.start_time || '09:00',
      end_time: row.end_time || '17:00',
      break_start: row.break_start || null,
      break_end: row.break_end || null,
      slot_duration_minutes: Number(row.slot_duration_minutes || 30)
    }));
    const { error } = await supabase
      .from('clinic_working_hours')
      .upsert(payload, { onConflict: 'clinic_id,day_of_week' });
    setSaving(false);
    if (error) { showToast('تعذر حفظ أوقات الدوام', error.message, 'error'); return; }
    setSaved(true);
    load();
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-3xl font-black">أوقات الدوام</h1>
        <p className="text-slate-500">يمكن للطبيب أو السكرتيرة تعديل أوقات العمل والاستراحة ومدة الموعد.</p>
      </div>
      <button className="premium-btn" onClick={save} disabled={!canEdit || saving}>
        <Icon name="clock" /> {saving ? 'جاري الحفظ...' : 'حفظ أوقات الدوام'}
      </button>
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <div className="mini-card"><p className="text-sm font-bold text-slate-500">أيام العمل</p><p className="mt-2 text-3xl font-black number-ltr">{summary.openDays}</p></div>
      <div className="mini-card"><p className="text-sm font-bold text-slate-500">مدة الموعد الافتراضية</p><p className="mt-2 text-3xl font-black number-ltr">{summary.avgSlot} دقيقة</p></div>
      <div className="mini-card"><p className="text-sm font-bold text-slate-500">الصلاحية</p><div className="mt-3"><StatusBadge tone={canEdit ? 'success' : 'warning'}>{canEdit ? 'مسموح بالتعديل' : 'عرض فقط'}</StatusBadge></div></div>
    </div>

    {saved ? <div className="premium-card border-success/30 bg-success/5 text-success"><div className="flex items-center gap-2 font-black"><Icon name="clock" /> تم حفظ أوقات الدوام بنجاح.</div></div> : null}

    <div className="premium-card overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead>
          <tr>
            <th className="table-th">اليوم</th>
            <th className="table-th">الحالة</th>
            <th className="table-th">من</th>
            <th className="table-th">إلى</th>
            <th className="table-th">بداية الاستراحة</th>
            <th className="table-th">نهاية الاستراحة</th>
            <th className="table-th">مدة الموعد</th>
          </tr>
        </thead>
        <tbody>
          {weekDays.map(({ day, name }) => {
            const row = rows.find((r) => r.day_of_week === day) || defaultRow(staff?.clinic_id || '', day);
            return <tr key={day}>
              <td className="table-td text-base font-black">{name}</td>
              <td className="table-td">
                <label className="inline-flex cursor-pointer items-center gap-2 font-bold">
                  <input type="checkbox" checked={row.is_open} disabled={!canEdit} onChange={(e) => update(day, { is_open: e.target.checked })} />
                  {row.is_open ? 'مفتوح' : 'مغلق'}
                </label>
              </td>
              <td className="table-td"><input className="soft-input number-ltr" type="time" disabled={!row.is_open || !canEdit} value={row.start_time?.slice(0,5) || '09:00'} onChange={(e) => update(day, { start_time: e.target.value })} /></td>
              <td className="table-td"><input className="soft-input number-ltr" type="time" disabled={!row.is_open || !canEdit} value={row.end_time?.slice(0,5) || '17:00'} onChange={(e) => update(day, { end_time: e.target.value })} /></td>
              <td className="table-td"><input className="soft-input number-ltr" type="time" disabled={!row.is_open || !canEdit} value={row.break_start?.slice(0,5) || ''} onChange={(e) => update(day, { break_start: e.target.value || null })} /></td>
              <td className="table-td"><input className="soft-input number-ltr" type="time" disabled={!row.is_open || !canEdit} value={row.break_end?.slice(0,5) || ''} onChange={(e) => update(day, { break_end: e.target.value || null })} /></td>
              <td className="table-td"><select className="soft-input number-ltr" disabled={!row.is_open || !canEdit} value={row.slot_duration_minutes} onChange={(e) => update(day, { slot_duration_minutes: Number(e.target.value) })}><option value={15}>15 دقيقة</option><option value={20}>20 دقيقة</option><option value={30}>30 دقيقة</option><option value={45}>45 دقيقة</option><option value={60}>60 دقيقة</option></select></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    <div className="premium-card border-warning/30 bg-warning/5">
      <h2 className="flex items-center gap-2 text-xl font-black text-warning"><Icon name="alert" /> ملاحظة مهمة</h2>
      <p className="mt-3 leading-7 text-slate-700">عند إضافة موعد جديد، ستفحص لوحة التحكم أوقات الدوام تلقائياً وتمنع الحجز في يوم مغلق أو خارج وقت العمل أو داخل الاستراحة.</p>
    </div>
  </div>;
}

export default function WorkingHoursPage(){ return <AppShell>{ctx => <WorkingHoursContent {...ctx} />}</AppShell>; }
