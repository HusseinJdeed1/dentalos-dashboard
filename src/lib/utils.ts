export const currencies = [
  { code: 'USD', symbol: '$', label: 'دولار أمريكي' },
  { code: 'SYP', symbol: 'ل.س', label: 'ليرة سورية' },
  { code: 'SAR', symbol: 'ر.س', label: 'ريال سعودي' },
  { code: 'AED', symbol: 'د.إ', label: 'درهم إماراتي' },
  { code: 'QAR', symbol: 'ر.ق', label: 'ريال قطري' },
  { code: 'KWD', symbol: 'د.ك', label: 'دينار كويتي' },
  { code: 'BHD', symbol: 'د.ب', label: 'دينار بحريني' },
  { code: 'OMR', symbol: 'ر.ع', label: 'ريال عُماني' },
  { code: 'IQD', symbol: 'د.ع', label: 'دينار عراقي' },
  { code: 'LBP', symbol: 'ل.ل', label: 'ليرة لبنانية' },
  { code: 'JOD', symbol: 'د.أ', label: 'دينار أردني' }
] as const;

export type CurrencyCode = typeof currencies[number]['code'];

export function getCurrencySymbol(code?: string | null, fallbackSymbol?: string | null) {
  if (fallbackSymbol) return fallbackSymbol;
  return currencies.find((item) => item.code === code)?.symbol || 'ر.س';
}

export function formatMoney(value?: number | null, currencySymbol = 'ر.س') {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0)) + ` ${currencySymbol}`;
}
export function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
export function todayISO() { return localDateISO(); }
export function monthStartISO() { const d = new Date(); return localDateISO(new Date(d.getFullYear(), d.getMonth(), 1)); }
export function toEnglishDigits(value: string | number) {
  return String(value)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try { return toEnglishDigits(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))); } catch { return toEnglishDigits(String(value)); }
}
export function clsx(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(' '); }

export function timeToMinutes(value?: string | null) {
  if (!value) return 0;
  const [h = '0', m = '0'] = value.slice(0, 5).split(':');
  return Number(h) * 60 + Number(m);
}
export function getDayOfWeek(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`).getDay();
}
