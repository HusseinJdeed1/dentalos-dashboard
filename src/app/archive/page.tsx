'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { StatusBadge } from '@/components/StatusBadge';
import { isRoleAllowed } from '@/lib/permissions';
import { requestActionConfirmation, requestPasswordConfirmation, showSecureMessage } from '@/lib/secureActions';
import { supabase } from '@/lib/supabase';
import type { Patient } from '@/lib/types';
import { formatDate } from '@/lib/utils';

function ArchiveContent({ staff }: AppContext) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  async function load() {
    if (!staff) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('clinic_id', staff.clinic_id)
      .eq('status', 'archived')
      .order('archived_at', { ascending: false });

    if (error) {
      await showSecureMessage('تعذر تحميل الأرشيف', 'تأكد من تشغيل ملف SQL الخاص بالأرشفة داخل Supabase.');
      setPatients([]);
    } else {
      setPatients((data || []) as Patient[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [staff?.clinic_id]);

  async function restorePatient(patient: Patient) {
    if (!staff) return;
    const ok = await requestActionConfirmation(
      'إزالة المريض من الأرشيف',
      `سيعود ملف "${patient.full_name}" إلى حالة النشاط ويمكن إضافة المواعيد وخطط العلاج له من جديد.`,
      'إزالة من الأرشيف'
    );
    if (!ok) return;
    const { error } = await supabase
      .from('patients')
      .update({ status: 'active', archived_at: null })
      .eq('clinic_id', staff.clinic_id)
      .eq('id', patient.id);
    if (error) {
      await showSecureMessage('تعذر إزالة الأرشفة', error.message);
      return;
    }
    await showSecureMessage('تمت إزالة الأرشفة', 'عاد ملف المريض إلى الحالة النشطة.');
    load();
  }

  if (!staff || !isRoleAllowed(staff, ['admin', 'doctor'])) {
    return <AccessDenied title="لا تملك صلاحية فتح الأرشيف" description="الأرشيف متاح للطبيب والمدير فقط." />;
  }

  const query = q.trim().toLowerCase();
  const filtered = patients.filter((patient) => {
    if (!query) return true;
    return [patient.full_name, patient.phone, patient.address, patient.medical_notes]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  return (
    <div className="space-y-6" dir="rtl">
      <div className="premium-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0 text-right">
          <h1 className="text-3xl font-black">أرشيف المرضى</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold text-slate-500">الملفات المؤرشفة محفوظة داخل النظام مع مواعيدها وخطط العلاج والدفعات دون حذف أي بيانات.</p>
        </div>
        <Link href="/patients" className="outline-btn shrink-0"><Icon name="users" /> العودة إلى المرضى النشطين</Link>
      </div>

      <div className="premium-card">
        <input className="soft-input" placeholder="بحث في الأرشيف بالاسم أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="premium-card">
        {loading ? <p className="py-8 text-center font-bold text-slate-500">جاري تحميل الأرشيف...</p> : null}
        {!loading ? (
          <div className="data-table-card archive-table-card">
            <table className="data-table archive-table">
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th className="text-center">الهاتف</th>
                  <th>العنوان</th>
                  <th className="text-center">تاريخ الأرشفة</th>
                  <th className="text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => (
                  <tr key={patient.id}>
                    <td className="font-black">{patient.full_name}</td>
                    <td className="text-center"><span className="number-ltr">{patient.phone}</span></td>
                    <td>{patient.address || '—'}</td>
                    <td className="text-center"><span className="number-ltr">{formatDate(patient.archived_at)}</span></td>
                    <td>
                      <div className="archive-actions-row">
                        <Link href={`/patients/profile?id=${patient.id}`} className="outline-btn archive-action-btn"><Icon name="file" className="h-4 w-4" /> الملف</Link>
                        <button className="outline-btn archive-action-btn" onClick={() => restorePatient(patient)}>إزالة الأرشفة</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <p className="py-8 text-center font-bold text-slate-500">لا توجد ملفات مؤرشفة مطابقة.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ArchivePage() {
  return <AppShell>{(ctx) => <ArchiveContent {...ctx} />}</AppShell>;
}
