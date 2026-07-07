import { supabase } from '@/lib/supabase';

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'asset';
}

export async function uploadClinicAsset(clinicId: string, file: File) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${clinicId}/logo-${Date.now()}-${safeName(file.name || `logo.${ext}`)}`;
  const { error } = await supabase.storage.from('clinic-assets').upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('clinic-assets').getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function uploadStaffAvatarAsset(clinicId: string, staffId: string, file: File) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${clinicId}/${staffId}/avatar-${Date.now()}-${safeName(file.name || `avatar.${ext}`)}`;
  const { error } = await supabase.storage.from('staff-avatars').upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('staff-avatars').getPublicUrl(path);
  return { url: data.publicUrl, path };
}
