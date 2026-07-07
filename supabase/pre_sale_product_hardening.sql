-- DentalOS pre-sale product hardening.
-- Run this after all previous SQL files. It focuses on production readiness:
-- active-user security, stronger RLS, medical/financial permissions, safer imports, and backup/import auditability.

create extension if not exists pgcrypto;

-- 1) Active staff must be required for every permission helper.
alter table public.staff_users
add column if not exists is_active boolean not null default true,
add column if not exists last_seen_at timestamptz;

create or replace function public.current_staff_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id
  from public.staff_users
  where user_id = auth.uid()
    and coalesce(is_active, true) = true
  limit 1;
$$;

create or replace function public.current_clinic_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select clinic_id
  from public.staff_users
  where user_id = auth.uid()
    and coalesce(is_active, true) = true
  limit 1;
$$;

create or replace function public.current_staff_role()
returns text
language sql stable security definer set search_path = public as $$
  select role
  from public.staff_users
  where user_id = auth.uid()
    and coalesce(is_active, true) = true
  limit 1;
$$;

create or replace function public.is_current_staff_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.staff_users
    where user_id = auth.uid()
      and coalesce(is_active, true) = true
  );
$$;

create or replace function public.can_view_financials()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('admin','doctor'), false);
$$;

create or replace function public.can_manage_medical_records()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('admin','doctor'), false);
$$;

create or replace function public.can_manage_administration()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('admin','doctor'), false);
$$;

grant execute on function public.current_staff_id() to authenticated;
grant execute on function public.current_clinic_id() to authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_current_staff_active() to authenticated;
grant execute on function public.can_view_financials() to authenticated;
grant execute on function public.can_manage_medical_records() to authenticated;
grant execute on function public.can_manage_administration() to authenticated;

create or replace function public.update_own_last_seen()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.staff_users
  set last_seen_at = now()
  where user_id = auth.uid()
    and coalesce(is_active, true) = true;
end;
$$;

grant execute on function public.update_own_last_seen() to authenticated;

-- 2) Make patient_files view obey caller RLS whenever Postgres supports security_invoker.
do $$
begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'patient_files') then
    execute 'alter view public.patient_files set (security_invoker = true)';
  end if;
exception when others then
  -- Some older Postgres projects may not support security_invoker on views.
  -- In that case, prefer querying patient_images directly with RLS.
  null;
end $$;

-- 3) RLS hardening helpers and policies.
-- Staff: reading own clinic only; direct write stays disabled and should happen through Edge Functions/service role.
alter table public.staff_users enable row level security;
drop policy if exists staff_select_same_clinic on public.staff_users;
drop policy if exists staff_admin on public.staff_users;
drop policy if exists staff_manage_admin_doctor on public.staff_users;
drop policy if exists staff_update_same_clinic on public.staff_users;
drop policy if exists staff_insert_same_clinic on public.staff_users;
drop policy if exists staff_delete_same_clinic on public.staff_users;
create policy staff_select_same_clinic on public.staff_users
for select to authenticated
using (clinic_id = public.current_clinic_id() and public.is_current_staff_active());

-- Patients: secretary may manage patient identity, but medical/financial tables are separate.
alter table public.patients enable row level security;
drop policy if exists patients_crud_same_clinic on public.patients;
drop policy if exists patients_select_same_clinic on public.patients;
drop policy if exists patients_insert_same_clinic on public.patients;
drop policy if exists patients_update_same_clinic on public.patients;
drop policy if exists patients_delete_doctor_admin on public.patients;
create policy patients_select_same_clinic on public.patients
for select to authenticated using (clinic_id = public.current_clinic_id());
create policy patients_insert_same_clinic on public.patients
for insert to authenticated with check (clinic_id = public.current_clinic_id());
create policy patients_update_same_clinic on public.patients
for update to authenticated using (clinic_id = public.current_clinic_id()) with check (clinic_id = public.current_clinic_id());
create policy patients_delete_doctor_admin on public.patients
for delete to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_administration());

