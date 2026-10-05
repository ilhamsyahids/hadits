// First visit from an Arabic-speaking country: show the Arabic site. A `lang` cookie (set by the language switch,
// or by this redirect) means the reader already has a language, so it never redirects twice.

const ARABIC_COUNTRIES = new Set(['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'JO', 'SY', 'LB', 'IQ', 'PS', 'EG', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SD', 'SO', 'DJ', 'KM']);
const NOT_A_PAGE = /^\/(ar(\/|$)|v1\/|admin\/|agents\/|_astro\/|fonts\/|health)/;

/** The /ar URL to send this request to, or null to serve it as is. */
export function arabicRedirect(url: URL, country: string | undefined, cookie: string | undefined): string | null {
  const path = url.pathname;
  if (NOT_A_PAGE.test(path) || /\.[a-z0-9]+$/i.test(path)) return null;
  if (!country || !ARABIC_COUNTRIES.has(country)) return null;
  if (/(^|;\s*)lang=/.test(cookie ?? '')) return null;
  return `/ar${path === '/' ? '/' : path}${url.search}`;
}
