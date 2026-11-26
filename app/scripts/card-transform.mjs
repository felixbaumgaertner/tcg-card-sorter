// Pure functions that turn Riftcodex entries into the app's card list.
// Kept apart from the fetching so they can be tested without the network.

/**
 * @typedef {'normal'|'alt'|'overnumbered'|'signature'|'rune'|'special'|'token'} Variant
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
