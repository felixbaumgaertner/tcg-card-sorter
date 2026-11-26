// Turns one line of text read from a card into a collector code.
// Printed forms: "SFD • 001/221", "VEN • 088a/166 • EN", "UNL • R05a", "RAD • SP3/005 • EN".
// Readers often drop the dot or the spaces ("RADSP3/005·EN"), so separators are optional.

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

const CODE = /^([A-Z]{2,3})[^A-Za-z0-9]{0,3}([A-Z]{0,2}\d{1,3}[a-z]?\*?)(?:\/(\d{3}))?(?![0-9])/;

export function parsePrintedCode(text: string): PrintedCode | null {
	const m = text.trim().match(CODE);
	if (!m) return null;
	const [, set, number, total = null] = m;
	const id = [set, number, total].filter(Boolean).join('-').toLowerCase();
	return { set, number, total, id };
}
