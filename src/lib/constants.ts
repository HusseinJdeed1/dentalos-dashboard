import type { AppointmentStatus, PlanStatus, ThemeId } from './types';

export const themes: Array<{ id: ThemeId; name: string; description: string }> = [
  { id: 'dental-clean', name: 'Dental Clean', description: 'نظيف وحديث ومناسب لكل عيادات الأسنان' },
  { id: 'soft-rose', name: 'Soft Rose Dental', description: 'ناعم للطبيبات والتجميل السني' },
  { id: 'navy-pro', name: 'Navy Dental Pro', description: 'رسمي وفخم للمراكز الطبية' },
  { id: 'luxury-beige', name: 'Luxury Beige', description: 'فاخر وهادئ للعيادات الراقية' },
  { id: 'emerald', name: 'Emerald Dental', description: 'صحي، مريح، ومحايد' }
];

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  arrived: 'حضر',
  completed: 'مكتمل',
  cancelled: 'ملغى',
  no_show: 'لم يحضر'
};
export const planStatusLabels: Record<PlanStatus, string> = { active: 'نشطة', completed: 'مكتملة', cancelled: 'ملغاة', paused: 'متوقفة' };

export const defaultServices = [
  { name: 'استشارة', category: 'consultation', price: 20, duration_minutes: 15 },
  { name: 'تنظيف أسنان', category: 'cleaning', price: 40, duration_minutes: 30 },
  { name: 'حشوة', category: 'filling', price: 60, duration_minutes: 45 },
  { name: 'معالجة عصب', category: 'root_canal', price: 150, duration_minutes: 60 },
  { name: 'تقويم', category: 'orthodontics', price: 1000, duration_minutes: 30 },
  { name: 'زرعة', category: 'implant', price: 800, duration_minutes: 60 },
  { name: 'تبييض', category: 'whitening', price: 120, duration_minutes: 45 }
];

export const weekDays = [
  { day: 6, name: 'السبت' },
  { day: 0, name: 'الأحد' },
  { day: 1, name: 'الاثنين' },
  { day: 2, name: 'الثلاثاء' },
  { day: 3, name: 'الأربعاء' },
  { day: 4, name: 'الخميس' },
  { day: 5, name: 'الجمعة' }
];
