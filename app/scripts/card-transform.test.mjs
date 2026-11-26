import { describe, expect, it } from 'vitest';
import { buildCards, cleanName, dedupe, variantOf } from './card-transform.mjs';

const entry = (over = {}) => ({
	riftbound_id: 'ven-095-166',
	name: 'Shadow Order Disciple',
	collector_number: 95,
	tcgplayer_id: '706100',
	new: false,
	set: { set_id: 'VEN' },
	classification: { type: 'Unit', supertype: null, rarity: 'Common', domain: ['Chaos'] },
	orientation: 'portrait',
	metadata: { clean_name: 'Shadow Order Disciple', alternate_art: false, overnumbered: false, signature: false },
	...over
});

describe('variantOf', () => {
	it.each([
		['ven-095-166', {}, 'normal'],
		['ven-042a-166', {}, 'alt'],
		['opp-007b-298', {}, 'alt'],
		['unl-229*-219', {}, 'signature'],
		['ven-195-166', { overnumbered: true }, 'overnumbered'],
		['ven-r02', {}, 'rune'],
		['ven-sp2-006', {}, 'special'],
		['sfd-t03', {}, 'token']
	])('%s → %s', (id, meta, want) => {
		expect(variantOf(id, meta)).toBe(want);
	});
});

describe('cleanName', () => {
	it('removes the printing note', () => {
		expect(cleanName('Shen, Scourge of Shadows (Alternate Art)')).toBe('Shen, Scourge of Shadows');
		expect(cleanName('Vi - Piltover Enforcer (Signature)')).toBe('Vi - Piltover Enforcer');
	});
	it('leaves normal names alone', () => {
		expect(cleanName('Blade Twirler')).toBe('Blade Twirler');
	});
});

describe('dedupe', () => {
	it('keeps one entry per id and prefers the complete one', () => {
		const thin = entry({ tcgplayer_id: null, new: true, metadata: { clean_name: null } });
		const out = dedupe([thin, entry()]);
		expect(out).toHaveLength(1);
		expect(out[0].tcgplayer_id).toBe('706100');
	});
});

describe('buildCards', () => {
	it('sorts by set, then number, and shapes the card', () => {
		const cards = buildCards([
			entry({ riftbound_id: 'ven-096-166', collector_number: 96 }),
			entry(),
			entry({ riftbound_id: 'ogn-001-298', collector_number: 1, set: { set_id: 'OGN' } })
		]);
		expect(cards.map((c) => c.id)).toEqual(['ogn-001-298', 'ven-095-166', 'ven-096-166']);
		expect(cards[1]).toEqual({
			id: 'ven-095-166', set: 'VEN', num: 95, variant: 'normal', name: 'Shadow Order Disciple',
			type: 'Unit', supertype: null, rarity: 'Common', domains: ['Chaos'], landscape: false
		});
	});
});
