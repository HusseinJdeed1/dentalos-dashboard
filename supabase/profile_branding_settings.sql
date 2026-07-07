-- Profile and clinic branding settings support
-- Run this file once in Supabase SQL Editor.

alter table public.staff_users
add column if not exists avatar_url text;

alter table public.clinics
add column if not exists logo_url text;

-- إصلاح تحديث الصورة الشخصية للطبيب عبر دالة آمنة لا تسمح بتعديل الدور أو بيانات باقي الموظفين.
create or replace function public.update_own_staff_avatar(p_avatar_url text)
returns table(id uuid, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_avatar_url is not null and length(p_avatar_url) > 2500000 then
    raise exception 'avatar_url is too large';
  end if;

  return query
  update public.staff_users as s
  set avatar_url = p_avatar_url
  where s.user_id = auth.uid()
    and s.clinic_id = public.current_clinic_id()
  returning s.id, s.avatar_url;
end;
$$;

grant execute on function public.update_own_staff_avatar(text) to authenticated;
