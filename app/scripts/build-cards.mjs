// Fetches every set and card from Riftcodex, fills the gaps from Piltover Archive (newest set,
// some runes) and writes src/lib/data/cards.json.
// Run with: npm run cards
// Text only: no card images are downloaded or stored.
import { writeFile } from 'node:fs/promises';
import { addPiltover, buildCards } from './card-transform.mjs';

const API = 'https://api.riftcodex.com';
const PILTOVER = 'https://piltoverarchive.com/api/external/v1';
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
const fromRiftcodex = buildCards(raw);
if (fromRiftcodex.length === 0) throw new Error('Riftcodex returned no cards');

// Piltover Archive: public card catalogue, no key (sending one makes it refuse).
const piltover = [];
for (let page = 1; ; page++) {
	const res = await fetch(`${PILTOVER}/cards?limit=100&page=${page}`);
	if (!res.ok) throw new Error(`Piltover Archive page ${page}: HTTP ${res.status}`);
	const body = await res.json();
	piltover.push(...body.data);
	if (!body.pagination.hasNext) break;
}
if (piltover.length === 0) throw new Error('Piltover Archive returned no cards');

const { sets: allSets, cards, added } = addPiltover({ sets, cards: fromRiftcodex }, piltover);
for (const set of allSets) {
	const n = cards.filter((c) => c.set === set.id).length;
	if (n === 0) throw new Error(`Set ${set.id} has no cards`);
	console.log(`${set.id.padEnd(4)} ${String(n).padStart(4)}  ${set.name}`);
}

// No timestamp in the file, so re-running without changes gives an identical file.
const json = JSON.stringify({ source: [API, PILTOVER], sets: allSets, cards }, null, '\t') + '\n';
await writeFile(OUT, json);
console.log(`${cards.length} cards (${added} only in Piltover Archive) → src/lib/data/cards.json`);
