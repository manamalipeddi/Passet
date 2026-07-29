import type { MetadataRoute } from 'next';

// Web app manifest — makes Passet installable and lets it launch standalone
// (no browser URL bar) once added to the home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Passet',
    short_name: 'Passet',
    description: 'Swedish vocabulary and grammar practice.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF3E7',
    theme_color: '#C8493C',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      // Same art flagged as maskable so Android can crop it to any shape.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
