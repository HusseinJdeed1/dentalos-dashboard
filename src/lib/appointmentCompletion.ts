import { supabase } from './supabase';

export type VisitToothInput = {
  toothNumber: string;
  procedureDone: string;
  oldStatus?: string | null;
  newStatus: string;
  notes?: string | null;
};

export type AppointmentCompletionInput = {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  serviceId?: string | null;
  visitDate: string;
  procedureDone: string;
  doctorNotes: string;
  createdBy?: string | null;
  teeth?: VisitToothInput[];
};

export async function completeAppointmentWithVisit(input: AppointmentCompletionInput) {
  const procedureDone = input.procedureDone.trim();
  const doctorNotes = input.doctorNotes.trim();
  const teeth = (input.teeth || [])
    .map((tooth) => ({
      ...tooth,
      toothNumber: tooth.toothNumber.trim(),
      procedureDone: tooth.procedureDone.trim(),
      notes: tooth.notes?.trim() || null
    }))
    .filter((tooth) => tooth.toothNumber && tooth.procedureDone && tooth.newStatus);

  if (!procedureDone) return { error: 'أدخل وصفاً مختصراً لما تم إجراؤه في جلسة العلاج.' };
  if (!doctorNotes) return { error: 'أدخل الملاحظات الطبية الخاصة بهذه الجلسة.' };

  let treatmentPlanId: string | null = null;

  if (input.serviceId) {
    const { data: planData, error: planError } = await supabase
      .from('treatment_plans')
      .select('id')
      .eq('clinic_id', input.clinicId)
      .eq('patient_id', input.patientId)
      .eq('service_id', input.serviceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planError) return { error: planError.message };
    treatmentPlanId = planData?.id || null;
  }

  const { data: visitData, error: visitError } = await supabase.from('visits').insert({
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    treatment_plan_id: treatmentPlanId,
    appointment_id: input.appointmentId,
    service_id: input.serviceId || null,
    visit_date: input.visitDate,
    procedure_done: procedureDone,
    doctor_notes: doctorNotes
  }).select('id').single();

  if (visitError) return { error: visitError.message };

  const visitId = visitData?.id as string | undefined;
  if (!visitId) return { error: 'تم إنشاء الجلسة لكن لم يتم استرجاع رقمها.' };

  if (teeth.length) {
    const visitTeethPayload = teeth.map((tooth) => ({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      visit_id: visitId,
      tooth_number: tooth.toothNumber,
      procedure_done: tooth.procedureDone,
      old_status: tooth.oldStatus || null,
      new_status: tooth.newStatus,
      notes: tooth.notes,
      created_by: input.createdBy || null
    }));

    const { error: visitTeethError } = await supabase.from('visit_teeth').insert(visitTeethPayload);
    if (visitTeethError) return { error: visitTeethError.message };

    const chartPayload = teeth.map((tooth) => ({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      tooth_number: tooth.toothNumber,
      status: tooth.newStatus,
      procedure_name: tooth.procedureDone,
      notes: tooth.notes || doctorNotes || null,
      updated_by: input.createdBy || null,
      last_visit_id: visitId,
      updated_at: new Date().toISOString()
    }));

    const { error: chartError } = await supabase
      .from('patient_dental_chart')
      .upsert(chartPayload, { onConflict: 'clinic_id,patient_id,tooth_number' });
    if (chartError) return { error: chartError.message };
  }

  const { error: appointmentError } = await supabase
    .from('appointments')
    .update({ status: 'completed' })
    .eq('id', input.appointmentId)
    .eq('clinic_id', input.clinicId);

  if (appointmentError) return { error: appointmentError.message };

  return { error: null, visitId };
}
