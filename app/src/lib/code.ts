// Turns one line of text read from a card into a collector code.
// Printed forms: "SFD • 001/221", "VEN • 088a/166 • EN", "UNL • R05a", "RAD • SP3/005 • EN".
// Readers often drop the dot or the spaces ("RADSP3/005·EN"), so separators are optional.

import { sets } from './cards';

export interface PrintedCode {
	/** Set code as printed, e.g. "VEN". */
	set: string;
	/** Number part as printed, e.g. "088a", "R05a", "SP3", "310". */
	number: string;
	/** The part after the slash, e.g. "166". Runes and tokens have none. */
	total: string | null;
	/** Id in the card list's format, e.g. "ven-088a-166" or "unl-r05a". */
	id: string;
}

// The number is always three digits ("088a", "229*") or letters plus digits ("R05a", "SP3", "T03").
// A shorter number means the reader lost part of the line, so it is rejected.
const CODE =
	/^([A-Z]{2,3})[^A-Za-z0-9]{0,3}(\d{3}[a-z]?\*?|[A-Z]{1,2}\d{1,2}[a-z]?)(?:\/(\d{3}))?(?![0-9])/;

/**
 * Set codes that can be printed on a card. Text read upside down sometimes looks like a code
 * ("ZIN SS7"), so anything with another set code is thrown away.
 */
export const knownSets: ReadonlySet<string> = new Set(sets.map((s) => s.id));

export function parsePrintedCode(text: string): PrintedCode | null {
	// The slash is sometimes read as a 7 ("0257298" for "025/298"). Seven digits in a row can only
	// be that, because no number has more than three.
	const fixed = text.trim().replace(/^([A-Z]{2,3}[^A-Za-z0-9]{0,3}\d{3})7(\d{3})(?![0-9])/, '$1/$2');
	const m = fixed.match(CODE);
	if (!m) return null;
	const [, set, number, total = null] = m;
	if (!knownSets.has(set)) return null;
	// A plain three-digit number is always followed by "/total". Without it, the reader lost the
	// end of the line and may have the digits wrong too ("RAD 128" seen for "RAD 129/167").
	if (/^\d/.test(number) && total === null) return null;
	const id = [set, number, total].filter(Boolean).join('-').toLowerCase();
	return { set, number, total, id };
}
