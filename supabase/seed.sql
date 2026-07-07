-- 1) Create a user in Supabase Authentication, then replace USER_ID_HERE with the Auth user UID.
insert into public.clinics (id, name, phone, address, theme_id)
values ('00000000-0000-0000-0000-000000000001', 'عيادة الابتسامة للأسنان', '0500000000', 'الرياض', 'dental-clean')
on conflict (id) do update set name = excluded.name;

insert into public.staff_users (clinic_id, user_id, email, full_name, role, phone)
values ('00000000-0000-0000-0000-000000000001', 'USER_ID_HERE', 'doctor@test.com', 'د. أحمد سعيد', 'admin', '0500000000');

insert into public.services (clinic_id, name, category, price, duration_minutes, is_installment_available)
values
('00000000-0000-0000-0000-000000000001','تنظيف أسنان','cleaning',300,30,false),
('00000000-0000-0000-0000-000000000001','تقويم','orthodontics',1750,30,true),
('00000000-0000-0000-0000-000000000001','معالجة عصب','root_canal',1200,60,true),
('00000000-0000-0000-0000-000000000001','زرعة','implant',8000,60,true);

insert into public.clinic_working_hours (clinic_id, day_of_week, is_open, start_time, end_time, break_start, break_end, slot_duration_minutes)
values
('00000000-0000-0000-0000-000000000001', 6, true,  '09:00', '17:00', '13:00', '14:00', 30),
('00000000-0000-0000-0000-000000000001', 0, true,  '09:00', '17:00', '13:00', '14:00', 30),
('00000000-0000-0000-0000-000000000001', 1, true,  '09:00', '17:00', '13:00', '14:00', 30),
('00000000-0000-0000-0000-000000000001', 2, true,  '09:00', '17:00', '13:00', '14:00', 30),
('00000000-0000-0000-0000-000000000001', 3, true,  '09:00', '17:00', '13:00', '14:00', 30),
('00000000-0000-0000-0000-000000000001', 4, true,  '09:00', '14:00', null, null, 30),
('00000000-0000-0000-0000-000000000001', 5, false, '09:00', '17:00', null, null, 30)
on conflict (clinic_id, day_of_week) do update set
  is_open = excluded.is_open,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  break_start = excluded.break_start,
  break_end = excluded.break_end,
  slot_duration_minutes = excluded.slot_duration_minutes;
