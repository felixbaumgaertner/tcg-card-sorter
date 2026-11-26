// Where a card is, judged from its code line alone.
//
// More than one card can be in the picture (binder pages, a card lying next to the one meant).
// The reader should take the card in the middle, not the first code it meets. The code is printed
// in a card's bottom left corner, so from the code line's place, direction and height one can
// say roughly where that card's middle is.
import { quarterTurn, readPicture, zoomCrop, type Box, type Line, type Models, type Picture } from './reader';
import { parsePrintedCode, type PrintedCode } from '../code';

// Measured on the test photos, in units of the code line's box height:
// from the start of the code to the card's middle it is about 12 heights along the text
// and about 18 heights up.
const ALONG = 12.4;
const UP = 18;

/** Rough middle of the card a code line belongs to. `flip`: the text was read the other way up. */
export function cardMiddle(box: Box, flip: boolean): { x: number; y: number } {
	const sign = flip ? -1 : 1;
	const ux = Math.cos(box.angle) * sign;
	const uy = Math.sin(box.angle) * sign;
	// "Up" as seen by someone reading the text; on screen y grows downwards.
	const nx = uy;
	const ny = -ux;
	const startX = box.cx - (ux * box.w) / 2;
	const startY = box.cy - (uy * box.w) / 2;
	return {
		x: startX + ux * ALONG * box.h + nx * UP * box.h,
		y: startY + uy * ALONG * box.h + ny * UP * box.h
	};
}

/** Sorting key: how far the line's card is from the middle of the picture. Smaller is better. */
export function offCentre(box: Box, flip: boolean, width: number, height: number): number {
	const m = cardMiddle(box, flip);
	return Math.hypot(m.x - width / 2, m.y - height / 2);
}

// --- reading a card's code ----------------------------------------------------------------------

export interface CardRead {
	code: PrintedCode | null;
	/** Where the code line is, in pixels of the picture that was handed in. */
	codeBox: Box | null;
	lines: Line[];
	/** How the code was found: at once, in an enlarged second look, and/or after a quarter turn. */
	zoomed: boolean;
	turned: boolean;
	detMs: number;
	recMs: number;
}

const isCode = (text: string) => parsePrintedCode(text) !== null;

/** The code among the lines read, with its box. */
function pickCode(lines: Line[]): { code: PrintedCode | null; codeBox: Box | null } {
	for (const line of lines) {
		const code = parsePrintedCode(line.text);
		if (code) return { code, codeBox: line.box };
	}
	return { code: null, codeBox: null };
}

/** A box found in a picture that had been turned a quarter clockwise, back in the unturned picture. */
function unturn(box: Box, originalHeight: number): Box {
	return { ...box, cx: box.cy, cy: originalHeight - box.cx, angle: box.angle - Math.PI / 2 };
}
// The artist and copyright line ("Kudos Productions • ©2025 RGI") shares the bottom edge with the
// code and is printed on a dark strip, so it is found even when the code is not.
const ARTIST_LINE = /20\d\d\s?R/;
/** Card width in units of a bottom line's box height, measured on the test photos. */
const CARD_WIDTH = 28.4;
/** Wanted height of the bottom lines after enlarging, in pixels. */
const ZOOM_LINE_HEIGHT = 44;

/**
 * Second look for a faint code. A code printed over bright artwork (legends, full art) can be
 * too faint for the detection model at normal size. The artist line says where the bottom edge
 * of the card is; the strip to its left is enlarged and searched again.
 */
async function secondLook(pic: Picture, lines: Line[], models: Models): Promise<CardRead | null> {
	let detMs = 0;
	let recMs = 0;
	for (const anchor of lines.filter((l) => ARTIST_LINE.test(l.text)).slice(0, 2)) {
		const { box } = anchor;
		const sign = anchor.flip ? -1 : 1;
		const ux = Math.cos(box.angle) * sign;
		const uy = Math.sin(box.angle) * sign;
		// From the start of the artist line back to the card's left edge, a few line heights thick.
		const startX = box.cx - (ux * box.w) / 2;
		const startY = box.cy - (uy * box.w) / 2;
		const farX = startX - ux * CARD_WIDTH * box.h;
		const farY = startY - uy * CARD_WIDTH * box.h;
		const pad = box.h * 2.2;
		const left = Math.min(startX, farX) - pad;
		const top = Math.min(startY, farY) - pad;
		const width = Math.abs(startX - farX) + 2 * pad;
		const height = Math.abs(startY - farY) + 2 * pad;
		const scale = Math.min(3, Math.max(1, ZOOM_LINE_HEIGHT / box.h));
		const strip = zoomCrop(pic, left, top, width, height, scale);
		const found = await readPicture(strip, models, { detSide: 4096, accept: isCode, retryTurned: false });
		detMs += found.detMs;
		recMs += found.recMs;
		const { code, codeBox } = pickCode(found.lines);
		if (code && codeBox) {
			// Back from the enlarged strip to the picture (zoomCrop starts at whole, non-negative pixels).
			const x0 = Math.max(0, Math.floor(left));
			const y0 = Math.max(0, Math.floor(top));
			const inPicture: Box = {
				...codeBox,
				cx: x0 + codeBox.cx / scale,
				cy: y0 + codeBox.cy / scale,
				w: codeBox.w / scale,
				h: codeBox.h / scale
			};
			return { code, codeBox: inPicture, lines: found.lines, zoomed: true, turned: false, detMs, recMs };
		}
	}
	return detMs ? { code: null, codeBox: null, lines: [], zoomed: true, turned: false, detMs, recMs } : null;
}

/**
 * Finds the printed code of the card in the middle of the picture. The card may lie any way
 * round. Tries, in this order: a normal read, an enlarged second look at the bottom edge, and
 * both again with the picture turned a quarter (the detection model is weaker on text that runs
 * up and down).
 */
export async function readCard(pic: Picture, models: Models, options: { detSide?: number } = {}): Promise<CardRead> {
	let detMs = 0;
	let recMs = 0;
	let firstLines: Line[] = [];
	for (const turned of [false, true]) {
		const view = turned ? quarterTurn(pic) : pic;
		const found = await readPicture(view, models, { ...options, accept: isCode, rank: offCentre, retryTurned: false });
		detMs += found.detMs;
		recMs += found.recMs;
		if (!turned) firstLines = found.lines;
		const back = (box: Box | null) => (box && turned ? unturn(box, pic.height) : box);
		const { code, codeBox } = pickCode(found.lines);
		if (code) return { code, codeBox: back(codeBox), lines: found.lines, zoomed: false, turned, detMs, recMs };

		const second = await secondLook(view, found.lines, models);
		if (second) {
			detMs += second.detMs;
			recMs += second.recMs;
			if (second.code) return { ...second, codeBox: back(second.codeBox), turned, detMs, recMs };
		}
	}
	return { code: null, codeBox: null, lines: firstLines, zoomed: false, turned: false, detMs, recMs };
}

/** The four corners of a box, for drawing it. */
export function corners(box: Box): [number, number][] {
	const ux = (Math.cos(box.angle) * box.w) / 2;
	const uy = (Math.sin(box.angle) * box.w) / 2;
	const vx = (-Math.sin(box.angle) * box.h) / 2;
	const vy = (Math.cos(box.angle) * box.h) / 2;
	return [
		[box.cx - ux - vx, box.cy - uy - vy],
		[box.cx + ux - vx, box.cy + uy - vy],
		[box.cx + ux + vx, box.cy + uy + vy],
		[box.cx - ux + vx, box.cy - uy + vy]
	];
}
