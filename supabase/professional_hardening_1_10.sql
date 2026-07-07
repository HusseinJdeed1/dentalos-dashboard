-- DentalOS professional hardening 1-10.
-- Run this after previous SQL files. It fixes staff security, secure counters,
-- storage assets, attachment limits, appointment overlaps, installments, and export support.

create extension if not exists pgcrypto;

alter table public.clinics
add column if not exists clinic_timezone text not null default 'Asia/Damascus';

alter table public.staff_users
add column if not exists email text,
add column if not exists is_active boolean not null default true,
add column if not exists last_seen_at timestamptz;

alter table public.patient_images
add column if not exists storage_path text,
add column if not exists file_name text,
add column if not exists file_type text,
add column if not exists file_size integer;

create unique index if not exists idx_staff_users_clinic_email_unique
on public.staff_users (clinic_id, lower(email))
where email is not null and email <> '';

create index if not exists idx_staff_users_clinic_role on public.staff_users(clinic_id, role);
create index if not exists idx_patient_images_clinic_patient on public.patient_images(clinic_id, patient_id, created_at desc);
create index if not exists idx_patient_images_storage_path on public.patient_images(storage_path);
create index if not exists idx_appointments_clinic_date_time on public.appointments(clinic_id, appointment_date, appointment_time);
create index if not exists idx_appointments_clinic_status_date on public.appointments(clinic_id, status, appointment_date);
create index if not exists idx_patients_clinic_created on public.patients(clinic_id, created_at desc);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  staff_id uuid references public.staff_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_logs enable row level security;

drop policy if exists activity_logs_read on public.activity_logs;
drop policy if exists activity_logs_insert on public.activity_logs;

create policy activity_logs_read on public.activity_logs
for select to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

create policy activity_logs_insert on public.activity_logs
for insert to authenticated
with check (clinic_id = public.current_clinic_id());

create index if not exists idx_activity_logs_clinic_date on public.activity_logs(clinic_id, created_at desc);
create index if not exists idx_activity_logs_entity on public.activity_logs(entity_type, entity_id);

-- Staff security: read team inside clinic, but write team only through Edge Functions/service role.
drop policy if exists staff_admin on public.staff_users;
drop policy if exists staff_manage_admin_doctor on public.staff_users;
drop policy if exists staff_select_same_clinic on public.staff_users;
drop policy if exists staff_update_same_clinic on public.staff_users;
drop policy if exists staff_insert_same_clinic on public.staff_users;
drop policy if exists staff_delete_same_clinic on public.staff_users;

create policy staff_select_same_clinic on public.staff_users
for select to authenticated
using (clinic_id = public.current_clinic_id());

-- No direct insert/update/delete policies are created for staff_users.
-- Use Edge Functions: create-staff-member, update-staff-member, set-staff-active.

create or replace function public.update_own_last_seen()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.staff_users
  set last_seen_at = now()
  where user_id = auth.uid()
    and clinic_id = public.current_clinic_id();
end;
$$;

grant execute on function public.update_own_last_seen() to authenticated;

create or replace function public.update_own_staff_avatar(p_avatar_url text)
returns table(id uuid, avatar_url text)
language plpgsql security definer set search_path = public as $$
begin
  if p_avatar_url is not null and length(p_avatar_url) > 2500000 then
    raise exception 'avatar_url is too large';
  end if;

  return query
  update public.staff_users as s
  set avatar_url = p_avatar_url
  where s.user_id = auth.uid()
    and s.clinic_id = public.current_clinic_id()
  returning s.id, s.avatar_url;
end;
$$;

grant execute on function public.update_own_staff_avatar(text) to authenticated;

