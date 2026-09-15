import { apiUrl } from './client';

// Backend-proxied country flag (PNG) by ISO 3166-1 alpha-2 code. Like the
// airline logo it's just an <img src>; the element hides itself on a 404.
// Returns null when the code isn't a plausible alpha-2.
export function flagUrl(iso2: string | null | undefined): string | null {
	const code = (iso2 ?? '').trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(code)) return null;
	return apiUrl(`/api/flag/${code}`);
}
