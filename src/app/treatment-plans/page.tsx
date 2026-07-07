'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { StatusBadge } from '@/components/StatusBadge';
import { planStatusLabels } from '@/lib/constants';
import { canViewFullFinancials } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { TreatmentPlan } from '@/lib/types';
import { formatMoney, getCurrencySymbol } from '@/lib/utils';

function PageContent({ staff, clinic }: AppContext) {
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const [rows, setRows] = useState<TreatmentPlan[]>([]);
  const canView = canViewFullFinancials(staff);

  async function load() {
    if (!staff || !canView) return;
    const { data } = await supabase
      .from('treatment_plans')
      .select('*, patients(*), services(*)')
      .eq('clinic_id', staff.clinic_id)
      .order('created_at', { ascending: false });
    setRows((data || []) as TreatmentPlan[]);
  }

  useEffect(() => { load(); }, [staff?.clinic_id, canView]);

  if (!canView) return <AccessDenied title="خطط العلاج المالية غير متاحة" description="هذه الصفحة تعرض مبالغ العلاج والمدفوع والمتبقي، لذلك تظهر للطبيب أو المدير فقط." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">خطط العلاج</h1>
          <p className="text-slate-500">عرض عام لكل خطط العلاج. إضافة أو تعديل أو حذف خطة يتم من داخل ملف المريض فقط.</p>
        </div>
      </div>

      <div className="premium-card">
        <div className="data-table-card">
          <table className="data-table">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr><th>المريض</th><th>الخدمة / الخطة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>الإجراءات</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-black">{row.patients?.full_name}</td>
                  <td>{row.services?.name || row.title}</td>
                  <td><span className="number-ltr">{formatMoney(row.final_amount, currencySymbol)}</span></td>
                  <td><span className="number-ltr">{formatMoney(row.paid_amount, currencySymbol)}</span></td>
                  <td><span className="number-ltr">{formatMoney(row.remaining_amount, currencySymbol)}</span></td>
                  <td><StatusBadge tone={row.remaining_amount > 0 ? 'warning' : 'success'}>{planStatusLabels[row.status] || row.status}</StatusBadge></td>
                  <td>
                    <div className="table-actions-row one-action">
                      <Link className="outline-btn table-action-btn" href={`/patients/profile?id=${row.patient_id}`}><Icon name="file" className="h-4 w-4" /> ملف المريض</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="py-8 text-center text-slate-500"><Icon name="tooth" className="mx-auto mb-2 h-8 w-8" />لا توجد خطط علاج بعد. افتح ملف المريض لإضافة خطة علاج.</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function TreatmentPlansPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
