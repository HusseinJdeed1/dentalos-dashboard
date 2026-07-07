import { supabase } from './supabase';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createPasswordDialog(actionLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';
    overlay.style.background = 'rgba(15, 23, 42, 0.45)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.dir = 'rtl';

    const card = document.createElement('div');
    card.style.width = 'min(460px, 100%)';
    card.style.borderRadius = '28px';
    card.style.border = '1px solid #dbe7ee';
    card.style.background = '#fff';
    card.style.boxShadow = '0 24px 80px rgba(15, 23, 42, 0.22)';
    card.style.padding = '24px';
    card.style.fontFamily = 'inherit';

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;">
        <div>
          <h2 style="margin:0;font-size:22px;font-weight:900;color:#0f172a;">تأكيد كلمة المرور</h2>
          <p style="margin:8px 0 0;color:#64748b;font-size:14px;font-weight:700;line-height:1.8;">أدخل كلمة مرور حسابك لتأكيد: <span style="color:#0f766e;">${escapeHtml(actionLabel)}</span></p>
        </div>
        <button type="button" data-close style="border:1px solid #dbe7ee;background:#fff;border-radius:14px;padding:10px 14px;font-weight:800;color:#334155;cursor:pointer;">إغلاق</button>
      </div>
      <form data-form>
        <label style="display:block;margin-bottom:10px;font-size:14px;font-weight:900;color:#0f172a;">كلمة المرور</label>
        <input data-password type="password" autocomplete="current-password" style="width:100%;border:1px solid #dbe7ee;border-radius:18px;padding:14px 16px;font-size:15px;outline:none;direction:ltr;text-align:left;" />
        <p data-error style="display:none;margin:12px 0 0;color:#e11d48;font-size:13px;font-weight:800;line-height:1.7;"></p>
        <div style="display:flex;align-items:center;justify-content:flex-start;gap:10px;margin-top:20px;">
          <button type="submit" data-submit style="border:0;background:#0f9299;color:#fff;border-radius:18px;padding:12px 22px;font-weight:900;cursor:pointer;box-shadow:0 12px 30px rgba(15,146,153,0.22);">تأكيد</button>
          <button type="button" data-cancel style="border:1px solid #dbe7ee;background:#fff;color:#334155;border-radius:18px;padding:12px 20px;font-weight:900;cursor:pointer;">إلغاء</button>
        </div>
      </form>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = card.querySelector<HTMLInputElement>('[data-password]')!;
    const form = card.querySelector<HTMLFormElement>('[data-form]')!;
    const closeBtn = card.querySelector<HTMLButtonElement>('[data-close]')!;
    const cancelBtn = card.querySelector<HTMLButtonElement>('[data-cancel]')!;
    const errorEl = card.querySelector<HTMLParagraphElement>('[data-error]')!;

    const cleanup = (value: string | null) => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const showError = (message: string) => {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup(null);
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const password = input.value.trim();
      if (!password) {
        showError('يرجى إدخال كلمة المرور.');
        input.focus();
        return;
      }
      cleanup(password);
    });

    closeBtn.addEventListener('click', () => cleanup(null));
    cancelBtn.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(null);
    });
    document.addEventListener('keydown', onKeyDown);

    setTimeout(() => input.focus(), 0);
  });
}

export function showSecureMessage(title: string, message: string) {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') return resolve();

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';
    overlay.style.background = 'rgba(15, 23, 42, 0.38)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.dir = 'rtl';

    const card = document.createElement('div');
    card.style.width = 'min(460px, 100%)';
    card.style.borderRadius = '28px';
    card.style.border = '1px solid #dbe7ee';
    card.style.background = '#fff';
    card.style.boxShadow = '0 24px 80px rgba(15, 23, 42, 0.22)';
    card.style.padding = '24px';
    card.style.fontFamily = 'inherit';
    card.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;">${escapeHtml(title)}</h2>
      <p style="margin:0;color:#64748b;font-size:15px;font-weight:700;line-height:1.9;">${escapeHtml(message)}</p>
      <button type="button" data-ok style="margin-top:20px;border:0;background:#0f9299;color:#fff;border-radius:18px;padding:12px 22px;font-weight:900;cursor:pointer;">حسناً</button>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const cleanup = () => { overlay.remove(); resolve(); };
    card.querySelector<HTMLButtonElement>('[data-ok]')!.addEventListener('click', cleanup);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(); });
  });
}

