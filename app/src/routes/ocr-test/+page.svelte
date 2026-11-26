<script lang="ts">
	import { onDestroy } from 'svelte';
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
		engine: Engine;
		/** Time of each try in ms, in the order tried. */
		tries: number[];
		width: number;
		height: number;
		lines: Line[];
		code: PrintedCode | null;
		cardName: string | null;
	}

	type Engine = 'wasm' | 'webgpu';
	let reader: Reader | null = null;
	let readerEngine: Engine | null = null;
	// On a Pixel 7a one try took 50 s with WASM and 5 s with WebGPU (1280 px), so WebGPU is the
	// default wherever the browser has it.
	let engine = $state<Engine>('gpu' in navigator ? 'webgpu' : 'wasm');
	let maxSide = $state(2016);
	let status = $state('Not loaded yet. Start the camera or pick a photo.');
	let loadMs = $state<number | null>(null);
	let busy = $state(false);
	let results = $state<Result[]>([]);
	let error = $state<string | null>(null);

	// Live camera: the page keeps taking pictures from the video by itself, one after the other.
	let video = $state<HTMLVideoElement | null>(null);
	let stream: MediaStream | null = null;
	let live = $state(false);
	let hasLight = $state(false);
	let light = $state(true);
	let cameraInfo = $state('');

	async function getReader(): Promise<Reader> {
		if (reader && readerEngine === engine) return reader;
		reader = null;
		status = 'Loading the text reader (about 16 MB, first time only)…';
		const t0 = performance.now();
		// Folder that holds the reader's files (filled by scripts/copy-ocr-assets.mjs).
		const dir = new URL('.', new URL(asset('ocr/ppocr_keys_v1.txt'), location.href)).href;
		const { default: Ocr } = await import('@gutenye/ocr-browser');
		reader = (await Ocr.create({
			onnxOptions: { executionProviders: [engine] },
			models: {
				detectionPath: `${dir}ch_PP-OCRv4_det_infer.onnx`,
				recognitionPath: `${dir}ch_PP-OCRv4_rec_infer.onnx`,
				dictionaryPath: `${dir}ppocr_keys_v1.txt`
			}
		})) as Reader;
		readerEngine = engine;
		loadMs = Math.round(performance.now() - t0);
		return reader;
	}

	/**
	 * Draws the photo onto a canvas, shrunk to `maxSide` and turned by `turns` quarter turns, and
	 * returns it as a temporary image address.
	 */
	async function prepare(bitmap: ImageBitmap, turns: number) {
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		const w = Math.round(bitmap.width * scale);
		const h = Math.round(bitmap.height * scale);
		const sideways = turns % 2 === 1;
		const canvas = document.createElement('canvas');
		canvas.width = sideways ? h : w;
		canvas.height = sideways ? w : h;
		const ctx = canvas.getContext('2d')!;
		ctx.imageSmoothingQuality = 'high';
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((turns * Math.PI) / 2);
		ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
		const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
		if (!blob) throw new Error('Could not prepare the photo.');
		return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
	}

	/** A card can lie any way round, so the photo is read as taken first and then turned. */
	async function read(r: Reader, picture: ImageBitmap, label: string): Promise<Result> {
		const t0 = performance.now();
		let first: Omit<Result, 'ms' | 'tries'> | null = null;
		const tries: number[] = [];
		const order = [0, 1, 3, 2];
		for (const [n, turns] of order.entries()) {
			status = `${label}, try ${n + 1} of ${order.length}…`;
			const { url, width, height } = await prepare(picture, turns);
			// Let the browser paint the status line before the reader blocks the page.
			await new Promise((done) => setTimeout(done, 30));
			const tTry = performance.now();
			let out;
			try {
				out = await r.detect(url);
			} finally {
				URL.revokeObjectURL(url);
			}
			tries.push(Math.round(performance.now() - tTry));
			const lines = Array.isArray(out) ? out : out.texts;
			const code = lines.map((l) => parsePrintedCode(l.text)).find((c) => c !== null) ?? null;
			const cardName = code ? (cardById(code.id)?.name ?? null) : null;
			const attempt = { turns, width, height, lines, code, cardName, engine };
			if (code) return { ...attempt, tries, ms: Math.round(performance.now() - t0) };
			first ??= attempt;
		}
		return { ...first!, tries, ms: Math.round(performance.now() - t0) };
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
				const picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
				try {
					const label = `Reading photo ${i + 1} of ${files.length}`;
					results = [await read(r, picture, label), ...results];
				} finally {
					picture.close();
				}
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

	async function setLight(on: boolean) {
		const track = stream?.getVideoTracks()[0];
		if (!track || !hasLight) return;
		// `torch` is not in TypeScript's built-in types yet.
		await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
	}

	function stopCamera() {
		live = false;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (video) video.srcObject = null;
	}
	onDestroy(stopCamera);

	async function startCamera() {
		error = null;
		busy = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }
			});
			const track = stream.getVideoTracks()[0];
			hasLight = 'torch' in track.getCapabilities();
			video!.srcObject = stream;
			await video!.play();
			await setLight(light);
			cameraInfo = `${video!.videoWidth}×${video!.videoHeight} px`;
			live = true;
			const r = await getReader();
			let n = 0;
			while (live) {
				const picture = await createImageBitmap(video!);
				try {
					const result = await read(r, picture, `Reading picture ${++n}`);
					if (live) results = [result, ...results].slice(0, 30);
				} finally {
					picture.close();
				}
				// Short break so the page stays usable between pictures.
				await new Promise((done) => setTimeout(done, 200));
			}
			status = 'Camera stopped.';
		} catch (e) {
			error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
			status = 'Failed.';
		} finally {
			stopCamera();
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Reader test · Card Sorter</title>
</svelte:head>

<main>
	<h1>Reader test</h1>
	<p>
		Start the camera and hold the phone about 11 cm above one card. The card can lie any way round.
		The page keeps reading the printed code by itself and shows how long each read took. Nothing
		leaves this device.
	</p>

	<div class="options">
		<label>
			Engine
			<select bind:value={engine} disabled={busy}>
				<option value="webgpu">Graphics chip (WebGPU)</option>
				<option value="wasm">Processor (WASM)</option>
			</select>
		</label>
		<label>
			Photo size
			<select bind:value={maxSide} disabled={busy}>
				<option value={2016}>2016 px</option>
				<option value={1600}>1600 px</option>
				<option value={1280}>1280 px</option>
				<option value={960}>960 px</option>
			</select>
		</label>
	</div>

	{#if live}
		<button class="pick" onclick={stopCamera}>Stop camera</button>
	{:else}
		<button class="pick" class:busy onclick={startCamera} disabled={busy}>
			{busy ? 'Working…' : 'Start camera'}
		</button>
	{/if}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted class:hidden={!live}></video>
	{#if live}
		<p class="meta">
			Camera {cameraInfo}
			{#if hasLight}
				· <label><input type="checkbox" bind:checked={light} onchange={() => setLight(light)} /> Light</label>
			{:else}
				· this camera has no light the page can switch
			{/if}
		</p>
	{/if}
	<label class="pick secondary" class:busy>
		Pick photos from the gallery
		<input type="file" accept="image/*" multiple onchange={onPick} disabled={busy} />
	</label>

	<p class="status" role="status">{status}</p>
	<p class="meta">
		Device: {navigator.hardwareConcurrency} cores · threads {crossOriginIsolated ? 'on' : 'off'} ·
		WebGPU {'gpu' in navigator ? 'yes' : 'no'}
	</p>
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
				· tries: {r.tries.join(' + ')} ms · {r.engine}
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
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 1rem 0;
	}
	.options select {
		display: block;
		font: inherit;
		padding: 0.3rem;
	}
	video {
		display: block;
		width: 100%;
		margin-top: 0.5rem;
		border-radius: 0.5rem;
		background: #000;
	}
	video.hidden {
		display: none;
	}
	.pick {
		display: block;
		width: 100%;
		box-sizing: border-box;
		border: none;
		font: inherit;
		padding: 1rem;
		border-radius: 0.5rem;
		background: #1f6feb;
		color: #fff;
		font-weight: 600;
		text-align: center;
		cursor: pointer;
	}
	.pick.secondary {
		margin-top: 0.5rem;
		background: none;
		color: inherit;
		border: 1px solid currentColor;
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
