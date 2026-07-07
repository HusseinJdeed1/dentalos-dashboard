-- السماح للطبيب بتعديل معلومات وهوية العيادة، مع منع السكرتيرة.
-- شغّل هذا الملف في Supabase SQL Editor إذا كانت قاعدة البيانات منشأة مسبقاً.

alter table public.clinics enable row level security;

drop policy if exists clinics_update_admin on public.clinics;
drop policy if exists clinics_update_admin_doctor on public.clinics;

create policy clinics_update_admin_doctor on public.clinics
for update to authenticated
using (
  id = public.current_clinic_id()
  and public.current_staff_role() in ('admin','doctor')
)
with check (
  id = public.current_clinic_id()
  and public.current_staff_role() in ('admin','doctor')
);
