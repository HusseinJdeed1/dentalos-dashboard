import type { Role, StaffUser } from './types';

export function canViewFullFinancials(staff?: StaffUser | null) {
  return (staff?.role === 'admin' || staff?.role === 'doctor') && staff?.is_active !== false;
}

export function canManageMedicalRecords(staff?: StaffUser | null) {
  return (staff?.role === 'admin' || staff?.role === 'doctor') && staff?.is_active !== false;
}

export function canManageFinancialRecords(staff?: StaffUser | null) {
  return canViewFullFinancials(staff);
}

export function canManageClinicAdministration(staff?: StaffUser | null) {
  return (staff?.role === 'admin' || staff?.role === 'doctor') && staff?.is_active !== false;
}

export function isRoleAllowed(staff: StaffUser | null | undefined, roles?: Role[]) {
  if (!roles || roles.length === 0) return true;
  return Boolean(staff?.role && staff?.is_active !== false && roles.includes(staff.role));
}
