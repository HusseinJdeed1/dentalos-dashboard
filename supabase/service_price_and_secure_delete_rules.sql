-- قواعد التعديل والحذف الآمن:
-- 1) الخدمات تحتوي على تكلفة افتراضية.
-- 2) لا يمكن حذف مريض لديه مواعيد غير مكتملة أو ملف مالي غير مكتمل.
-- 3) لا يمكن تعديل أو حذف خدمة مرتبطة بمواعيد غير مكتملة أو ملفات مالية غير مكتملة.

alter table public.services
add column if not exists price numeric default 0;

alter table public.appointments
add column if not exists treatment_cost numeric;

update public.services
set price = 0
where price is null;

alter table public.services
alter column price set default 0;

alter table public.services
alter column price set not null;

create or replace function public.prevent_patient_delete_if_incomplete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_appointments integer := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
begin
  select count(*)
  into v_open_appointments
  from public.appointments
  where clinic_id = old.clinic_id
    and patient_id = old.id
    and status not in ('completed', 'cancelled', 'no_show');

  if v_open_appointments > 0 then
    raise exception 'لا يمكن حذف المريض لأن لديه % موعد غير مكتمل. أكمل الموعد أو غيّر حالته إلى مكتمل أو ملغى قبل الحذف.', v_open_appointments;
  end if;

  select
    coalesce(sum(final_amount), 0),
    coalesce(sum(paid_amount), 0),
    coalesce(sum(remaining_amount), 0)
  into v_total, v_paid, v_remaining
  from public.treatment_plans
  where clinic_id = old.clinic_id
    and patient_id = old.id;

  if v_remaining > 0 or v_total <> v_paid then
    raise exception 'لا يمكن حذف المريض لأن ملفه المالي غير مكتمل. إجمالي التكاليف: %، المدفوع: %، المتبقي: %.', v_total, v_paid, v_remaining;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_patient_delete_if_incomplete on public.patients;

create trigger trg_prevent_patient_delete_if_incomplete
before delete on public.patients
for each row
execute function public.prevent_patient_delete_if_incomplete();

create or replace function public.prevent_service_change_if_incomplete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_appointments integer := 0;
  v_incomplete_plans integer := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_action text := 'تعديل أو حذف الخدمة';
begin
  if tg_op = 'DELETE' then
    v_action := 'حذف الخدمة';
  elsif tg_op = 'UPDATE' then
    v_action := 'تعديل الخدمة';
  end if;

  select count(*)
  into v_open_appointments
  from public.appointments
  where clinic_id = old.clinic_id
    and service_id = old.id
    and status not in ('completed', 'cancelled', 'no_show');

  if v_open_appointments > 0 then
    raise exception 'لا يمكن % لأن هناك % موعد غير مكتمل مرتبط بهذه الخدمة. أكمل المواعيد أو ألغها قبل المتابعة.', v_action, v_open_appointments;
  end if;

  select
    count(*),
    coalesce(sum(final_amount), 0),
    coalesce(sum(paid_amount), 0),
    coalesce(sum(remaining_amount), 0)
  into v_incomplete_plans, v_total, v_paid, v_remaining
  from public.treatment_plans
  where clinic_id = old.clinic_id
    and service_id = old.id
    and (
      coalesce(remaining_amount, 0) > 0
      or coalesce(final_amount, 0) <> coalesce(paid_amount, 0)
    );

  if v_incomplete_plans > 0 then
    raise exception 'لا يمكن % لأن هناك % ملف مالي غير مكتمل مرتبط بهذه الخدمة. إجمالي التكاليف: %، المدفوع: %، المتبقي: %.', v_action, v_incomplete_plans, v_total, v_paid, v_remaining;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_service_change_if_incomplete on public.services;

create trigger trg_prevent_service_change_if_incomplete
before update or delete on public.services
for each row
execute function public.prevent_service_change_if_incomplete();


-- حماية إضافية: منع حذف المريض من قاعدة البيانات إذا لديه مواعيد غير مكتملة أو ملف مالي غير مكتمل.
create or replace function public.prevent_patient_delete_if_not_ready()
returns trigger
language plpgsql
security definer
as $$
declare
  v_open_appointments integer := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
begin
  select count(*)
  into v_open_appointments
  from public.appointments
  where patient_id = old.id
    and status not in ('completed', 'cancelled', 'no_show');

  if v_open_appointments > 0 then
    raise exception 'لا يمكن حذف المريض لأن لديه % موعد غير مكتمل. أكمل المواعيد أو ألغها قبل الحذف.', v_open_appointments;
  end if;

  select
    coalesce(sum(final_amount), 0),
    coalesce(sum(paid_amount), 0),
    coalesce(sum(remaining_amount), 0)
  into v_total, v_paid, v_remaining
  from public.treatment_plans
  where patient_id = old.id;

  if v_remaining > 0 or v_total <> v_paid then
    raise exception 'لا يمكن حذف المريض لأن ملفه المالي غير مكتمل. إجمالي التكاليف: %، المدفوع: %، المتبقي: %.', v_total, v_paid, v_remaining;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_patient_delete_if_financial_incomplete on public.patients;
drop trigger if exists trg_prevent_patient_delete_if_not_ready on public.patients;

create trigger trg_prevent_patient_delete_if_not_ready
before delete on public.patients
for each row
execute function public.prevent_patient_delete_if_not_ready();
