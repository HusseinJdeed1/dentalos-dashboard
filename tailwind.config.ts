import type { Config } from 'tailwindcss';

const config: Config = {
  // Keep Tailwind scanning limited to UI files only.
  // This avoids Windows EBUSY locks when Turbopack/Tailwind tries to read logic files in src/lib during dev.
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        muted: 'hsl(var(--muted))',
        border: 'hsl(var(--border))',
        primary: 'hsl(var(--primary))',
        primaryForeground: 'hsl(var(--primary-foreground))',
        accent: 'hsl(var(--accent))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))'
      },
      boxShadow: {
        premium: '0 18px 45px rgba(15, 23, 42, 0.08)',
        subtle: '0 8px 24px rgba(15, 23, 42, 0.06)'
      }
    }
  },
  plugins: []
};
export default config;
