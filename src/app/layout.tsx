import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DentalOS Premium Dashboard',
  description: 'لوحة تحكم احترافية لعيادات الأسنان',
  manifest: '/manifest.json'
};

export const viewport: Viewport = {
  themeColor: '#008d96'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ar" dir="rtl" suppressHydrationWarning><body>{children}</body></html>;
}
