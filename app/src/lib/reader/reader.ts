// Finds and reads lines of text in a picture with the two PaddleOCR (PP-OCRv4) models.
//
// Nothing in this file touches the browser: pictures come in as plain RGBA pixels and the models
// are handed in, so the same code runs in the app (ONNX Runtime Web) and in tests (ONNX Runtime
// for Node).
//
// Steps:
//   1. Shrink the picture and ask the detection model where text is. It answers with a map that
//      says, per pixel, how likely that pixel is text.
//   2. Group the likely pixels into blobs and put a slanted rectangle around each blob.
//   3. Cut each rectangle out of the full-size picture, straightened, 48 px high.
//   4. Ask the recognition model what each cut-out says.

/** RGBA pixels, row by row, four bytes per pixel. */
export interface Picture {
	data: Uint8ClampedArray | Uint8Array;
	width: number;
	height: number;
}

export interface ModelOutput {
	data: Float32Array;
	dims: readonly number[];
}

/** One loaded model. `dims` is [1, 3, height, width]. */
export type Model = (input: Float32Array, dims: [number, number, number, number]) => Promise<ModelOutput>;

/** A slanted rectangle around one line of text, in pixels of the full-size picture. */
export interface Box {
	cx: number;
	cy: number;
	/** Length along the text. */
	w: number;
	/** Height of the line. */
	h: number;
	/** Direction of the text in radians; 0 = left to right, positive = turning clockwise on screen. */
	angle: number;
	/** How sure the detection model is, 0 to 1. */
	score: number;
}

export interface Line {
	text: string;
	/** Average certainty of the characters, 0 to 1. */
	confidence: number;
	box: Box;
	/** True if the box was read the other way up to get this text. */
	flip: boolean;
}

export interface ReadOptions {
	/** Longest side of the shrunk picture used to find text. Smaller is faster. */
	detSide?: number;
	/**
	 * Says whether a line of text is what is being looked for. With it, every line is also tried
	 * the other way up (a slanted rectangle does not say which way up its text is), and reading
	 * stops at the first line it likes.
	 */
	accept?: (text: string) => boolean;
	/**
	 * Lines are read in the order of this number, smallest first. Together with `accept` this
	 * decides which line wins when several would be accepted. `flip`: read the other way up.
	 */
	rank?: (box: Box, flip: boolean, width: number, height: number) => number;
	/**
	 * The detection model is weaker on text that runs up and down. If nothing was accepted, turn
	 * the picture a quarter and search once more. Needs `accept`. Default: on.
	 */
	retryTurned?: boolean;
}

export interface ReadResult {
	lines: Line[];
	/** True if the accepted lines were found on the second, upside-down pass. */
	flipped: boolean;
	/** True if nothing was accepted until the whole picture was turned a quarter and searched again. */
	turned: boolean;
	detMs: number;
	recMs: number;
	boxes: number;
}

const LINE_HEIGHT = 48;
/** Cut-outs are padded to a multiple of this width, so the model sees only a few input shapes. */
const WIDTH_STEP = 160;
const MAX_LINE_WIDTH = 1280;

// --- step 1: shrink -----------------------------------------------------------------------------

/** Size of the shrunk picture: longest side at most `side`, both sides a multiple of 32. */
export function detSize(width: number, height: number, side: number): { width: number; height: number } {
	const scale = Math.min(1, side / Math.max(width, height));
	const round32 = (v: number) => Math.max(32, Math.round((v * scale) / 32) * 32);
	return { width: round32(width), height: round32(height) };
}

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

