/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // The dashboard and learned pages are force-dynamic and must always reflect the
  // latest practice data. Forbid the browser/CDN from serving a cached document
  // so a reload (or PWA relaunch) never shows frozen streak/accuracy/due numbers.
  async headers() {
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/learned',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/listen',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};
