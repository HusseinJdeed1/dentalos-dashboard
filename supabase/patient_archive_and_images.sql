-- Patient archive and patient images support
-- Run this file in Supabase SQL Editor once.

alter table public.patients
add column if not exists status text default 'active' check (status in ('active', 'archived')),
add column if not exists archived_at timestamptz;

update public.patients
set status = 'active'
where status is null;

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

create index if not exists idx_patient_images_clinic_patient
on public.patient_images(clinic_id, patient_id, created_at desc);

alter table public.patient_images enable row level security;

drop policy if exists "patient_images_select_staff" on public.patient_images;
create policy "patient_images_select_staff"
on public.patient_images
for select
using (clinic_id = public.current_clinic_id());

drop policy if exists "patient_images_insert_staff" on public.patient_images;
create policy "patient_images_insert_staff"
on public.patient_images
for insert
with check (clinic_id = public.current_clinic_id());

drop policy if exists "patient_images_update_staff" on public.patient_images;
create policy "patient_images_update_staff"
on public.patient_images
for update
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

drop policy if exists "patient_images_delete_staff" on public.patient_images;
create policy "patient_images_delete_staff"
on public.patient_images
for delete
using (clinic_id = public.current_clinic_id());

-- Reactivate an archived patient automatically when a new appointment is added.
create or replace function public.reactivate_patient_on_new_appointment()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.patients
  set status = 'active', archived_at = null
  where id = new.patient_id
    and clinic_id = new.clinic_id
    and status = 'archived';
  return new;
end;
$$;

drop trigger if exists trg_reactivate_patient_on_new_appointment on public.appointments;
create trigger trg_reactivate_patient_on_new_appointment
after insert on public.appointments
for each row execute function public.reactivate_patient_on_new_appointment();

-- Optional automatic archive check. The app calls this function when a doctor/admin opens the dashboard.
-- It archives active patients whose latest appointment is older than 3 months and who have no future open appointment.
create or replace function public.archive_inactive_patients(target_clinic_id uuid default null)
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
  v_clinic uuid;
begin
  v_clinic := coalesce(target_clinic_id, public.current_clinic_id());

  with latest as (
    select patient_id, max(appointment_date) as latest_date
    from public.appointments
    where clinic_id = v_clinic
    group by patient_id
  ), candidates as (
    select p.id
    from public.patients p
    join latest l on l.patient_id = p.id
    where p.clinic_id = v_clinic
      and coalesce(p.status, 'active') = 'active'
      and l.latest_date < (current_date - interval '3 months')
      and not exists (
        select 1
        from public.appointments a
        where a.clinic_id = p.clinic_id
          and a.patient_id = p.id
          and a.appointment_date >= current_date
          and a.status in ('pending', 'confirmed', 'arrived')
      )
  )
  update public.patients p
  set status = 'archived', archived_at = now()
  from candidates c
  where p.id = c.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
