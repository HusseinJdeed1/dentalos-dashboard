-- إنشاء أو استخدام خطة علاج تلقائياً عند إضافة موعد بخدمة

alter table public.appointments
add column if not exists treatment_cost numeric;

-- الهدف: من واجهة الطبيب تبدو الخدمة وخطة العلاج كشيء واحد، مع بقاء قاعدة البيانات صحيحة.

create or replace function public.ensure_treatment_plan_for_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service record;
  v_existing_plan_id uuid;
  v_price numeric := 0;
begin
  if new.service_id is null then
    return new;
  end if;

  select id, clinic_id, name, category, price
  into v_service
  from public.services
  where id = new.service_id
    and clinic_id = new.clinic_id;

  if v_service.id is null then
    return new;
  end if;

  select id
  into v_existing_plan_id
  from public.treatment_plans
  where clinic_id = new.clinic_id
    and patient_id = new.patient_id
    and service_id = new.service_id
    and status in ('active', 'paused')
  order by created_at desc
  limit 1;

  if v_existing_plan_id is null then
    -- نستخدم تكلفة الموعد إذا عدلها الطبيب، وإلا نستخدم التكلفة الافتراضية من الخدمة.
    v_price := coalesce(new.treatment_cost, v_service.price, 0);

    insert into public.treatment_plans (
      clinic_id,
      patient_id,
      service_id,
      title,
      dental_category,
      total_amount,
      discount_amount,
      final_amount,
      paid_amount,
      remaining_amount,
      status,
      notes
    ) values (
      new.clinic_id,
      new.patient_id,
      new.service_id,
      v_service.name,
      v_service.category,
      v_price,
      0,
      v_price,
      0,
      v_price,
      'active',
      'تم إنشاء خطة العلاج تلقائياً من الموعد.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_treatment_plan_for_appointment on public.appointments;

create trigger trg_ensure_treatment_plan_for_appointment
after insert or update of patient_id, service_id
on public.appointments
for each row
when (new.service_id is not null)
execute function public.ensure_treatment_plan_for_appointment();
