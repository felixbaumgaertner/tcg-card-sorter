<script lang="ts">
	import { asset } from '$app/paths';
	import { cardById } from '../../lib/cards';
	import { parsePrintedCode, type PrintedCode } from '../../lib/code';

	interface Line {
		text: string;
		mean: number;
	}
	interface Reader {
		detect(url: string): Promise<{ texts: Line[] } | Line[]>;
	}
	interface Result {
		/** Quarter turns needed before a code was found (0 = upright). */
		turns: number;
		ms: number;
		width: number;
		height: number;
		lines: Line[];
		code: PrintedCode | null;
		cardName: string | null;
	}

	let reader: Reader | null = null;
	let status = $state('Not loaded yet. Pick a photo to start.');
	let loadMs = $state<number | null>(null);
	let lowerHalf = $state(true);
	let busy = $state(false);
	let results = $state<Result[]>([]);
	let error = $state<string | null>(null);

	async function getReader(): Promise<Reader> {
		if (reader) return reader;
		status = 'Loading the text reader (about 16 MB, first time only)…';
		const t0 = performance.now();
		// Folder that holds the reader's files (filled by scripts/copy-ocr-assets.mjs).
		const dir = new URL('.', new URL(asset('ocr/ppocr_keys_v1.txt'), location.href)).href;
		const { default: Ocr } = await import('@gutenye/ocr-browser');
		reader = (await Ocr.create({
			models: {
				detectionPath: `${dir}ch_PP-OCRv4_det_infer.onnx`,
				recognitionPath: `${dir}ch_PP-OCRv4_rec_infer.onnx`,
				dictionaryPath: `${dir}ppocr_keys_v1.txt`
			}
		})) as Reader;
		loadMs = Math.round(performance.now() - t0);
		return reader;
	}

	/**
	 * Draws the photo onto a canvas, turned by `turns` quarter turns, and returns it as an image
	 * address. Upright photos can be cut to their lower half; turned ones are always read whole.
	 */
	async function prepare(file: File, turns: number) {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const sideways = turns % 2 === 1;
		const width = sideways ? bitmap.height : bitmap.width;
		const fullHeight = sideways ? bitmap.width : bitmap.height;
		const top = turns === 0 && lowerHalf ? Math.round(fullHeight / 2) : 0;
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = fullHeight - top;
		const ctx = canvas.getContext('2d')!;
		ctx.translate(width / 2, fullHeight / 2 - top);
		ctx.rotate((turns * Math.PI) / 2);
		ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
		bitmap.close();
		return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
	}

	/** Reads upright first. Battlefields are printed sideways, so other directions are tried after. */
	async function read(r: Reader, file: File): Promise<Result> {
		const t0 = performance.now();
		let first: Omit<Result, 'ms'> | null = null;
		for (const turns of [0, 1, 3, 2]) {
			const { url, width, height } = await prepare(file, turns);
			const out = await r.detect(url);
			const lines = Array.isArray(out) ? out : out.texts;
			const code = lines.map((l) => parsePrintedCode(l.text)).find((c) => c !== null) ?? null;
			const cardName = code ? (cardById(code.id)?.name ?? null) : null;
			const attempt = { turns, width, height, lines, code, cardName };
			if (code) return { ...attempt, ms: Math.round(performance.now() - t0) };
			first ??= attempt;
		}
		return { ...first!, ms: Math.round(performance.now() - t0) };
	}

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		if (!files.length) return;
		busy = true;
		error = null;
		try {
			const r = await getReader();
			for (const [i, file] of files.entries()) {
				status = `Reading photo ${i + 1} of ${files.length}…`;
				results = [await read(r, file), ...results];
			}
			status = 'Done. Pick another photo to read more.';
		} catch (e) {
			error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
			status = 'Failed.';
		} finally {
			busy = false;
			input.value = '';
		}
	}
</script>

<svelte:head>
	<title>Reader test · Card Sorter</title>
</svelte:head>

<main>
	<h1>Reader test</h1>
	<p>
		Take a photo of one card (flash on, about 11 cm away). The page reads the code in the bottom
		left corner and shows how long that took. Nothing leaves this device.
	</p>

	<label class="check">
		<input type="checkbox" bind:checked={lowerHalf} disabled={busy} />
		Only read the lower half of the photo (faster)
	</label>

	<label class="pick" class:busy>
		{busy ? 'Working…' : 'Take or pick photos'}
		<input type="file" accept="image/*" multiple onchange={onPick} disabled={busy} />
	</label>

	<p class="status" role="status">{status}</p>
	{#if loadMs !== null}<p class="meta">Reader loaded in {loadMs} ms.</p>{/if}
	{#if error}<p class="error">{error}</p>{/if}

	{#each results as r, i (results.length - i)}
		<section>
			<h2>
				{#if r.code}{r.code.set} {r.code.number}{r.code.total ? `/${r.code.total}` : ''}{:else}No code found{/if}
			</h2>
			<p>
				{#if r.cardName}{r.cardName}{:else if r.code}Not in the card list{/if}
			</p>
			<p class="meta">
				{r.ms} ms · {r.width}×{r.height} px{r.turns ? ` · found after turning the photo` : ''}
			</p>
			<details>
				<summary>All text found ({r.lines.length} lines)</summary>
				<ul>
					{#each r.lines as line, j (j)}
						<li>{line.text} <span class="meta">({line.mean.toFixed(2)})</span></li>
					{/each}
				</ul>
			</details>
		</section>
	{/each}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
	}
	.check {
		display: block;
		margin: 1rem 0;
	}
	.pick {
		display: block;
		padding: 1rem;
		border-radius: 0.5rem;
		background: #1f6feb;
		color: #fff;
		font-weight: 600;
		text-align: center;
		cursor: pointer;
	}
	.pick.busy {
		opacity: 0.6;
		cursor: progress;
	}
	.pick input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.pick:focus-within {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
	.meta {
		opacity: 0.7;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.error {
		color: #cf222e;
		overflow-wrap: anywhere;
	}
	section {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	}
	h2 {
		margin: 0;
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
	}
	section p {
		margin: 0.2rem 0;
	}
	ul {
		padding-left: 1.2rem;
		overflow-wrap: anywhere;
	}
</style>
