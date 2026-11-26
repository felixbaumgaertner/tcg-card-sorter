<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import { cardById } from '../../lib/cards';
	import { parsePrintedCode, type PrintedCode } from '../../lib/code';
	import { parseDictionary, readPicture, type Line, type Model, type Models } from '../../lib/reader/reader';

	type Engine = 'wasm' | 'webgpu';

	interface Result {
		ms: number;
		/** Time to find the text and time to read it, in ms. */
		detMs: number;
		recMs: number;
		boxes: number;
		flipped: boolean;
		turned: boolean;
		engine: Engine;
		detSide: number;
		width: number;
		height: number;
		lines: Line[];
		code: PrintedCode | null;
		cardName: string | null;
	}

	let models: Models | null = null;
	let modelsEngine: Engine | null = null;
	// On a Pixel 7a the processor (WASM) was about ten times slower than the graphics chip
	// (WebGPU), so WebGPU is the default wherever the browser has it.
	let engine = $state<Engine>('gpu' in navigator ? 'webgpu' : 'wasm');
	// Longest side of the shrunk picture in which text is searched. At 1440 px all test photos
	// were read in every direction; at 1280 px one tilted full-art card was missed.
	let detSide = $state(1440);
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

	// Tally: every card read from the live camera, once. A new entry is added when the code
	// differs from the entry before it, so holding the phone over one card adds it only once.
	interface Entry {
		code: string;
		name: string;
		ms: number;
	}
	const TALLY_KEY = 'ocr-test-tally';
	let tally = $state<Entry[]>(JSON.parse(localStorage.getItem(TALLY_KEY) ?? '[]'));
	let copied = $state(false);
	const tallyText = $derived(tally.map((e, i) => `${i + 1}\t${e.code}\t${e.name}\t${e.ms} ms`).join('\n'));

	function addToTally(r: Result) {
		if (!r.code) return;
		const code = `${r.code.set} ${r.code.number}${r.code.total ? `/${r.code.total}` : ''}`;
		if (tally.at(-1)?.code === code) return;
		tally = [...tally, { code, name: r.cardName ?? 'not in the card list', ms: r.ms }];
		localStorage.setItem(TALLY_KEY, JSON.stringify(tally));
		navigator.vibrate?.(80);
	}

	function removeLast() {
		tally = tally.slice(0, -1);
		localStorage.setItem(TALLY_KEY, JSON.stringify(tally));
	}

	function clearTally() {
		tally = [];
		localStorage.removeItem(TALLY_KEY);
	}

	async function copyTally() {
		await navigator.clipboard.writeText(tallyText);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function getModels(): Promise<Models> {
		if (models && modelsEngine === engine) return models;
		models = null;
		status = 'Loading the text reader (about 16 MB, first time only)…';
		const t0 = performance.now();
		// Folder that holds the model files (filled by scripts/copy-ocr-assets.mjs).
		const dir = new URL('.', new URL(asset('ocr/ppocr_keys_v1.txt'), location.href)).href;
		const ort = await import('onnxruntime-web');
		const load = async (file: string): Promise<Model> => {
			const session = await ort.InferenceSession.create(dir + file, { executionProviders: [engine] });
			return async (input, dims) => {
				const tensor = new ort.Tensor('float32', input, dims);
				const out = await session.run({ [session.inputNames[0]]: tensor });
				tensor.dispose();
				const result = out[session.outputNames[0]];
				const data = (await result.getData()) as Float32Array;
				const answer = { data, dims: result.dims };
				result.dispose();
				return answer;
			};
		};
		const dictionary = await (await fetch(`${dir}ppocr_keys_v1.txt`)).text();
		models = {
			detection: await load('ch_PP-OCRv4_det_infer.onnx'),
			recognition: await load('ch_PP-OCRv4_rec_infer.onnx'),
			chars: parseDictionary(dictionary)
		};
		modelsEngine = engine;
		loadMs = Math.round(performance.now() - t0);
		return models;
	}

	const scratch = document.createElement('canvas');
	const accept = (text: string) => parsePrintedCode(text) !== null;

	/** Reads one picture (a photo or a still from the video) and returns what was found. */
	async function read(m: Models, source: ImageBitmap | HTMLVideoElement, label: string): Promise<Result> {
		status = `${label}…`;
		// Let the browser paint the status line before the reader blocks the page.
		await new Promise((done) => setTimeout(done, 30));
		const t0 = performance.now();
		const width = 'videoWidth' in source ? source.videoWidth : source.width;
		const height = 'videoHeight' in source ? source.videoHeight : source.height;
		scratch.width = width;
		scratch.height = height;
		const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
		ctx.drawImage(source, 0, 0);
		const pixels = ctx.getImageData(0, 0, width, height);
		const found = await readPicture(pixels, m, { detSide, accept });
		const code = found.lines.map((l) => parsePrintedCode(l.text)).find((c) => c !== null) ?? null;
		return {
			ms: Math.round(performance.now() - t0),
			detMs: found.detMs,
			recMs: found.recMs,
			boxes: found.boxes,
			flipped: found.flipped,
			turned: found.turned,
			engine,
			detSide,
			width,
			height,
			lines: found.lines,
			code,
			cardName: code ? (cardById(code.id)?.name ?? null) : null
		};
	}

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		if (!files.length) return;
		busy = true;
		error = null;
		try {
			const m = await getModels();
			for (const [i, file] of files.entries()) {
				const picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
				try {
					const label = `Reading photo ${i + 1} of ${files.length}`;
					results = [await read(m, picture, label), ...results];
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
			const m = await getModels();
			let n = 0;
			while (live) {
				const result = await read(m, video!, `Reading picture ${++n}`);
				if (live) {
					results = [result, ...results].slice(0, 5);
					addToTally(result);
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
		The page keeps reading the printed code by itself and adds every new card to a tally. Nothing
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
			Search size
			<select bind:value={detSide} disabled={busy}>
				<option value={1440}>1440 px</option>
				<option value={1280}>1280 px</option>
				<option value={1120}>1120 px</option>
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

	{#if tally.length}
		<section>
			<h2>Tally: {tally.length} {tally.length === 1 ? 'card' : 'cards'}</h2>
			<p class="meta">
				The phone buzzes when a new card is added. Swap the card after the buzz. The newest is on top.
			</p>
			<ol reversed>
				{#each tally.toReversed() as entry, i (tally.length - i)}
					<li><strong>{entry.code}</strong> {entry.name} <span class="meta">{entry.ms} ms</span></li>
				{/each}
			</ol>
			<div class="row">
				<button onclick={copyTally}>{copied ? 'Copied' : 'Copy list'}</button>
				<button onclick={removeLast}>Remove newest</button>
				<button onclick={clearTally}>Clear</button>
			</div>
		</section>
	{/if}

	{#if results.length}<h2 class="sub">Latest reads</h2>{/if}
	{#each results as r, i (results.length - i)}
		<section>
			<h2>
				{#if r.code}{r.code.set} {r.code.number}{r.code.total ? `/${r.code.total}` : ''}{:else}No code found{/if}
			</h2>
			<p>
				{#if r.cardName}{r.cardName}{:else if r.code}Not in the card list{/if}
			</p>
			<p class="meta">
				{r.ms} ms (find {r.detMs} + read {r.recMs}) · {r.width}×{r.height} px · {r.boxes} lines ·
				{r.engine} · search {r.detSide} px{r.flipped ? ' · upside down' : ''}{r.turned
					? ' · second search, turned'
					: ''}
			</p>
			<details>
				<summary>All text found ({r.lines.length} lines)</summary>
				<ul>
					{#each r.lines as line, j (j)}
						<li>{line.text} <span class="meta">({line.confidence.toFixed(2)})</span></li>
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
	.sub {
		margin-top: 2rem;
		font-size: 1rem;
		opacity: 0.7;
	}
	ol {
		padding-left: 2rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.row button {
		font: inherit;
		padding: 0.5rem 0.8rem;
	}
	section p {
		margin: 0.2rem 0;
	}
	ul {
		padding-left: 1.2rem;
		overflow-wrap: anywhere;
	}
</style>