/** Shrinks the picture by averaging and lays it out the way the detection model wants it. */
export function detInput(pic: Picture, width: number, height: number): Float32Array {
	const out = new Float32Array(3 * width * height);
	const plane = width * height;
	const sx = pic.width / width;
	const sy = pic.height / height;
	for (let y = 0; y < height; y++) {
		const y0 = Math.floor(y * sy);
		const y1 = Math.max(y0 + 1, Math.min(pic.height, Math.floor((y + 1) * sy)));
		for (let x = 0; x < width; x++) {
			const x0 = Math.floor(x * sx);
			const x1 = Math.max(x0 + 1, Math.min(pic.width, Math.floor((x + 1) * sx)));
			let r = 0;
			let g = 0;
			let b = 0;
			for (let yy = y0; yy < y1; yy++) {
				let p = (yy * pic.width + x0) * 4;
				for (let xx = x0; xx < x1; xx++, p += 4) {
					r += pic.data[p];
					g += pic.data[p + 1];
					b += pic.data[p + 2];
				}
			}
			const n = (y1 - y0) * (x1 - x0) * 255;
			const i = y * width + x;
			// The models were trained on blue-green-red order.
			out[i] = (b / n - DET_MEAN[0]) / DET_STD[0];
			out[plane + i] = (g / n - DET_MEAN[1]) / DET_STD[1];
			out[2 * plane + i] = (r / n - DET_MEAN[2]) / DET_STD[2];
		}
	}
	return out;
}

// --- step 2: blobs to boxes ---------------------------------------------------------------------

export interface BoxOptions {
	/** A pixel counts as text above this value. */
	threshold?: number;
	/** A blob is kept if its pixels average above this value. */
	minScore?: number;
	/** Blobs with fewer pixels are noise. */
	minPixels?: number;
	/** The model marks a shrunken core of each line; boxes are grown back by this factor. */
	grow?: number;
}

/**
 * Turns the detection model's map into boxes, in map pixels. Each blob of connected text pixels
 * gets the slanted rectangle that follows its longest direction.
 */
export function findBoxes(map: Float32Array, width: number, height: number, options: BoxOptions = {}): Box[] {
	const { threshold = 0.3, minScore = 0.5, minPixels = 12, grow = 1.6 } = options;
	const seen = new Uint8Array(width * height);
	const stack = new Int32Array(width * height);
	const boxes: Box[] = [];

	for (let start = 0; start < map.length; start++) {
		if (seen[start] || map[start] <= threshold) continue;
		// Collect one blob; `stack` doubles as the list of its pixels.
		let count = 0;
		let next = 0;
		stack[count++] = start;
		seen[start] = 1;
		while (next < count) {
			const p = stack[next++];
			const x = p % width;
			const y = (p - x) / width;
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy;
				if (ny < 0 || ny >= height) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					if (nx < 0 || nx >= width) continue;
					const q = ny * width + nx;
					if (!seen[q] && map[q] > threshold) {
						seen[q] = 1;
						stack[count++] = q;
					}
				}
			}
		}
		if (count < minPixels) continue;

		let sum = 0;
		let mx = 0;
		let my = 0;
		for (let i = 0; i < count; i++) {
			const p = stack[i];
			sum += map[p];
			mx += p % width;
			my += Math.floor(p / width);
		}
		const score = sum / count;
		if (score < minScore) continue;
		mx /= count;
		my /= count;

		// Longest direction of the blob.
		let xx = 0;
		let yy = 0;
		let xy = 0;
		for (let i = 0; i < count; i++) {
			const p = stack[i];
			const dx = (p % width) - mx;
			const dy = Math.floor(p / width) - my;
			xx += dx * dx;
			yy += dy * dy;
			xy += dx * dy;
		}
		const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);

		// How far the blob reaches along that direction and across it.
		let minU = Infinity;
		let maxU = -Infinity;
		let minV = Infinity;
		let maxV = -Infinity;
		for (let i = 0; i < count; i++) {
			const p = stack[i];
			const dx = (p % width) - mx;
			const dy = Math.floor(p / width) - my;
			const u = dx * ux + dy * uy;
			const v = -dx * uy + dy * ux;
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}
		const w = maxU - minU + 1;
		const h = maxV - minV + 1;
		const midU = (minU + maxU) / 2;
		const midV = (minV + maxV) / 2;
		const pad = (w * h * grow) / (2 * (w + h));
		boxes.push({
			cx: mx + midU * ux - midV * uy + 0.5,
			cy: my + midU * uy + midV * ux + 0.5,
			w: w + 2 * pad,
			h: h + 2 * pad,
			angle,
			score
		});
	}
	return boxes;
}

