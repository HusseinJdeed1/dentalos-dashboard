-- منع إضافة موعد في وقت سابق من قاعدة البيانات أيضاً
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor.

create or replace function public.prevent_past_appointment()
returns trigger
language plpgsql
as $$
begin
  if ((new.appointment_date::timestamp + new.appointment_time) < now()) then
    raise exception 'لا يمكن إضافة موعد في وقت سابق';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_past_appointment on public.appointments;
create trigger trg_prevent_past_appointment
before insert or update of appointment_date, appointment_time
on public.appointments
for each row
execute function public.prevent_past_appointment();
