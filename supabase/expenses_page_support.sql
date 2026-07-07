-- دعم صفحة المصروفات
-- شغّل هذا الملف فقط إذا كانت نسخة قاعدة البيانات لديك قديمة ولا تحتوي جدول expenses أو سياساته.

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

alter table public.expenses enable row level security;

drop policy if exists expenses_financial on public.expenses;
create policy expenses_financial on public.expenses
for all to authenticated
using (clinic_id = public.current_clinic_id() and public.can_view_financials())
with check (clinic_id = public.current_clinic_id() and public.can_view_financials());

create index if not exists idx_expenses_clinic_date on public.expenses(clinic_id, expense_date desc);
create index if not exists idx_expenses_clinic_category on public.expenses(clinic_id, category);
