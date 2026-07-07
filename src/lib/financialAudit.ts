import { supabase } from '@/lib/supabase';
import type { StaffUser } from '@/lib/types';

export async function logFinancialAudit(
  staff: StaffUser | null | undefined,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue?: Record<string, unknown> | null,
  newValue?: Record<string, unknown> | null
) {
  if (!staff) return;
  await supabase.from('financial_audit_logs').insert({
    clinic_id: staff.clinic_id,
    staff_id: staff.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_value: oldValue || null,
    new_value: newValue || null
  });
}
