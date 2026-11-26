// Pure functions that turn Riftcodex and Piltover Archive entries into the app's card list.
// Kept apart from the fetching so they can be tested without the network.

/**
 * @typedef {'normal'|'alt'|'overnumbered'|'signature'|'rune'|'special'|'token'|'promo'} Variant
 * @typedef {{ id: string, set: string, num: number, variant: Variant, name: string,
 *   type: string, supertype: string|null, rarity: string, domains: string[], landscape: boolean }} Card
 */

/** Which kind of printing a Riftcodex id stands for. @returns {Variant} */
export function variantOf(riftboundId, metadata = {}) {
	const [, middle = ''] = riftboundId.split('-');
	if (/^r\d+$/.test(middle)) return 'rune';
	if (/^sp\d+$/.test(middle)) return 'special';
	if (/^t\d+$/.test(middle)) return 'token';
	if (middle.endsWith('*') || metadata.signature) return 'signature';
	if (/\d[a-z]$/.test(middle) || metadata.alternate_art) return 'alt';
	if (metadata.overnumbered) return 'overnumbered';
	return 'normal';
}

/** Card name without the "(Alternate Art)" style notes Riftcodex adds. */
export function cleanName(raw) {
	return raw.replace(/\s*\((Alternate Art|Overnumbered|Signature)\)\s*$/i, '').trim();
}

/**
 * Riftcodex lists most cards twice. Keep one entry per riftbound_id:
 * the one with a clean name, then the one with a TCGplayer id, then the newest.
 */
export function dedupe(entries) {
	const score = (e) =>
		(e.metadata?.clean_name ? 4 : 0) + (e.tcgplayer_id ? 2 : 0) + (e.new ? 0 : 1);
	const best = new Map();
	for (const e of entries) {
		const seen = best.get(e.riftbound_id);
		if (!seen || score(e) > score(seen)) best.set(e.riftbound_id, e);
	}
	return [...best.values()];
}

/** @returns {Card} */
export function toCard(e) {
	return {
		id: e.riftbound_id,
		set: e.set.set_id,
		num: e.collector_number,
		variant: variantOf(e.riftbound_id, e.metadata),
		name: cleanName(e.metadata?.clean_name ?? e.name),
		type: e.classification.type,
		supertype: e.classification.supertype ?? null,
		rarity: e.classification.rarity,
		domains: e.classification.domain ?? [],
		landscape: e.orientation === 'landscape'
	};
}

/** Full transform: raw Riftcodex entries → sorted card list. */
export function buildCards(entries) {
	return dedupe(entries)
		.map(toCard)
		.sort((a, b) => a.set.localeCompare(b.set) || a.num - b.num || a.id.localeCompare(b.id));
}

// --- Piltover Archive: fills what Riftcodex does not have (yet) ----------------------------------

/** "RAD-091a" → { set: "RAD", number: "091a" }. Null for numbers with extra notes ("RAD-157-Prize"). */
export function splitVariantNumber(variantNumber) {
	const m = variantNumber.match(/^([A-Z]{2,3})-([A-Z]{0,2}\d{1,3}[a-z*]?)$/);
	return m ? { set: m[1], number: m[2] } : null;
}

/** The same key for a Riftcodex id ("ven-088a-166") and a Piltover Archive number ("VEN-088a"). */
export function printKey(set, number) {
	return `${set}-${number}`.toLowerCase();
}

/** @returns {Card|null} */
export function piltoverToCard(row) {
	const split = splitVariantNumber(row.variantNumber);
	if (!split || split.set !== row.set.prefix) return null;
	const { set, number } = split;
	/** @type {Variant} */
	let variant = 'normal';
	if (/^R\d/.test(number)) variant = 'rune';
	else if (/^SP\d/.test(number)) variant = 'special';
	else if (/^T\d/.test(number)) variant = 'token';
	else if (number.endsWith('*')) variant = 'signature';
	else if (row.variantType === 'Promo') variant = 'promo';
	else if (/[a-z]$/.test(number) || row.variantType === 'Alt Art') variant = 'alt';
	else if (row.variantType.startsWith('Overnumbered')) variant = 'overnumbered';
	return {
		// No "/total" part: Piltover Archive does not have it.
		id: printKey(set, number),
		set,
		num: Number(number.match(/\d+/)[0]),
		variant,
		name: row.card.name,
		type: row.card.type,
		supertype: row.card.super ?? null,
		rarity: row.rarity,
		domains: (row.card.colors ?? []).map((c) => c.name),
		landscape: row.card.type === 'Battlefield'
	};
}

/**
 * Adds the Piltover Archive printings that the Riftcodex list lacks, and the sets they need.
 * Riftcodex stays the first choice: a printing it has is never replaced.
 * @param {{ sets: {id: string, name: string, published: string}[], cards: Card[] }} base
 */
export function addPiltover(base, rows) {
	const have = new Set(base.cards.map((c) => c.id.replace(/-\d{3}$/, '')));
	const sets = [...base.sets];
	const added = [];
	for (const row of rows) {
		const card = piltoverToCard(row);
		if (!card || have.has(card.id)) continue;
		have.add(card.id);
		added.push(card);
		if (!sets.some((s) => s.id === card.set)) {
			sets.push({ id: card.set, name: row.set.name, published: row.set.releaseDate.slice(0, 10) });
		}
	}
	const order = (a, b) => a.set.localeCompare(b.set) || a.num - b.num || a.id.localeCompare(b.id);
	return {
		sets: sets.sort((a, b) => a.published.localeCompare(b.published) || a.id.localeCompare(b.id)),
		cards: [...base.cards, ...added].sort(order),
		added: added.length
	};
}