/**
 * Faint text is sometimes found in pieces ("RAD", "091a/167", "EN"). Pieces that sit on one
 * line, close together and about the same height, are joined into one box.
 */
export function joinBoxes(boxes: Box[], maxGap = 1.5): Box[] {
	const list = [...boxes];
	let joined = true;
	while (joined) {
		joined = false;
		search: for (let i = 0; i < list.length; i++) {
			for (let j = 0; j < list.length; j++) {
				if (i === j) continue;
				const a = list[i];
				const b = list[j];
				if (a.w < b.w) continue; // the longer piece sets the direction
				const h = Math.max(a.h, b.h);
				if (Math.min(a.h, b.h) < h * 0.45) continue;
				const ux = Math.cos(a.angle);
				const uy = Math.sin(a.angle);
				const u = (b.cx - a.cx) * ux + (b.cy - a.cy) * uy;
				const v = -(b.cx - a.cx) * uy + (b.cy - a.cy) * ux;
				if (Math.abs(v) > h * 0.5) continue;
				// How far b reaches along a's direction (b may be slightly turned against a).
				const turn = Math.abs(Math.sin(b.angle - a.angle));
				if (turn > 0.35 && b.w > b.h * 2) continue;
				const half = b.w / 2;
				const gap = Math.abs(u) - a.w / 2 - half;
				if (gap > h * maxGap) continue;
				const lo = Math.min(-a.w / 2, u - half);
				const hi = Math.max(a.w / 2, u + half);
				const mid = (lo + hi) / 2;
				// Tilt the joined box so it runs through both pieces.
				const angle = Math.abs(u) > h ? a.angle + Math.atan2(v, Math.abs(u)) * Math.sign(u) : a.angle;
				list[i] = {
					cx: a.cx + mid * ux - (v / 2) * (Math.abs(u) > h ? 0 : 1) * uy,
					cy: a.cy + mid * uy,
					w: hi - lo,
					h: h + Math.abs(v),
					angle,
					score: Math.min(a.score, b.score)
				};
				list.splice(j, 1);
				joined = true;
				break search;
			}
		}
	}
	return list;
}

// --- step 3: cut out a line ---------------------------------------------------------------------

/**
 * Cuts one box out of the picture, straightened and 48 px high, laid out for the recognition
 * model. `flip` reads the box the other way up.
 */
export function lineInput(pic: Picture, box: Box, flip = false): { data: Float32Array; width: number } {
	const textWidth = Math.max(8, Math.min(MAX_LINE_WIDTH, Math.round((LINE_HEIGHT * box.w) / box.h)));
	const width = Math.ceil(textWidth / WIDTH_STEP) * WIDTH_STEP;
	const plane = width * LINE_HEIGHT;
	const data = new Float32Array(3 * plane); // zero = the model's "nothing here" grey
	const sign = flip ? -1 : 1;
	const ux = Math.cos(box.angle) * sign;
	const uy = Math.sin(box.angle) * sign;
	const stepU = box.w / textWidth;
	const stepV = box.h / LINE_HEIGHT;
	const { width: W, height: H, data: src } = pic;

	for (let j = 0; j < LINE_HEIGHT; j++) {
		const v = (j + 0.5 - LINE_HEIGHT / 2) * stepV;
		for (let i = 0; i < textWidth; i++) {
			const u = (i + 0.5 - textWidth / 2) * stepU;
			const x = Math.min(W - 1, Math.max(0, box.cx + u * ux - v * uy - 0.5));
			const y = Math.min(H - 1, Math.max(0, box.cy + u * uy + v * ux - 0.5));
			const x0 = Math.floor(x);
			const y0 = Math.floor(y);
			const x1 = Math.min(W - 1, x0 + 1);
			const y1 = Math.min(H - 1, y0 + 1);
			const fx = x - x0;
			const fy = y - y0;
			const a = (y0 * W + x0) * 4;
			const b = (y0 * W + x1) * 4;
			const c = (y1 * W + x0) * 4;
			const d = (y1 * W + x1) * 4;
			const o = j * width + i;
			for (let ch = 0; ch < 3; ch++) {
				const top = src[a + ch] + (src[b + ch] - src[a + ch]) * fx;
				const bottom = src[c + ch] + (src[d + ch] - src[c + ch]) * fx;
				// Blue-green-red order, values from -1 to 1.
				data[(2 - ch) * plane + o] = (top + (bottom - top) * fy) / 127.5 - 1;
			}
		}
	}
	return { data, width };
}

