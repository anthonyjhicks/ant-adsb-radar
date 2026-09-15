import { apiUrl } from './client';

// Backend-proxied airline logo (PNG) by IATA code. It's just an <img src>; the
// element's onerror handles the "no logo" 404 by hiding itself, so there's no
// fetch/cache dance here. Returns null when we have no IATA code to key on.
export function logoUrl(iata: string | null | undefined): string | null {
	const code = (iata ?? '').trim().toUpperCase();
	if (!/^[A-Z0-9]{2}$/.test(code)) return null;
	return apiUrl(`/api/logo/${code}`);
}
