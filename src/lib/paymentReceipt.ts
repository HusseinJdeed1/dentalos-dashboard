import type { Clinic, Installment, Patient, Payment, StaffUser, TreatmentPlan } from '@/lib/types';
import { formatDate, formatMoney, getCurrencySymbol } from '@/lib/utils';

export function receiptNumber(payment: Pick<Payment, 'id' | 'payment_date'>) {
  const datePart = String(payment.payment_date || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
  return `RC-${datePart}-${String(payment.id || '').slice(0, 8).toUpperCase()}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

type ReceiptPayload = {
  clinic?: Clinic | null;
  staff?: StaffUser | null;
  patient: Patient;
  payment: Payment;
  plan?: TreatmentPlan | null;
  installment?: Installment | null;
};

export function buildPaymentReceiptHtml({ clinic, staff, patient, payment, plan, installment }: ReceiptPayload) {
  const currency = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const methodMap: Record<string, string> = { cash: 'نقداً', transfer: 'حوالة', card: 'بطاقة', other: 'أخرى' };
  const typeMap: Record<string, string> = { down_payment: 'دفعة أولى', installment: 'قسط', full_payment: 'دفعة كاملة', extra_payment: 'دفعة إضافية', refund: 'استرجاع' };
  const installmentText = installment ? `قسط رقم ${installment.installment_number || '—'} - ${formatDate(installment.due_date)}` : 'غير مرتبط بقسط محدد';
  const receipt = receiptNumber(payment);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>إيصال دفع ${escapeHtml(receipt)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Arial, Tahoma, sans-serif; color:#0f172a; background:#f8fafc; direction:rtl; }
  .sheet { width: 100%; max-width: 780px; margin: 0 auto; background:white; border:1px solid #dbe4ee; border-radius:24px; padding:32px; }
  .header { display:flex; align-items:center; justify-content:space-between; gap:24px; border-bottom:2px solid #e2e8f0; padding-bottom:22px; }
  .clinic { display:flex; align-items:center; gap:14px; }
  .logo { width:64px; height:64px; border-radius:18px; object-fit:cover; background:#e0f2fe; display:grid; place-items:center; font-weight:900; color:#0369a1; }
  h1, h2, p { margin:0; }
  h1 { font-size:30px; font-weight:900; }
  h2 { font-size:20px; font-weight:900; margin-bottom:12px; }
  .muted { color:#64748b; font-weight:700; line-height:1.8; }
  .receipt-no { text-align:left; direction:ltr; font-weight:900; color:#0f766e; }
  .amount { margin:28px 0; padding:26px; border-radius:22px; background:#ecfdf5; border:1px solid #bbf7d0; text-align:center; }
  .amount .label { color:#047857; font-weight:900; font-size:15px; }
  .amount .value { margin-top:8px; font-size:38px; font-weight:900; direction:ltr; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
  .box { border:1px solid #e2e8f0; border-radius:18px; padding:16px; min-height:74px; }
  .box small { display:block; color:#64748b; font-weight:900; margin-bottom:8px; }
  .box strong { display:block; font-size:16px; line-height:1.7; }
  .footer { display:flex; justify-content:space-between; gap:18px; margin-top:36px; padding-top:24px; border-top:1px dashed #cbd5e1; }
  .signature { width:45%; text-align:center; padding-top:48px; border-top:1px solid #94a3b8; font-weight:900; color:#475569; }
  .no-print { margin:18px auto; max-width:780px; text-align:center; }
  button { border:0; border-radius:999px; padding:12px 22px; font-weight:900; background:#0f766e; color:white; cursor:pointer; }
  @media print { body { background:white; } .sheet { border:0; box-shadow:none; padding:0; } .no-print { display:none; } }
</style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">حفظ / طباعة PDF</button></div>
  <main class="sheet">
    <section class="header">
      <div class="clinic">
        ${clinic?.logo_url ? `<img class="logo" src="${escapeHtml(clinic.logo_url)}" />` : `<div class="logo">${escapeHtml((clinic?.name || 'D').slice(0, 1))}</div>`}
        <div>
          <h1>${escapeHtml(clinic?.name || 'العيادة')}</h1>
          <p class="muted">${escapeHtml(clinic?.phone || '')}${clinic?.address ? ' · ' + escapeHtml(clinic.address) : ''}</p>
        </div>
      </div>
      <div class="receipt-no">
        <div>PAYMENT RECEIPT</div>
        <div>${escapeHtml(receipt)}</div>
      </div>
    </section>

    <section class="amount">
      <div class="label">المبلغ المدفوع</div>
      <div class="value">${escapeHtml(formatMoney(Number(payment.amount || 0), currency))}</div>
    </section>

    <section class="grid">
      <div class="box"><small>اسم المريض</small><strong>${escapeHtml(patient.full_name)}</strong></div>
      <div class="box"><small>هاتف المريض</small><strong dir="ltr">${escapeHtml(patient.phone || '—')}</strong></div>
      <div class="box"><small>تاريخ الدفع</small><strong dir="ltr">${escapeHtml(formatDate(payment.payment_date))}</strong></div>
      <div class="box"><small>طريقة الدفع</small><strong>${escapeHtml(methodMap[payment.payment_method] || payment.payment_method)}</strong></div>
      <div class="box"><small>نوع الدفع</small><strong>${escapeHtml(typeMap[payment.payment_type] || payment.payment_type)}</strong></div>
      <div class="box"><small>خطة العلاج</small><strong>${escapeHtml(plan?.title || payment.treatment_plans?.title || '—')}</strong></div>
      <div class="box"><small>القسط المرتبط</small><strong>${escapeHtml(installmentText)}</strong></div>
      <div class="box"><small>الموظف المسؤول</small><strong>${escapeHtml(staff?.full_name || '—')}</strong></div>
    </section>

    ${payment.notes ? `<section style="margin-top:14px" class="box"><small>ملاحظات</small><strong>${escapeHtml(payment.notes)}</strong></section>` : ''}

    <section class="footer">
      <div class="signature">توقيع المستلم</div>
      <div class="signature">ختم / توقيع العيادة</div>
    </section>
  </main>
  <script>setTimeout(function(){ window.print(); }, 450);</script>
</body>
</html>`;
}

export function printPaymentReceipt(payload: ReceiptPayload) {
  const html = buildPaymentReceiptHtml(payload);
  const receiptWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
  if (!receiptWindow) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${receiptNumber(payload.payment)}.html`;
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  receiptWindow.document.open();
  receiptWindow.document.write(html);
  receiptWindow.document.close();
}
