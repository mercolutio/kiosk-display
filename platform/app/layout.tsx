import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kiosk-Verwaltung',
  description: 'Verwaltung der Kiosk-Displays',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
