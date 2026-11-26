import { describe, expect, it } from 'vitest';
import { cardById, cards, sets } from './cards';

describe('built-in card list', () => {
	it('has cards for every set', () => {
		expect(sets.length).toBeGreaterThan(0);
		for (const set of sets) {
			expect(cards.some((c) => c.set === set.id), set.id).toBe(true);
		}
	});

	it('has no duplicate ids', () => {
		expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
	});

	it('finds a card by id, ignoring case', () => {
		expect(cardById('VEN-095-166')?.name).toBe('Shadow Order Disciple');
	});

	it('lists sets oldest first', () => {
		const dates = sets.map((s) => s.published);
		expect(dates).toEqual([...dates].sort());
	});
});
