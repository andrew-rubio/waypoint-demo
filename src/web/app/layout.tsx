import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Waypoint — Holiday Planning Agent',
  description: 'A GitHub Copilot SDK demo: plan and book holidays conversationally.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
