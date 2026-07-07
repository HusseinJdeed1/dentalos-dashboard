create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  logo_url text,
  theme_id text not null default 'dental-clean' check (theme_id in ('dental-clean','soft-rose','navy-pro','luxury-beige','emerald')),
  created_at timestamptz default now()
);

create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null unique,
  email text,
  full_name text not null,
  role text not null check (role in ('admin','doctor','secretary')),
  phone text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  full_name text not null,
  phone text not null,
  birth_date date,
  gender text check (gender in ('male','female')),
  address text,
  medical_notes text,
  created_at timestamptz default now()
);

create table if not exists public.patient_images (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  image_data text not null,
  description text,
  file_name text,
  file_type text,
  file_size integer,
  created_at timestamptz not null default now()
);

alter table public.patient_images
add column if not exists file_name text,
add column if not exists file_type text,
add column if not exists file_size integer;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  category text,
  description text,
  price numeric not null default 0,
  duration_minutes integer not null default 30,
  is_installment_available boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'pending' check (status in ('pending','confirmed','arrived','completed','cancelled','no_show')),
  treatment_cost numeric,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  dental_category text,
  total_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  final_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  status text not null default 'active' check (status in ('active','completed','cancelled','paused')),
  start_date date default current_date,
  expected_end_date date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_plan_id uuid references public.treatment_plans(id) on delete set null,
  amount numeric not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','transfer','card','other')),
  payment_type text not null default 'installment' check (payment_type in ('down_payment','installment','full_payment','extra_payment','refund')),
  payment_date date not null default current_date,
  notes text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  category text not null,
  amount numeric not null check (amount > 0),
  expense_date date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash','transfer','card','other')),
  notes text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_plan_id uuid references public.treatment_plans(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  visit_date date not null default current_date,
  session_number integer default 1,
  procedure_done text,
  doctor_notes text,
  next_visit_date date,
  created_at timestamptz default now()
);

create table if not exists public.clinic_working_hours (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  is_open boolean not null default true,
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  break_start time,
  break_end time,
  slot_duration_minutes integer not null default 30,
  created_at timestamptz default now(),
  unique(clinic_id, day_of_week)
);

create or replace function public.current_clinic_id()
returns uuid language sql stable security definer set search_path = public as $$
  select clinic_id from public.staff_users where user_id = auth.uid() limit 1;
$$;

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff_users where user_id = auth.uid() limit 1;
$$;


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

create or replace function public.can_view_financials()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('admin','doctor'), false);
$$;

create or replace function public.recalculate_treatment_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_final numeric;
begin
  if p_plan_id is null then return; end if;
  select coalesce(sum(case when payment_type='refund' then -amount else amount end),0) into v_paid from public.payments where treatment_plan_id = p_plan_id;
  select final_amount into v_final from public.treatment_plans where id = p_plan_id;
  update public.treatment_plans set paid_amount = v_paid, remaining_amount = greatest(coalesce(v_final,0)-v_paid,0), status = case when coalesce(v_final,0)>0 and v_paid >= coalesce(v_final,0) then 'completed' else status end where id = p_plan_id;
end; $$;

create or replace function public.payments_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public.recalculate_treatment_plan(new.treatment_plan_id); end if;
  if tg_op in ('UPDATE','DELETE') then perform public.recalculate_treatment_plan(old.treatment_plan_id); end if;
  return null;
end; $$;

drop trigger if exists trg_payments_recalculate on public.payments;
create trigger trg_payments_recalculate after insert or update or delete on public.payments for each row execute function public.payments_after_change();

alter table public.clinics enable row level security;
alter table public.staff_users enable row level security;
alter table public.patients enable row level security;
alter table public.patient_images enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.treatment_plans enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.visits enable row level security;
alter table public.clinic_working_hours enable row level security;

do $$ declare r record; begin for r in (select tablename, policyname from pg_policies where schemaname='public') loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop; end $$;

-- العيادة: جميع العاملين يرون بيانات عيادتهم، والتعديل للطبيب/المدير فقط.
create policy clinics_read on public.clinics
for select to authenticated
using (id = public.current_clinic_id());

create policy clinics_update_admin_doctor on public.clinics
for update to authenticated
using (id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

-- المستخدمون: العامل يرى فريق عيادته، والإدارة للمدير فقط.
create policy staff_read on public.staff_users
for select to authenticated
using (clinic_id = public.current_clinic_id());

create policy staff_admin on public.staff_users
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() = 'admin')
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() = 'admin');

-- المرضى والمواعيد والزيارات: مسموحة للطبيب والسكرتيرة والمدير داخل نفس العيادة.
create policy patients_all on public.patients
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

create policy appointments_all on public.appointments
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

create policy visits_all on public.visits
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());


create policy patient_images_all on public.patient_images
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

-- أوقات الدوام: مسموحة للطبيب والسكرتيرة والمدير داخل نفس العيادة.
create policy working_hours_all on public.clinic_working_hours
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

