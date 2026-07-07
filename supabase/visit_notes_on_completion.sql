-- تشغيل هذا الملف عند الحاجة إذا لم يكن جدول الزيارات موجوداً في قاعدة البيانات.
-- يستخدم لتسجيل ملخص جلسة العلاج والملاحظات الطبية عند إنهاء الموعد.

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

alter table public.visits enable row level security;

drop policy if exists visits_all on public.visits;

create policy visits_all on public.visits
for all to authenticated
using (clinic_id = public.current_clinic_id())
with check (clinic_id = public.current_clinic_id());

create index if not exists visits_patient_date_idx
on public.visits (clinic_id, patient_id, visit_date desc, created_at desc);
