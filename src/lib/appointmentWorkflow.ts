import type { AppointmentStatus } from './types';

export type AppointmentStatusAction = {
  label: string;
  status: AppointmentStatus;
  confirm?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
};

export const appointmentStatusOptions: Array<{ value: AppointmentStatus; label: string }> = [
  { value: 'pending', label: 'بانتظار التأكيد' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغى' },
  { value: 'no_show', label: 'لم يحضر' }
];

export function appointmentStatusTone(status?: string) {
  if (status === 'completed' || status === 'confirmed') return 'success' as const;
  if (status === 'pending') return 'warning' as const;
  if (status === 'cancelled' || status === 'no_show') return 'danger' as const;
  return 'info' as const;
}

export function getAppointmentStatusActions(status?: string): AppointmentStatusAction[] {
  if (status === 'pending') {
    return [
      { label: 'تأكيد', status: 'confirmed', tone: 'primary' },
      {
        label: 'إلغاء الموعد',
        status: 'cancelled',
        tone: 'danger',
        confirm: true,
        confirmTitle: 'تأكيد إلغاء الموعد',
        confirmMessage: 'سيتم تغيير حالة الموعد إلى ملغى. هل ترغب بالمتابعة؟'
      }
    ];
  }

  if (status === 'confirmed' || status === 'arrived') {
    return [
      {
        label: 'إنهاء',
        status: 'completed',
        tone: 'primary',
        confirm: true,
        confirmTitle: 'تأكيد إنهاء الموعد',
        confirmMessage: 'سيتم تغيير حالة الموعد إلى مكتمل. هل ترغب بإنهاء الموعد؟',
        confirmLabel: 'إنهاء الموعد'
      },
      {
        label: 'إلغاء الموعد',
        status: 'cancelled',
        tone: 'danger',
        confirm: true,
        confirmTitle: 'تأكيد إلغاء الموعد',
        confirmMessage: 'سيتم تغيير حالة الموعد إلى ملغى. هل ترغب بالمتابعة؟'
      },
      {
        label: 'لم يحضر',
        status: 'no_show',
        tone: 'danger',
        confirm: true,
        confirmTitle: 'تأكيد عدم الحضور',
        confirmMessage: 'سيتم تغيير حالة الموعد إلى لم يحضر. هل ترغب بالمتابعة؟'
      }
    ];
  }

  return [];
}
