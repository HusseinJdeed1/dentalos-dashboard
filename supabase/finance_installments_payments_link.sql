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