// --- step 4: characters -------------------------------------------------------------------------

/** Turns the dictionary file into the model's character table. Entry 0 means "no character". */
export function parseDictionary(fileText: string): string[] {
	const chars = fileText.split('\n');
	if (chars[chars.length - 1] === '') chars.pop();
	return ['', ...chars, ' '];
}

/**
 * The recognition model answers with one guess per narrow slice of the line. Repeated guesses
 * and "no character" slices are dropped; what remains is the text.
 */
export function decodeLine(output: ModelOutput, chars: string[]): { text: string; confidence: number } {
	const steps = output.dims[1];
	const classes = output.dims[2];
	let text = '';
	let sum = 0;
	let n = 0;
	let last = 0;
	for (let t = 0; t < steps; t++) {
		const base = t * classes;
		let best = 0;
		let bestValue = output.data[base];
		for (let c = 1; c < classes; c++) {
			const value = output.data[base + c];
			if (value > bestValue) {
				bestValue = value;
				best = c;
			}
		}
		if (best !== 0 && best !== last) {
			text += chars[best] ?? '';
			sum += bestValue;
			n++;
		}
		last = best;
	}
	return { text, confidence: n ? sum / n : 0 };
}

// --- all steps ----------------------------------------------------------------------------------

export interface Models {
	detection: Model;
	recognition: Model;
	chars: string[];
}

/**
 * A part of the picture, enlarged. Faint small text that the detection model misses is often
 * found once it is bigger.
 */
export function zoomCrop(pic: Picture, left: number, top: number, width: number, height: number, scale: number): Picture {
	const x0 = Math.max(0, Math.floor(left));
	const y0 = Math.max(0, Math.floor(top));
	const w = Math.min(pic.width, Math.ceil(left + width)) - x0;
	const h = Math.min(pic.height, Math.ceil(top + height)) - y0;
	if (w <= 1 || h <= 1) return { data: new Uint8Array(4), width: 1, height: 1 };
	const W = Math.max(1, Math.round(w * scale));
	const H = Math.max(1, Math.round(h * scale));
	const out = new Uint8Array(W * H * 4);
	const src = pic.data;
	for (let y = 0; y < H; y++) {
		const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
		const ya = Math.floor(sy);
		const yb = Math.min(h - 1, ya + 1);
		const fy = sy - ya;
		for (let x = 0; x < W; x++) {
			const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
			const xa = Math.floor(sx);
			const xb = Math.min(w - 1, xa + 1);
			const fx = sx - xa;
			const a = ((y0 + ya) * pic.width + x0 + xa) * 4;
			const b = ((y0 + ya) * pic.width + x0 + xb) * 4;
			const c = ((y0 + yb) * pic.width + x0 + xa) * 4;
			const d = ((y0 + yb) * pic.width + x0 + xb) * 4;
			const o = (y * W + x) * 4;
			for (let ch = 0; ch < 3; ch++) {
				const t = src[a + ch] + (src[b + ch] - src[a + ch]) * fx;
				const u = src[c + ch] + (src[d + ch] - src[c + ch]) * fx;
				out[o + ch] = t + (u - t) * fy;
			}
			out[o + 3] = 255;
		}
	}
	return { data: out, width: W, height: H };
}

