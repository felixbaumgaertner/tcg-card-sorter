// Fetches every set and card from Riftcodex and writes src/lib/data/cards.json.
// Run with: npm run cards
// Text only: no card images are downloaded or stored.
import { writeFile } from 'node:fs/promises';
import { buildCards } from './card-transform.mjs';

const API = 'https://api.riftcodex.com';
const OUT = new URL('../src/lib/data/cards.json', import.meta.url);

async function fetchAll(path) {
	const items = [];
	for (let page = 1; ; page++) {
		const sep = path.includes('?') ? '&' : '?';
		// The API refuses page sizes above 100.
		const res = await fetch(`${API}${path}${sep}size=100&page=${page}`);
		if (!res.ok) throw new Error(`${path} page ${page}: HTTP ${res.status}`);
		const body = await res.json();
		items.push(...body.items);
		if (page >= body.pages) return items;
	}
}

const rawSets = await fetchAll('/sets');
const sets = rawSets
	.map((s) => ({ id: s.set_id, name: s.name, published: s.published_on.slice(0, 10) }))
	.sort((a, b) => a.published.localeCompare(b.published) || a.id.localeCompare(b.id));

const raw = [];
for (const set of sets) raw.push(...(await fetchAll(`/cards?set_id=${set.id}`)));
const cards = buildCards(raw);

if (cards.length === 0) throw new Error('Riftcodex returned no cards');
for (const set of sets) {
	const n = cards.filter((c) => c.set === set.id).length;
	if (n === 0) throw new Error(`Set ${set.id} has no cards`);
	console.log(`${set.id.padEnd(4)} ${String(n).padStart(4)}  ${set.name}`);
}

// No timestamp in the file, so re-running without changes gives an identical file.
const json = JSON.stringify({ source: API, sets, cards }, null, '\t') + '\n';
await writeFile(OUT, json);
console.log(`${cards.length} cards from ${raw.length} entries → src/lib/data/cards.json`);
