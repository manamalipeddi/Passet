import './globals.css';
import type { Metadata, Viewport } from 'next';
import Nav from './components/Nav';

export const metadata: Metadata = {
  title: 'Passet',
  description: 'Swedish vocabulary and grammar practice.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-icon.png',
  },
  // iOS ignores the manifest's `display` — this is what makes an
  // added-to-home-screen launch run standalone (no Safari URL bar).
  appleWebApp: {
    capable: true,
    title: 'Passet',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#C8493C',
  // Fill the notch/safe areas so it feels like a native app, not a web page.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
