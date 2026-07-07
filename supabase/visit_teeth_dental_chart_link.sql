-- Link completed visits with dental chart teeth.
-- Run after previous DentalOS SQL files.

create extension if not exists pgcrypto;

-- Keep the current visible chart, but remember which visit last updated each tooth.
create table if not exists public.patient_dental_chart (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tooth_number text not null,
  status text not null default 'healthy' check (status in ('healthy','watch','caries','filled','root_canal','crown','missing','implant')),
  procedure_name text,
  notes text,
  updated_by uuid references public.staff_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (clinic_id, patient_id, tooth_number)
);

alter table public.patient_dental_chart
add column if not exists last_visit_id uuid references public.visits(id) on delete set null;

alter table public.patient_dental_chart enable row level security;

drop policy if exists patient_dental_chart_select on public.patient_dental_chart;
drop policy if exists patient_dental_chart_manage on public.patient_dental_chart;

create policy patient_dental_chart_select on public.patient_dental_chart
for select to authenticated
using (clinic_id = public.current_clinic_id());

create policy patient_dental_chart_manage on public.patient_dental_chart
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

create index if not exists idx_patient_dental_chart_patient on public.patient_dental_chart(clinic_id, patient_id, tooth_number);
create index if not exists idx_patient_dental_chart_last_visit on public.patient_dental_chart(last_visit_id);

-- Historical log: every completed visit can be linked to one or more teeth.
create table if not exists public.visit_teeth (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  tooth_number text not null,
  procedure_done text not null,
  old_status text check (old_status is null or old_status in ('healthy','watch','caries','filled','root_canal','crown','missing','implant')),
  new_status text not null check (new_status in ('healthy','watch','caries','filled','root_canal','crown','missing','implant')),
  notes text,
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.visit_teeth enable row level security;

drop policy if exists visit_teeth_select on public.visit_teeth;
drop policy if exists visit_teeth_manage on public.visit_teeth;

create policy visit_teeth_select on public.visit_teeth
for select to authenticated
using (clinic_id = public.current_clinic_id());

create policy visit_teeth_manage on public.visit_teeth
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

create index if not exists idx_visit_teeth_visit on public.visit_teeth(visit_id, tooth_number);
create index if not exists idx_visit_teeth_patient_tooth on public.visit_teeth(clinic_id, patient_id, tooth_number, created_at desc);

-- Database-level safety: whenever a visit-tooth record is saved, update the current dental chart.
create or replace function public.apply_visit_tooth_to_dental_chart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.patient_dental_chart(
    clinic_id,
    patient_id,
    tooth_number,
    status,
    procedure_name,
    notes,
    updated_by,
    last_visit_id,
    updated_at
  ) values (
    new.clinic_id,
    new.patient_id,
    new.tooth_number,
    new.new_status,
    new.procedure_done,
    new.notes,
    new.created_by,
    new.visit_id,
    now()
  )
  on conflict (clinic_id, patient_id, tooth_number)
  do update set
    status = excluded.status,
    procedure_name = excluded.procedure_name,
    notes = excluded.notes,
    updated_by = excluded.updated_by,
    last_visit_id = excluded.last_visit_id,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_apply_visit_tooth_to_dental_chart on public.visit_teeth;
create trigger trg_apply_visit_tooth_to_dental_chart
after insert or update of tooth_number, procedure_done, new_status, notes, created_by on public.visit_teeth
for each row execute function public.apply_visit_tooth_to_dental_chart();

select pg_notify('pgrst', 'reload schema');