-- Appointments: secretary can manage scheduling; completing a medical visit is blocked by application and medical table RLS.
alter table public.appointments enable row level security;
drop policy if exists appointments_crud_same_clinic on public.appointments;
drop policy if exists appointments_select_same_clinic on public.appointments;
drop policy if exists appointments_insert_same_clinic on public.appointments;
drop policy if exists appointments_update_same_clinic on public.appointments;
create policy appointments_select_same_clinic on public.appointments
for select to authenticated using (clinic_id = public.current_clinic_id());
create policy appointments_insert_same_clinic on public.appointments
for insert to authenticated with check (clinic_id = public.current_clinic_id());
create policy appointments_update_same_clinic on public.appointments
for update to authenticated using (clinic_id = public.current_clinic_id()) with check (clinic_id = public.current_clinic_id());

-- Medical records: select for same clinic, write only doctor/admin.
alter table public.visits enable row level security;
drop policy if exists visits_crud_same_clinic on public.visits;
drop policy if exists visits_select_same_clinic on public.visits;
drop policy if exists visits_write_doctor_admin on public.visits;
create policy visits_select_same_clinic on public.visits
for select to authenticated using (clinic_id = public.current_clinic_id());
create policy visits_write_doctor_admin on public.visits
for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_medical_records())
with check (clinic_id = public.current_clinic_id() and public.can_manage_medical_records());

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='patient_dental_chart') then
    execute 'alter table public.patient_dental_chart enable row level security';
    execute 'drop policy if exists patient_dental_chart_select on public.patient_dental_chart';
    execute 'drop policy if exists patient_dental_chart_manage on public.patient_dental_chart';
    execute 'create policy patient_dental_chart_select on public.patient_dental_chart for select to authenticated using (clinic_id = public.current_clinic_id())';
    execute 'create policy patient_dental_chart_manage on public.patient_dental_chart for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_medical_records()) with check (clinic_id = public.current_clinic_id() and public.can_manage_medical_records())';
  end if;
end $$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='visit_teeth') then
    execute 'alter table public.visit_teeth enable row level security';
    execute 'drop policy if exists visit_teeth_select on public.visit_teeth';
    execute 'drop policy if exists visit_teeth_manage on public.visit_teeth';
    execute 'create policy visit_teeth_select on public.visit_teeth for select to authenticated using (clinic_id = public.current_clinic_id())';
    execute 'create policy visit_teeth_manage on public.visit_teeth for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_medical_records()) with check (clinic_id = public.current_clinic_id() and public.can_manage_medical_records())';
  end if;
end $$;

-- Financial tables: doctor/admin only.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='payments') then
    execute 'alter table public.payments enable row level security';
    execute 'drop policy if exists payments_financial on public.payments';
    execute 'drop policy if exists payments_select_same_clinic on public.payments';
    execute 'drop policy if exists payments_write_financial on public.payments';
    execute 'create policy payments_select_same_clinic on public.payments for select to authenticated using (clinic_id = public.current_clinic_id() and public.can_view_financials())';
    execute 'create policy payments_write_financial on public.payments for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_view_financials()) with check (clinic_id = public.current_clinic_id() and public.can_view_financials())';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='installments') then
    execute 'alter table public.installments enable row level security';
    execute 'drop policy if exists installments_financial on public.installments';
    execute 'create policy installments_financial on public.installments for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_view_financials()) with check (clinic_id = public.current_clinic_id() and public.can_view_financials())';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='treatment_plans') then
    execute 'alter table public.treatment_plans enable row level security';
    execute 'drop policy if exists treatment_plans_financial on public.treatment_plans';
    execute 'drop policy if exists treatment_plans_crud_same_clinic on public.treatment_plans';
    execute 'create policy treatment_plans_financial on public.treatment_plans for all to authenticated using (clinic_id = public.current_clinic_id() and public.can_view_financials()) with check (clinic_id = public.current_clinic_id() and public.can_view_financials())';
  end if;
end $$;

