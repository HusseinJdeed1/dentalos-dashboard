-- Staff creation + patient data export support.
-- Run this once in Supabase SQL Editor after the professional dashboard upgrade.

alter table public.staff_users
add column if not exists email text,
add column if not exists is_active boolean not null default true,
add column if not exists last_seen_at timestamptz;

create unique index if not exists idx_staff_users_clinic_email_unique
on public.staff_users (clinic_id, lower(email))
where email is not null and email <> '';

create index if not exists idx_staff_users_clinic_role on public.staff_users(clinic_id, role);

-- Keep staff management restricted to doctor/admin inside the same clinic.
drop policy if exists staff_admin on public.staff_users;
drop policy if exists staff_manage_admin_doctor on public.staff_users;
create policy staff_manage_admin_doctor on public.staff_users
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

-- Ensure activity log table exists so exports and staff creation are auditable.
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