export function requestActionConfirmation(title: string, message: string, confirmLabel = 'تأكيد') {
  return new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') return resolve(false);

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';
    overlay.style.background = 'rgba(15, 23, 42, 0.42)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.dir = 'rtl';

    const card = document.createElement('div');
    card.style.width = 'min(500px, 100%)';
    card.style.borderRadius = '28px';
    card.style.border = '1px solid #dbe7ee';
    card.style.background = '#fff';
    card.style.boxShadow = '0 24px 80px rgba(15, 23, 42, 0.22)';
    card.style.padding = '24px';
    card.style.fontFamily = 'inherit';
    const isDangerAction = /حذف|إلغاء|لم يحضر/.test(confirmLabel);
    const confirmBg = isDangerAction ? '#e11d48' : '#0f9299';
    const confirmShadow = isDangerAction ? '0 12px 30px rgba(225, 29, 72, 0.20)' : '0 12px 30px rgba(15,146,153,0.22)';
    card.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;">${escapeHtml(title)}</h2>
      <p style="margin:0;color:#64748b;font-size:15px;font-weight:700;line-height:1.9;">${escapeHtml(message)}</p>
      <div style="display:flex;align-items:center;justify-content:flex-start;gap:10px;margin-top:22px;">
        <button type="button" data-confirm style="border:0;background:${confirmBg};color:#fff;border-radius:18px;padding:12px 24px;min-width:120px;font-weight:900;cursor:pointer;box-shadow:${confirmShadow};">${escapeHtml(confirmLabel)}</button>
        <button type="button" data-cancel style="border:1px solid #dbe7ee;background:#fff;color:#334155;border-radius:18px;padding:12px 22px;min-width:120px;font-weight:900;cursor:pointer;">تراجع</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = (value: boolean) => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup(false);
      if (event.key === 'Enter') cleanup(true);
    };

    card.querySelector<HTMLButtonElement>('[data-confirm]')!.addEventListener('click', () => cleanup(true));
    card.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(false); });
    document.addEventListener('keydown', onKeyDown);
  });
}

export async function requestPasswordConfirmation(actionLabel: string) {
  const password = await createPasswordDialog(actionLabel);
  if (!password) return false;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.email) {
    await showSecureMessage('تعذر التحقق', 'تعذر التحقق من المستخدم الحالي. سجّل الدخول مرة أخرى.');
    return false;
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password
  });

  if (error) {
    await showSecureMessage('كلمة المرور غير صحيحة', 'كلمة المرور غير صحيحة أو تعذر التحقق منها.');
    return false;
  }

  return true;
}

type SafeActionResult = { ok: boolean; message: string };

const finishedAppointmentStatuses = '(completed,cancelled,no_show)';

function moneySummary(finalTotal: number, paidTotal: number, remainingTotal: number) {
  return `إجمالي التكاليف: ${finalTotal}، المدفوع: ${paidTotal}، المتبقي: ${remainingTotal}.`;
}

