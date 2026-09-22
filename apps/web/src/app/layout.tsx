import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'IPT PowerTech PM System', template: '%s · IPT PowerTech PM' },
  description: 'Telecom site power preventive maintenance management — IPT PowerTech Liberia.',
};

export const viewport: Viewport = {
  themeColor: '#0b1f3a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
