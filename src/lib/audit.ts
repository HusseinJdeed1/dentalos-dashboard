import { supabase } from './supabase';
import type { StaffUser } from './types';

type AuditValue = Record<string, unknown> | string | number | boolean | null | undefined;

export async function logActivity(staff: StaffUser | null | undefined, action: string, entityType: string, entityId?: string | null, oldValue?: AuditValue, newValue?: AuditValue) {
  if (!staff?.clinic_id) return;
  try {
    await supabase.from('activity_logs').insert({
      clinic_id: staff.clinic_id,
      staff_id: staff.id,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      old_value: oldValue === undefined ? null : oldValue,
      new_value: newValue === undefined ? null : newValue
    });
  } catch (error) {
    console.warn('Activity log skipped', error);
  }
}
