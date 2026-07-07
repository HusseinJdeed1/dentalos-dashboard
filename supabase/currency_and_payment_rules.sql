-- إصلاح حفظ العملة للطبيب والمدير
alter table public.clinics
add column if not exists currency_code text not null default 'SAR',
add column if not exists currency_symbol text not null default 'ر.س';

alter table public.clinics
drop constraint if exists clinics_currency_code_check;

alter table public.clinics
add constraint clinics_currency_code_check
check (currency_code in ('USD','SYP','SAR','AED','QAR','KWD','BHD','OMR','IQD','LBP','JOD'));

drop policy if exists clinics_update_admin on public.clinics;
drop policy if exists clinics_update_admin_doctor on public.clinics;

create policy clinics_update_admin_doctor on public.clinics
for update to authenticated
using (
  id = public.current_clinic_id()
  and public.current_staff_role() in ('admin','doctor')
)
with check (
  id = public.current_clinic_id()
  and public.current_staff_role() in ('admin','doctor')
);

-- منع حفظ دفعة بدون خطة علاج
update public.payments p
set treatment_plan_id = tp.id
from public.treatment_plans tp
where p.treatment_plan_id is null
  and p.patient_id = tp.patient_id
  and tp.id = (
    select tp2.id
    from public.treatment_plans tp2
    where tp2.patient_id = p.patient_id
    order by tp2.created_at desc
    limit 1
  );

alter table public.payments
alter column treatment_plan_id set not null;

create or replace function public.validate_payment_treatment_plan_patient()
returns trigger
language plpgsql
as $$
declare
  v_patient_id uuid;
begin
  select patient_id into v_patient_id
  from public.treatment_plans
  where id = new.treatment_plan_id;

  if v_patient_id is null then
    raise exception 'خطة العلاج غير موجودة';
  end if;

  if v_patient_id <> new.patient_id then
    raise exception 'خطة العلاج لا تخص هذا المريض';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_payment_treatment_plan_patient on public.payments;

create trigger trg_validate_payment_treatment_plan_patient
before insert or update of treatment_plan_id, patient_id
on public.payments
for each row
execute function public.validate_payment_treatment_plan_patient();