/** The picture turned a quarter clockwise. */
export function quarterTurn(pic: Picture): Picture {
	const { width: W, height: H } = pic;
	const src = new Uint32Array(pic.data.buffer, pic.data.byteOffset, W * H);
	const out = new Uint32Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) out[x * H + (H - 1 - y)] = src[y * W + x];
	}
	return { data: new Uint8Array(out.buffer), width: H, height: W };
}

export async function readPicture(pic: Picture, models: Models, options: ReadOptions = {}): Promise<ReadResult> {
	const { accept, retryTurned = true } = options;
	const first = await readOnce(pic, models, options);
	if (!accept || !retryTurned || first.lines.some((l) => accept(l.text))) return first;
	const second = await readOnce(quarterTurn(pic), models, options);
	const detMs = first.detMs + second.detMs;
	const recMs = first.recMs + second.recMs;
	if (second.lines.some((l) => accept(l.text))) return { ...second, turned: true, detMs, recMs };
	return { ...first, detMs, recMs };
}

async function readOnce(pic: Picture, models: Models, options: ReadOptions): Promise<ReadResult> {
	const { detSide = 1440, accept, rank } = options;
	const now = () => performance.now();

	const t0 = now();
	const size = detSize(pic.width, pic.height, detSide);
	const map = await models.detection(detInput(pic, size.width, size.height), [1, 3, size.height, size.width]);
	const sx = pic.width / size.width;
	const sy = pic.height / size.height;
	const found = findBoxes(map.data, size.width, size.height).map((b) => {
			// Map pixels are not square when the picture's sides were rounded differently.
			const ux = Math.cos(b.angle) * sx;
			const uy = Math.sin(b.angle) * sy;
			const along = Math.hypot(ux, uy);
			const across = Math.hypot(Math.sin(b.angle) * sx, Math.cos(b.angle) * sy);
			return { ...b, cx: b.cx * sx, cy: b.cy * sy, w: b.w * along, h: b.h * across, angle: Math.atan2(uy, ux) };
		});
	const boxes = joinBoxes(found)
		// Single characters and specks cannot be a code and cost as much to read as a full line.
		.filter((b) => b.w >= b.h * 1.5);
	const t1 = now();

	// A slanted rectangle does not say which way up its text is, so with `accept` every box is a
	// candidate twice: as found, and the other way up. Candidates are read in `rank` order (without
	// `rank`: all as found first) until one is accepted.
	const candidates = boxes.flatMap((box) => (accept ? [false, true] : [false]).map((flip) => ({ box, flip })));
	const key = (c: { box: Box; flip: boolean }) =>
		rank ? rank(c.box, c.flip, pic.width, pic.height) : c.flip ? 1 : 0;
	candidates.sort((a, b) => key(a) - key(b));

	const read: Line[] = [];
	let flipped = false;
	let accepted = false;
	for (const { box, flip } of candidates) {
		const input = lineInput(pic, box, flip);
		const out = await models.recognition(input.data, [1, 3, LINE_HEIGHT, input.width]);
		const { text, confidence } = decodeLine(out, models.chars);
		if (text) read.push({ text, confidence, box, flip });
		// The code is all that is wanted; the remaining lines are not worth the time.
		if (accept?.(text)) {
			flipped = flip;
			accepted = true;
			break;
		}
	}
	// With a winner, report the lines read the same way up as it; the others are mostly nonsense.
	// Without one, report everything: the caller may want to look for other clues.
	const lines = accepted ? read.filter((l) => l.flip === flipped) : read;
	return { lines, flipped, turned: false, detMs: Math.round(t1 - t0), recMs: Math.round(now() - t1), boxes: boxes.length };
}
