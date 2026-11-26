// Where a card is, judged from its code line alone.
//
// More than one card can be in the picture (binder pages, a card lying next to the one meant).
// The reader should take the card in the middle, not the first code it meets. The code is printed
// in a card's bottom left corner, so from the code line's place, direction and height one can
// say roughly where that card's middle is.
import type { Box } from './reader';

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