export async function canDeletePatientFinancially(clinicId: string, patientId: string): Promise<SafeActionResult> {
  const { count: openAppointments, error: appointmentError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .not('status', 'in', finishedAppointmentStatuses);

  if (appointmentError) return { ok: false, message: appointmentError.message };

  if ((openAppointments || 0) > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف المريض لأن لديه ${openAppointments} موعد غير مكتمل. أكمل الموعد أو غيّر حالته إلى مكتمل أو ملغى قبل الحذف.`
    };
  }

  const { data, error } = await supabase
    .from('treatment_plans')
    .select('id,title,final_amount,paid_amount,remaining_amount,status')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId);

  if (error) return { ok: false, message: error.message };

  const plans = data || [];
  const finalTotal = plans.reduce((sum, row: any) => sum + Number(row.final_amount || 0), 0);
  const paidTotal = plans.reduce((sum, row: any) => sum + Number(row.paid_amount || 0), 0);
  const remainingTotal = plans.reduce((sum, row: any) => sum + Number(row.remaining_amount || 0), 0);

  if (remainingTotal > 0 || finalTotal !== paidTotal) {
    return {
      ok: false,
      message: `لا يمكن حذف المريض لأن ملفه المالي غير مكتمل. ${moneySummary(finalTotal, paidTotal, remainingTotal)}`
    };
  }

  return { ok: true, message: '' };
}

export async function canChangeServiceSafely(clinicId: string, serviceId: string, actionLabel = 'تعديل الخدمة'): Promise<SafeActionResult> {
  const { count: openAppointments, error: appointmentError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('service_id', serviceId)
    .not('status', 'in', finishedAppointmentStatuses);

  if (appointmentError) return { ok: false, message: appointmentError.message };

  if ((openAppointments || 0) > 0) {
    return {
      ok: false,
      message: `لا يمكن ${actionLabel} لأن هناك ${openAppointments} موعد غير مكتمل مرتبط بهذه الخدمة. أكمل المواعيد أو ألغها قبل المتابعة.`
    };
  }

  const { data, error } = await supabase
    .from('treatment_plans')
    .select('id,title,final_amount,paid_amount,remaining_amount,status')
    .eq('clinic_id', clinicId)
    .eq('service_id', serviceId);

  if (error) return { ok: false, message: error.message };

  const incompletePlans = (data || []).filter((plan: any) => {
    const finalAmount = Number(plan.final_amount || 0);
    const paidAmount = Number(plan.paid_amount || 0);
    const remainingAmount = Number(plan.remaining_amount || 0);
    return remainingAmount > 0 || finalAmount !== paidAmount;
  });

  if (incompletePlans.length > 0) {
    const finalTotal = incompletePlans.reduce((sum: number, row: any) => sum + Number(row.final_amount || 0), 0);
    const paidTotal = incompletePlans.reduce((sum: number, row: any) => sum + Number(row.paid_amount || 0), 0);
    const remainingTotal = incompletePlans.reduce((sum: number, row: any) => sum + Number(row.remaining_amount || 0), 0);
    return {
      ok: false,
      message: `لا يمكن ${actionLabel} لأن هناك ${incompletePlans.length} ملف مالي غير مكتمل مرتبط بهذه الخدمة. ${moneySummary(finalTotal, paidTotal, remainingTotal)}`
    };
  }

  return { ok: true, message: '' };
}

export async function canDeleteTreatmentPlanSafely(
  clinicId: string,
  plan: { id: string; patient_id: string; service_id?: string | null; final_amount?: number; paid_amount?: number; remaining_amount?: number; title?: string }
): Promise<SafeActionResult> {
  if (plan.service_id) {
    const { count: openAppointments, error: appointmentError } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('patient_id', plan.patient_id)
      .eq('service_id', plan.service_id)
      .not('status', 'in', finishedAppointmentStatuses);

    if (appointmentError) return { ok: false, message: appointmentError.message };

    if ((openAppointments || 0) > 0) {
      return {
        ok: false,
        message: `لا يمكن حذف خطة العلاج لأن هناك ${openAppointments} موعد غير مكتمل مرتبط بها. أكمل الموعد أو ألغِه قبل الحذف.`
      };
    }
  }

  const finalAmount = Number(plan.final_amount || 0);
  const paidAmount = Number(plan.paid_amount || 0);
  const remainingAmount = Number(plan.remaining_amount || 0);

  if (remainingAmount > 0 || finalAmount !== paidAmount) {
    return {
      ok: false,
      message: `لا يمكن حذف خطة العلاج لأن ملفها المالي غير مكتمل. ${moneySummary(finalAmount, paidAmount, remainingAmount)}`
    };
  }

  const { count: paymentsCount, error: paymentsError } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('treatment_plan_id', plan.id);

  if (paymentsError) return { ok: false, message: paymentsError.message };

  if ((paymentsCount || 0) > 0) {
    return {
      ok: false,
      message: 'لا يمكن حذف خطة علاج عليها دفعات محفوظة. يمكن تغيير حالتها إلى مكتملة أو ملغاة بدلاً من حذف السجل المالي.'
    };
  }

  return { ok: true, message: '' };
}