-- Patient files storage bucket and DB-level limit of 10 attachments per patient.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files',
  'patient-files',
  false,
  10485760,
  array[
    'image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists patient_files_select on storage.objects;
drop policy if exists patient_files_insert on storage.objects;
drop policy if exists patient_files_update on storage.objects;
drop policy if exists patient_files_delete on storage.objects;

create policy patient_files_select on storage.objects
for select to authenticated
using (bucket_id = 'patient-files' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

create policy patient_files_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'patient-files' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

create policy patient_files_update on storage.objects
for update to authenticated
using (bucket_id = 'patient-files' and (storage.foldername(name))[1] = public.current_clinic_id()::text)
with check (bucket_id = 'patient-files' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

create policy patient_files_delete on storage.objects
for delete to authenticated
using (bucket_id = 'patient-files' and (storage.foldername(name))[1] = public.current_clinic_id()::text and public.current_staff_role() in ('admin','doctor'));

create or replace function public.enforce_patient_file_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  select count(*) into current_count
  from public.patient_images
  where clinic_id = new.clinic_id and patient_id = new.patient_id and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if current_count >= 10 then
    raise exception 'لا يمكن إضافة أكثر من 10 صور أو ملفات لهذا المريض.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_patient_file_limit on public.patient_images;
create trigger trg_patient_file_limit
before insert on public.patient_images
for each row execute function public.enforce_patient_file_limit();

create or replace view public.patient_files as
select * from public.patient_images;

-- Public visual assets only: clinic logo + staff avatars. Medical files remain private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('clinic-assets', 'clinic-assets', true, 2097152, array['image/jpeg','image/png','image/webp','image/gif']::text[]),
  ('staff-avatars', 'staff-avatars', true, 2097152, array['image/jpeg','image/png','image/webp','image/gif']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists clinic_assets_insert on storage.objects;
drop policy if exists clinic_assets_update on storage.objects;
drop policy if exists clinic_assets_delete on storage.objects;
drop policy if exists staff_avatars_insert on storage.objects;
drop policy if exists staff_avatars_update on storage.objects;
drop policy if exists staff_avatars_delete on storage.objects;

create policy clinic_assets_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'clinic-assets' and (storage.foldername(name))[1] = public.current_clinic_id()::text and public.current_staff_role() in ('admin','doctor'));

create policy clinic_assets_update on storage.objects
for update to authenticated
using (bucket_id = 'clinic-assets' and (storage.foldername(name))[1] = public.current_clinic_id()::text and public.current_staff_role() in ('admin','doctor'))
with check (bucket_id = 'clinic-assets' and (storage.foldername(name))[1] = public.current_clinic_id()::text and public.current_staff_role() in ('admin','doctor'));

create policy clinic_assets_delete on storage.objects
for delete to authenticated
using (bucket_id = 'clinic-assets' and (storage.foldername(name))[1] = public.current_clinic_id()::text and public.current_staff_role() in ('admin','doctor'));

create policy staff_avatars_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'staff-avatars' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

create policy staff_avatars_update on storage.objects
for update to authenticated
using (bucket_id = 'staff-avatars' and (storage.foldername(name))[1] = public.current_clinic_id()::text)
with check (bucket_id = 'staff-avatars' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

create policy staff_avatars_delete on storage.objects
for delete to authenticated
using (bucket_id = 'staff-avatars' and (storage.foldername(name))[1] = public.current_clinic_id()::text);

-- Secure dashboard counts: do not trust a client-supplied clinic_id.
create or replace function public.dashboard_alert_counts()
returns table(
  pending_count bigint,
  today_open_count bigint,
  overdue_count bigint,
  no_show_followup_count bigint,
  missing_visit_notes_count bigint,
  active_plans_without_next_count bigint
)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select public.current_clinic_id() as clinic_id
  ), open_statuses as (
    select unnest(array['pending','confirmed','arrived']) as status
  ), future_patients as (
    select distinct a.patient_id from public.appointments a, scoped s
    where a.clinic_id = s.clinic_id and a.appointment_date >= current_date and a.status in (select status from open_statuses)
  ), future_patient_services as (
    select distinct a.patient_id, a.service_id from public.appointments a, scoped s
    where a.clinic_id = s.clinic_id and a.appointment_date >= current_date and a.status in (select status from open_statuses)
  )
  select
    (select count(*) from public.appointments a, scoped s where a.clinic_id = s.clinic_id and a.status = 'pending') as pending_count,
    (select count(*) from public.appointments a, scoped s where a.clinic_id = s.clinic_id and a.appointment_date = current_date and a.status in (select status from open_statuses)) as today_open_count,
    (select count(*) from public.appointments a, scoped s where a.clinic_id = s.clinic_id and a.status in (select status from open_statuses) and (a.appointment_date < current_date or (a.appointment_date = current_date and a.appointment_time < localtime))) as overdue_count,
    (select count(*) from public.appointments a, scoped s where a.clinic_id = s.clinic_id and a.status = 'no_show' and not exists (select 1 from future_patients fp where fp.patient_id = a.patient_id)) as no_show_followup_count,
    (select count(*) from public.visits v, scoped s where v.clinic_id = s.clinic_id and (coalesce(trim(v.procedure_done),'') = '' or coalesce(trim(v.doctor_notes),'') = '')) as missing_visit_notes_count,
    (select count(*) from public.treatment_plans p, scoped s where p.clinic_id = s.clinic_id and p.status = 'active' and not exists (select 1 from future_patients fp where fp.patient_id = p.patient_id) and not exists (select 1 from future_patient_services fps where fps.patient_id = p.patient_id and fps.service_id is not distinct from p.service_id)) as active_plans_without_next_count;
$$;

grant execute on function public.dashboard_alert_counts() to authenticated;

create or replace function public.dashboard_alert_counts(target_clinic_id uuid)
returns table(
  pending_count bigint,
  today_open_count bigint,
  overdue_count bigint,
  no_show_followup_count bigint,
  missing_visit_notes_count bigint,
  active_plans_without_next_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if target_clinic_id is distinct from public.current_clinic_id() then
    raise exception 'غير مصرح بالوصول إلى عدادات عيادة أخرى.';
  end if;
  return query select * from public.dashboard_alert_counts();
end;
$$;

grant execute on function public.dashboard_alert_counts(uuid) to authenticated;

-- Appointment overlap protection using service duration.
create or replace function public.appointment_duration_minutes(p_service_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select greatest(5, coalesce((select duration_minutes from public.services where id = p_service_id), 30));
$$;

create or replace function public.prevent_overlapping_appointments()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_start time;
  new_end time;
begin
  if new.status in ('cancelled','no_show') then
    return new;
  end if;

  new_start := new.appointment_time;
  new_end := (new.appointment_time + (public.appointment_duration_minutes(new.service_id) || ' minutes')::interval)::time;

  if exists (
    select 1
    from public.appointments a
    where a.clinic_id = new.clinic_id
      and a.appointment_date = new.appointment_date
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and a.status not in ('cancelled','no_show')
      and new_start < (a.appointment_time + (public.appointment_duration_minutes(a.service_id) || ' minutes')::interval)::time
      and a.appointment_time < new_end
  ) then
    raise exception 'يوجد موعد آخر يتداخل مع مدة هذه الخدمة.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_overlapping_appointments on public.appointments;
create trigger trg_prevent_overlapping_appointments
before insert or update of appointment_date, appointment_time, service_id, status on public.appointments
for each row execute function public.prevent_overlapping_appointments();

-- Real installments table for accurate overdue reports.
create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_plan_id uuid references public.treatment_plans(id) on delete cascade,
  due_date date not null,
  amount numeric not null check (amount > 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  status text not null default 'pending' check (status in ('pending','partial','paid','cancelled')),
  notes text,
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.installments enable row level security;

drop policy if exists installments_financial on public.installments;
create policy installments_financial on public.installments
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create index if not exists idx_installments_clinic_due on public.installments(clinic_id, due_date, status);
create index if not exists idx_installments_patient_plan on public.installments(patient_id, treatment_plan_id);

create or replace function public.overdue_installments_count()
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.installments
  where clinic_id = public.current_clinic_id()
    and due_date < current_date
    and status in ('pending','partial')
    and amount > paid_amount;
$$;

grant execute on function public.overdue_installments_count() to authenticated;


-- Included finance installments/payments link patch.
-- Finance simplification: installments are due dates only; payments are the source of truth.
-- Run this after professional_hardening_1_10.sql.

create extension if not exists pgcrypto;

-- Make existing installments tables compatible with the simplified model.
alter table public.installments
add column if not exists installment_number integer,
add column if not exists paid_amount numeric default 0,
add column if not exists notes text,
add column if not exists created_by uuid references public.staff_users(id) on delete set null,
add column if not exists created_at timestamptz not null default now();

update public.installments
set paid_amount = 0
where paid_amount is null;

alter table public.installments
alter column paid_amount set default 0;

alter table public.installments
alter column paid_amount set not null;

update public.installments
set status = 'pending'
where status is null;

-- Normalize old status constraints if an earlier table had a different allowed list.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.installments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.installments drop constraint if exists %I', c.conname);
  end loop;

  alter table public.installments
  add constraint installments_status_check
  check (status in ('pending','partial','paid','cancelled'));
end $$;

alter table public.installments
alter column status set default 'pending';

with numbered as (
  select
    id,
    row_number() over (
      partition by clinic_id, patient_id, treatment_plan_id
      order by coalesce(created_at, now()), due_date, id
    ) as rn
  from public.installments
  where installment_number is null
)
update public.installments i
set installment_number = numbered.rn
from numbered
where i.id = numbered.id;

create or replace function public.set_installment_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.installment_number is null then
    select coalesce(max(i.installment_number), 0) + 1
    into new.installment_number
    from public.installments i
    where i.clinic_id = new.clinic_id
      and i.patient_id = new.patient_id
      and i.treatment_plan_id is not distinct from new.treatment_plan_id
      and i.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  if new.installment_number is null or new.installment_number < 1 then
    new.installment_number := 1;
  end if;

  -- The payment table is the source of truth. Do not ask the UI to set these.
  if tg_op = 'INSERT' then
    new.paid_amount := coalesce(new.paid_amount, 0);
    if new.status is null then new.status := 'pending'; end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_installment_number on public.installments;
create trigger trg_set_installment_number
before insert on public.installments
for each row
execute function public.set_installment_number();

alter table public.installments
alter column installment_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.installments'::regclass
      and conname = 'installments_installment_number_positive'
  ) then
    alter table public.installments
    add constraint installments_installment_number_positive
    check (installment_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.installments'::regclass
      and conname = 'installments_paid_amount_nonnegative'
  ) then
    alter table public.installments
    add constraint installments_paid_amount_nonnegative
    check (paid_amount >= 0);
  end if;
end $$;

-- Link real payments to optional installments.
alter table public.payments
add column if not exists installment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_installment_id_fkey'
  ) then
    alter table public.payments
    add constraint payments_installment_id_fkey
    foreign key (installment_id)
    references public.installments(id)
    on delete set null;
  end if;
end $$;

create index if not exists idx_payments_installment_id on public.payments(installment_id);
create index if not exists idx_payments_plan_installment on public.payments(treatment_plan_id, installment_id);

-- A payment can only be attached to an installment from the same clinic, patient, and treatment plan.
create or replace function public.validate_payment_installment_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare target_installment public.installments%rowtype;
begin
  if new.installment_id is null then
    return new;
  end if;

  select * into target_installment
  from public.installments
  where id = new.installment_id;

  if not found then
    raise exception 'القسط المحدد غير موجود.';
  end if;

  if target_installment.clinic_id is distinct from new.clinic_id
     or target_installment.patient_id is distinct from new.patient_id then
    raise exception 'لا يمكن ربط الدفعة بقسط تابع لمريض أو عيادة أخرى.';
  end if;

  if new.treatment_plan_id is null then
    new.treatment_plan_id := target_installment.treatment_plan_id;
  end if;

  if target_installment.treatment_plan_id is distinct from new.treatment_plan_id then
    raise exception 'القسط المحدد لا يتبع خطة العلاج المختارة.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_payment_installment_link on public.payments;
create trigger trg_validate_payment_installment_link
before insert or update of clinic_id, patient_id, treatment_plan_id, installment_id on public.payments
for each row
execute function public.validate_payment_installment_link();

-- Recalculate installment paid amount and status from linked payments only.
create or replace function public.recalculate_installment(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_amount numeric;
  v_status text;
begin
  if p_installment_id is null then
    return;
  end if;

  select amount, status
  into v_amount, v_status
  from public.installments
  where id = p_installment_id;

  if not found then
    return;
  end if;

  select coalesce(sum(case when payment_type = 'refund' then -amount else amount end), 0)
  into v_paid
  from public.payments
  where installment_id = p_installment_id;

  v_paid := greatest(coalesce(v_paid, 0), 0);

  update public.installments
  set paid_amount = v_paid,
      status = case
        when v_status = 'cancelled' then 'cancelled'
        when v_paid >= coalesce(v_amount, 0) and coalesce(v_amount, 0) > 0 then 'paid'
        when v_paid > 0 then 'partial'
        else 'pending'
      end
  where id = p_installment_id;
end;
$$;

-- Update treatment plan and installment totals whenever payments change.
create or replace function public.payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recalculate_treatment_plan(new.treatment_plan_id);
    perform public.recalculate_installment(new.installment_id);
  end if;

  if tg_op in ('UPDATE','DELETE') then
    perform public.recalculate_treatment_plan(old.treatment_plan_id);
    perform public.recalculate_installment(old.installment_id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payments_recalculate on public.payments;
create trigger trg_payments_recalculate
after insert or update or delete on public.payments
for each row
execute function public.payments_after_change();

-- If an installment amount changes, refresh its status from linked payments.
create or replace function public.installments_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    perform public.recalculate_installment(new.id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_installments_recalculate on public.installments;
create trigger trg_installments_recalculate
after insert or update of amount, status on public.installments
for each row
execute function public.installments_after_change();

-- Backfill current installment paid amounts from existing linked payments.
do $$
declare r record;
begin
  for r in select id from public.installments loop
    perform public.recalculate_installment(r.id);
  end loop;
end $$;

create or replace function public.overdue_installments_count()
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from public.installments
  where clinic_id = public.current_clinic_id()
    and due_date < current_date
    and status in ('pending','partial')
    and amount > coalesce(paid_amount, 0);
$$;

grant execute on function public.recalculate_installment(uuid) to authenticated;
grant execute on function public.overdue_installments_count() to authenticated;

select pg_notify('pgrst', 'reload schema');
