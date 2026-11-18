import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_API_URL: {
		public: true,
		static: true,
		description:
			'Backend URL as the browser reaches it. Baked into the build, so it must be set at build time.'
	}
});