-- Patient files: secretary may upload/read, delete only doctor/admin. DB limit remains active if already installed.
alter table public.patient_images enable row level security;
drop policy if exists patient_images_select_same_clinic on public.patient_images;
drop policy if exists patient_images_insert_same_clinic on public.patient_images;
drop policy if exists patient_images_update_same_clinic on public.patient_images;
drop policy if exists patient_images_delete_doctor_admin on public.patient_images;
drop policy if exists patient_images_crud_same_clinic on public.patient_images;
create policy patient_images_select_same_clinic on public.patient_images
for select to authenticated using (clinic_id = public.current_clinic_id());
create policy patient_images_insert_same_clinic on public.patient_images
for insert to authenticated with check (clinic_id = public.current_clinic_id());
create policy patient_images_update_same_clinic on public.patient_images
for update to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_medical_records()) with check (clinic_id = public.current_clinic_id() and public.can_manage_medical_records());
create policy patient_images_delete_doctor_admin on public.patient_images
for delete to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_medical_records());

-- 4) Import safety: import batches and rollback for the last accidental import.
alter table public.patients add column if not exists import_batch_id uuid;

create table if not exists public.patient_import_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  staff_id uuid references public.staff_users(id) on delete set null,
  file_name text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  skipped_rows integer not null default 0,
  inserted_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing','completed','rolled_back','failed')),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz
);

alter table public.patient_import_batches enable row level security;
drop policy if exists patient_import_batches_manage on public.patient_import_batches;
create policy patient_import_batches_manage on public.patient_import_batches
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_manage_administration())
with check (clinic_id = public.current_clinic_id() and public.can_manage_administration());

create index if not exists idx_patients_import_batch on public.patients(clinic_id, import_batch_id);
create index if not exists idx_patient_import_batches_clinic_date on public.patient_import_batches(clinic_id, created_at desc);

create or replace function public.rollback_patient_import_batch(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_batch public.patient_import_batches%rowtype;
  v_count integer := 0;
begin
  select * into v_batch
  from public.patient_import_batches
  where id = p_batch_id
    and clinic_id = public.current_clinic_id()
    and status = 'completed'
  for update;

  if not found then
    raise exception 'تعذر العثور على عملية استيراد قابلة للتراجع.';
  end if;

  delete from public.patients p
  where p.clinic_id = v_batch.clinic_id
    and p.import_batch_id = p_batch_id
    and not exists (select 1 from public.appointments a where a.patient_id = p.id)
    and not exists (select 1 from public.visits v where v.patient_id = p.id)
    and not exists (select 1 from public.treatment_plans tp where tp.patient_id = p.id)
    and not exists (select 1 from public.payments py where py.patient_id = p.id);

  get diagnostics v_count = row_count;

  update public.patient_import_batches
  set status = 'rolled_back', rolled_back_at = now()
  where id = p_batch_id;

  return v_count;
end;
$$;

grant execute on function public.rollback_patient_import_batch(uuid) to authenticated;

-- 5) Ensure activity and financial logs require active same-clinic users.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='activity_logs') then
    execute 'alter table public.activity_logs enable row level security';
    execute 'drop policy if exists activity_logs_read on public.activity_logs';
    execute 'drop policy if exists activity_logs_insert on public.activity_logs';
    execute 'create policy activity_logs_read on public.activity_logs for select to authenticated using (clinic_id = public.current_clinic_id() and public.can_manage_administration())';
    execute 'create policy activity_logs_insert on public.activity_logs for insert to authenticated with check (clinic_id = public.current_clinic_id())';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='financial_audit_logs') then
    execute 'alter table public.financial_audit_logs enable row level security';
    execute 'drop policy if exists financial_audit_logs_read on public.financial_audit_logs';
    execute 'drop policy if exists financial_audit_logs_insert on public.financial_audit_logs';
    execute 'create policy financial_audit_logs_read on public.financial_audit_logs for select to authenticated using (clinic_id = public.current_clinic_id() and public.can_view_financials())';
    execute 'create policy financial_audit_logs_insert on public.financial_audit_logs for insert to authenticated with check (clinic_id = public.current_clinic_id() and public.can_view_financials())';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
