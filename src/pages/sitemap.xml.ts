import type { APIRoute } from 'astro';
import { getAllArtists } from '../utils/artists';
import { getAllExhibitions } from '../utils/exhibitions';

const staticPages = [
  '',
  'artisti/',
  'contact/',
  'current/',
  'expozitii/',
  'locatii/',
  'past/',
  'politica-confidentialitate/',
  'termeni/',
  'upcoming/',
];

function toAbsoluteUrl(path: string, site: URL): string {
  const basePath = import.meta.env.BASE_URL;
  const normalizedPath = path ? `${basePath}${path}` : basePath;
  return new URL(normalizedPath, site).toString();
}

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    return new Response('Missing site URL configuration.', { status: 500 });
  }

  const urls = [
    ...staticPages.map((path) => toAbsoluteUrl(path, site)),
    ...getAllArtists().map((artist) => toAbsoluteUrl(`artist/${artist.id}/`, site)),
    ...getAllExhibitions().map((exhibition) => toAbsoluteUrl(`exhibition/${exhibition.id}/`, site)),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
