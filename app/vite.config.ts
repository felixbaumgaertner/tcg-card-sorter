import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the app from /<repo-name>/, so the deploy workflow sets BASE_PATH.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Plain static files: the app has no server.
			adapter: adapter(),
			paths: { base }
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs']
	}
});
