-- DentalOS product professional upgrades.
-- Adds dental chart, receipt fields, financial audit logs, patient import support metadata, and stronger alert/report data support.
-- Run after finance_installments_payments_link.sql.

create extension if not exists pgcrypto;

-- Payment receipts and audit metadata.
alter table public.payments
add column if not exists receipt_number text,
add column if not exists created_by uuid references public.staff_users(id) on delete set null,
add column if not exists updated_at timestamptz;

create unique index if not exists idx_payments_receipt_number_unique
on public.payments(clinic_id, receipt_number)
where receipt_number is not null and receipt_number <> '';

create or replace function public.set_payment_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number := 'RC-' || to_char(coalesce(new.payment_date, current_date), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_payment_receipt_number on public.payments;
create trigger trg_set_payment_receipt_number
before insert or update on public.payments
for each row execute function public.set_payment_receipt_number();

-- Strong financial audit log. Use this for create/edit/delete payment and installment events.
create table if not exists public.financial_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  staff_id uuid references public.staff_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.financial_audit_logs enable row level security;

drop policy if exists financial_audit_logs_read on public.financial_audit_logs;
drop policy if exists financial_audit_logs_insert on public.financial_audit_logs;

create policy financial_audit_logs_read on public.financial_audit_logs
for select to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials());

create policy financial_audit_logs_insert on public.financial_audit_logs
for insert to authenticated
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create index if not exists idx_financial_audit_logs_clinic_date on public.financial_audit_logs(clinic_id, created_at desc);
create index if not exists idx_financial_audit_logs_entity on public.financial_audit_logs(entity_type, entity_id);

create or replace function public.audit_payment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.financial_audit_logs(clinic_id, staff_id, action, entity_type, entity_id, new_value)
    values (new.clinic_id, new.created_by, 'payment_created', 'payment', new.id, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.financial_audit_logs(clinic_id, staff_id, action, entity_type, entity_id, old_value, new_value)
    values (new.clinic_id, coalesce(new.created_by, old.created_by), 'payment_updated', 'payment', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.financial_audit_logs(clinic_id, staff_id, action, entity_type, entity_id, old_value)
    values (old.clinic_id, old.created_by, 'payment_deleted', 'payment', old.id, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_audit_payment_changes on public.payments;
create trigger trg_audit_payment_changes
after insert or update or delete on public.payments
for each row execute function public.audit_payment_changes();

-- Dental chart inside patient file.
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

create or replace function public.touch_dental_chart_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_dental_chart_updated_at on public.patient_dental_chart;
create trigger trg_touch_dental_chart_updated_at
before update on public.patient_dental_chart
for each row execute function public.touch_dental_chart_updated_at();

-- Ensure imported patients can be marked active even if the column exists from newer versions.
alter table public.patients
add column if not exists status text default 'active',
add column if not exists archived_at timestamptz;

-- Helpful indexes for reports and alerts.
create index if not exists idx_payments_clinic_date_created on public.payments(clinic_id, payment_date desc, created_at desc);
create index if not exists idx_installments_clinic_due_status on public.installments(clinic_id, due_date, status);
create index if not exists idx_appointments_clinic_date_status on public.appointments(clinic_id, appointment_date, status);

select pg_notify('pgrst', 'reload schema');
