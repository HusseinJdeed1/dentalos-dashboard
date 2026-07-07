-- Patient files support
-- Run this file in Supabase SQL Editor if you already ran patient_archive_and_images.sql before.
-- It allows storing file metadata for images, PDF, Word, and TXT attachments.

alter table public.patient_images
add column if not exists file_name text,
add column if not exists file_type text,
add column if not exists file_size integer;

create index if not exists idx_patient_images_clinic_patient
on public.patient_images(clinic_id, patient_id, created_at desc);
