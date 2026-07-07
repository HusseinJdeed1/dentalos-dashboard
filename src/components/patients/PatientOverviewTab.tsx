import { EmptyState } from '@/components/EmptyState';
import type { Appointment, PatientImage, Visit } from '@/lib/types';
import { formatDate, formatMoney } from '@/lib/utils';

function SummaryBox({ label, value, success, danger }: { label: string; value: string; success?: boolean; danger?: boolean }) {
  return <div className="rounded-2xl border border-border bg-white/80 p-4 text-right"><p className="text-sm font-black text-slate-500">{label}</p><p className={`${success ? 'text-success' : danger ? 'text-danger' : 'text-slate-900'} mt-3 text-lg font-black number-ltr`}>{value}</p></div>;
}

type Props = {
  nextAppointment: Appointment | null;
  latestVisit: Visit | null;
  patientImages: PatientImage[];
  maxAttachments: number;
  canViewFinance: boolean;
  remainingAmount: number;
  currencySymbol: string;
  medicalNotes?: string | null;
  onEditMedicalNotes: () => void;
};

export function PatientOverviewTab({ nextAppointment, latestVisit, patientImages, maxAttachments, canViewFinance, remainingAmount, currencySymbol, medicalNotes, onEditMedicalNotes }: Props) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <section className="premium-card">
        <h2 className="mb-4 text-2xl font-black">ملخص الملف</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <SummaryBox label="الموعد القادم" value={nextAppointment ? `${formatDate(nextAppointment.appointment_date)} · ${nextAppointment.appointment_time?.slice(0, 5)}` : 'لا يوجد موعد قادم'} />
          <SummaryBox label="آخر جلسة" value={latestVisit ? `${formatDate(latestVisit.visit_date)} · ${latestVisit.services?.name || 'جلسة علاج'}` : 'لا توجد جلسات'} />
          <SummaryBox label="المرفقات" value={`${patientImages.length} / ${maxAttachments}`} />
          {canViewFinance ? <SummaryBox label="المبلغ المتبقي" value={formatMoney(remainingAmount, currencySymbol)} danger={remainingAmount > 0} /> : <SummaryBox label="المالية" value="مخفية عن هذا الدور" />}
        </div>
      </section>
      <section className="premium-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black">الملاحظات الطبية</h2>
          <button type="button" className="outline-btn px-4 py-2 text-sm" onClick={onEditMedicalNotes}>تعديل</button>
        </div>
        {medicalNotes ? <p className="min-h-32 whitespace-pre-wrap rounded-2xl border border-border bg-white/75 p-4 leading-8 text-slate-600">{medicalNotes}</p> : <EmptyState title="لا توجد ملاحظات طبية" description="أضف الأمراض المزمنة، الحساسية، الأدوية الحالية، أو أي ملاحظات مهمة قبل العلاج." />}
      </section>
    </div>
  );
}
