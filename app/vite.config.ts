import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// js-clipper (used by the text reader) ships a file that is not valid UTF-8, which the bundler
// refuses to load. The odd bytes sit only in comments, so a re-encoded copy is used instead.
const clipperSource = fileURLToPath(new URL('./node_modules/js-clipper/clipper.js', import.meta.url));
const clipperCopy = fileURLToPath(new URL('./node_modules/.cache/js-clipper-utf8.cjs', import.meta.url));
mkdirSync(fileURLToPath(new URL('./node_modules/.cache/', import.meta.url)), { recursive: true });
writeFileSync(clipperCopy, readFileSync(clipperSource, 'latin1'));

// GitHub Pages serves the app from /<repo-name>/, so the deploy workflow sets BASE_PATH.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	resolve: { alias: { 'js-clipper': clipperCopy } },
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
