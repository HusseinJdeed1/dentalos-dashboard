-- إضافة جدول أوقات الدوام إذا لم يكن موجوداً.
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
alter table public.clinic_working_hours enable row level security;

-- تحديث الصلاحيات: منع السكرتيرة من رؤية الملخص المالي الكامل.
-- شغّل هذا الملف في Supabase SQL Editor إذا كانت قاعدة البيانات منشأة مسبقاً.

create or replace function public.can_view_financials()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('admin','doctor'), false);
$$;

do $$ declare r record; begin
  for r in (select tablename, policyname from pg_policies where schemaname='public') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy clinics_read on public.clinics
for select to authenticated
using (id = public.current_clinic_id());

create policy clinics_update_admin_doctor on public.clinics
for update to authenticated
using (id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'))
with check (id = public.current_clinic_id() and public.current_staff_role() in ('admin','doctor'));

create policy staff_read on public.staff_users
for select to authenticated
using (clinic_id = public.current_clinic_id());

create policy staff_admin on public.staff_users
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.current_staff_role() = 'admin')
with check (clinic_id = public.current_clinic_id() and public.current_staff_role() = 'admin');

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

create policy working_hours_all on public.clinic_working_hours
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

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

create index if not exists idx_working_hours_clinic_day on public.clinic_working_hours(clinic_id, day_of_week);