-- الخدمات: السكرتيرة يمكنها القراءة لاستخدامها في المواعيد، لكن تعديل الأسعار والخدمات للطبيب/المدير فقط.
create policy services_read on public.services
for select to authenticated
using (clinic_id = public.current_clinic_id());

create policy services_write_financial on public.services
for insert to authenticated
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create policy services_update_financial on public.services
for update to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create policy services_delete_financial on public.services
for delete to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials());

-- المعلومات المالية الكاملة: مخفية عن السكرتيرة ومسموحة للطبيب والمدير فقط.
create policy treatment_plans_financial on public.treatment_plans
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create policy payments_financial on public.payments
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create policy expenses_financial on public.expenses
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create index if not exists idx_staff_user on public.staff_users(user_id);
create unique index if not exists idx_staff_users_clinic_email_unique on public.staff_users (clinic_id, lower(email)) where email is not null and email <> '';
create index if not exists idx_patients_clinic on public.patients(clinic_id);
create index if not exists idx_patient_images_clinic_patient on public.patient_images(clinic_id, patient_id, created_at desc);
create index if not exists idx_appointments_clinic_date on public.appointments(clinic_id, appointment_date);
create index if not exists idx_payments_clinic_date on public.payments(clinic_id, payment_date);
create index if not exists idx_treatment_plans_clinic_patient on public.treatment_plans(clinic_id, patient_id);

create index if not exists idx_working_hours_clinic_day on public.clinic_working_hours(clinic_id, day_of_week);
-- Professional dashboard upgrade: storage, activity log, team metadata, timezone, and fast counts.

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
create index if not exists idx_patient_images_storage_path on public.patient_images(storage_path);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files',
  'patient-files',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies: a user can manage files only inside a folder named with their clinic_id.
drop policy if exists patient_files_select on storage.objects;
drop policy if exists patient_files_insert on storage.objects;
drop policy if exists patient_files_update on storage.objects;
drop policy if exists patient_files_delete on storage.objects;

create policy patient_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'patient-files'
  and (storage.foldername(name))[1] = public.current_clinic_id()::text
);

create policy patient_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'patient-files'
  and (storage.foldername(name))[1] = public.current_clinic_id()::text
);

create policy patient_files_update on storage.objects
for update to authenticated
using (
  bucket_id = 'patient-files'
  and (storage.foldername(name))[1] = public.current_clinic_id()::text
)
with check (
  bucket_id = 'patient-files'
  and (storage.foldername(name))[1] = public.current_clinic_id()::text
);

create policy patient_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'patient-files'
  and (storage.foldername(name))[1] = public.current_clinic_id()::text
  and public.current_staff_role() in ('admin','doctor')
);

create or replace function public.dashboard_alert_counts(target_clinic_id uuid)
returns table(
  pending_count bigint,
  today_open_count bigint,
  overdue_count bigint,
  no_show_followup_count bigint,
  missing_visit_notes_count bigint,
  active_plans_without_next_count bigint
)
language sql stable security definer set search_path = public as $$
  with open_statuses as (
    select unnest(array['pending','confirmed','arrived']) as status
  ), future_patients as (
    select distinct patient_id from public.appointments
    where clinic_id = target_clinic_id and appointment_date >= current_date and status in (select status from open_statuses)
  ), future_patient_services as (
    select distinct patient_id, service_id from public.appointments
    where clinic_id = target_clinic_id and appointment_date >= current_date and status in (select status from open_statuses)
  )
  select
    (select count(*) from public.appointments where clinic_id = target_clinic_id and status = 'pending') as pending_count,
    (select count(*) from public.appointments where clinic_id = target_clinic_id and appointment_date = current_date and status in (select status from open_statuses)) as today_open_count,
    (select count(*) from public.appointments where clinic_id = target_clinic_id and status in (select status from open_statuses) and (appointment_date < current_date or (appointment_date = current_date and appointment_time < localtime))) as overdue_count,
    (select count(*) from public.appointments a where a.clinic_id = target_clinic_id and a.status = 'no_show' and not exists (select 1 from future_patients fp where fp.patient_id = a.patient_id)) as no_show_followup_count,
    (select count(*) from public.visits where clinic_id = target_clinic_id and (coalesce(trim(procedure_done),'') = '' or coalesce(trim(doctor_notes),'') = '')) as missing_visit_notes_count,
    (select count(*) from public.treatment_plans p where p.clinic_id = target_clinic_id and p.status = 'active' and not exists (select 1 from future_patients fp where fp.patient_id = p.patient_id) and not exists (select 1 from future_patient_services fps where fps.patient_id = p.patient_id and fps.service_id is not distinct from p.service_id)) as active_plans_without_next_count;
$$;

grant execute on function public.dashboard_alert_counts(uuid) to authenticated;

-- Allow the clinic doctor/admin to manage team rows from the Team page.
drop policy if exists staff_admin on public.staff_users;
drop policy if exists staff_manage_admin_doctor on public.staff_users;
create policy staff_manage_admin_doctor on public.staff_users
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

-- For production hardening after the base schema, also run:
-- supabase/professional_hardening_1_10.sql
