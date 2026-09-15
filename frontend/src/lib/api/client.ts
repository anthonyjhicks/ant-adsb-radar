import { PUBLIC_API_URL } from '$env/static/public';
import { browser } from '$app/environment';

function getBaseUrl(): string {
	if (browser) {
		// Pick the backend at runtime from how the page was loaded:
		//  - LAN (private IP / localhost / a bare machine hostname): talk
		//    DIRECTLY to the backend (PUBLIC_API_URL) — the fast, zero-hop path.
		//  - Anything else (e.g. a reverse proxy or tunnel on a public
		//    hostname): use same-origin relative URLs, which the proxy routes
		//    to the backend. Avoids the unreachable LAN IP + mixed content.
		const h = window.location.hostname;
		const isLan =
			h === 'localhost' ||
			h === '127.0.0.1' ||
			// A dot-less, single-label hostname (e.g. the kiosk host's own
			// machine name) is always LAN-local; public sites are FQDNs.
			!h.includes('.') ||
			h.endsWith('.localdomain') ||
			/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
		return isLan ? PUBLIC_API_URL || '' : '';
	}
	// Server-side SSR: use INTERNAL_API_URL (Docker service name) if available,
	// otherwise fall back to PUBLIC_API_URL or localhost for dev
	const internalUrl = typeof process !== 'undefined' ? process.env.INTERNAL_API_URL : undefined;
	return internalUrl || PUBLIC_API_URL || 'http://localhost:8000';
}

const BASE_URL = getBaseUrl();

// Turn a backend-relative path (e.g. "/api/photo/img/ABC123") into a URL the
// browser can load directly, using the same base resolution as the API calls.
export function apiUrl(path: string): string {
	return `${BASE_URL}${path}`;
}

export async function apiGet<T>(
	path: string,
	fetchFn: typeof fetch = fetch
): Promise<T> {
	const res = await fetchFn(`${BASE_URL}${path}`);
	if (!res.ok) {
		throw new Error(`API error: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

export async function apiPost<T>(
	path: string,
	fetchFnOrBody?: typeof fetch | unknown,
	fetchFn?: typeof fetch
): Promise<T> {
	// Support both apiPost(path, fetch) and apiPost(path, body, fetch)
	let body: unknown | undefined;
	let actualFetch: typeof fetch;
	if (typeof fetchFnOrBody === 'function') {
		actualFetch = fetchFnOrBody as typeof fetch;
	} else {
		body = fetchFnOrBody;
		actualFetch = fetchFn ?? fetch;
	}

	const options: RequestInit = { method: 'POST' };
	if (body !== undefined) {
		options.headers = { 'Content-Type': 'application/json' };
		options.body = JSON.stringify(body);
	}

	const res = await actualFetch(`${BASE_URL}${path}`, options);
	if (!res.ok) {
		throw new Error(`API error: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

export async function apiPut<T>(
	path: string,
	body: unknown,
	fetchFn: typeof fetch = fetch
): Promise<T> {
	const res = await fetchFn(`${BASE_URL}${path}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(await errorMessage(res));
	}
	return res.json();
}

// FastAPI puts the reason in `detail` (a string for our own 422s, a list for
// pydantic's) — worth showing in an editor rather than just the status line.
async function errorMessage(res: Response): Promise<string> {
	const fallback = `API error: ${res.status} ${res.statusText}`;
	try {
		const body = await res.json();
		const detail = body?.detail;
		if (typeof detail === 'string') return detail;
		if (Array.isArray(detail)) {
			const msg = detail
				.map((d) => (d?.loc ? `${d.loc.slice(1).join('.')}: ${d.msg}` : d?.msg))
				.filter(Boolean)
				.join('; ');
			if (msg) return msg;
		}
	} catch {
		// not JSON
	}
	return fallback;
}

export function getSSEUrl(): string {
	return `${BASE_URL}/api/events`;
}
