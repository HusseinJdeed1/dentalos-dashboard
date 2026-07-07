-- Professional dashboard upgrade: storage, activity log, team metadata, timezone, and fast counts.

alter table public.clinics
add column if not exists clinic_timezone text not null default 'Asia/Damascus';

alter table public.staff_users
add column if not exists email text,
add column if not exists is_active boolean not null default true,
add column if not exists last_seen_at timestamptz;

create unique index if not exists idx_staff_users_clinic_email_unique
on public.staff_users (clinic_id, lower(email))
where email is not null and email <> '';

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
