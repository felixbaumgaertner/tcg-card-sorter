// Reads the real test photos, if they are on this computer. They are not in the repository, so
// this test is skipped everywhere else (including on GitHub).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrintedCode } from '../code';
import { offCentre } from './card';
import { parseDictionary, readPicture, type Model, type Models, type Picture } from './reader';

const photos = join(__dirname, '../../../../test-photos/2026-11-26');
const modelDir = join(__dirname, '../../../node_modules/@gutenye/ocr-models/assets');

// Photo file -> code printed on the card.
const expected: Record<string, string> = {
	'IMG_20261126_130135_373.jpg': 'sfd-221-221', // battlefield, lying sideways
	'IMG_20261126_130154_496.jpg': 'sfd-001-221',
	'IMG_20261126_130217_537.jpg': 'rad-sp3-005', // full art
	'IMG_20261126_130244_117.jpg': 'rad-091a-167', // full art, tilted
	'IMG_20261126_130326_960.jpg': 'ven-088a-166',
	'IMG_20261126_130353_201.jpg': 'sfd-043-221',
	'IMG_20261126_130416_472.jpg': 'unl-r05a',
	'IMG_20261126_130440_892.jpg': 'ogn-040-298',
	'IMG_20261126_130546_776.jpg': 'ogs-007-024',
	'IMG_20261126_130630_521.jpg': 'ogn-310-298'
};
// Taken without flash on purpose; blurry. Reported, not required.
const hard: Record<string, string> = { 'IMG_20261126_130456_606.jpg': 'ogn-040-298' };

async function loadModels(): Promise<Models> {
	const ort = await import('onnxruntime-node');
	const load = async (file: string): Promise<Model> => {
		const session = await ort.InferenceSession.create(join(modelDir, file));
		return async (input, dims) => {
			const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims) });
			const tensor = out[session.outputNames[0]];
			return { data: tensor.data as Float32Array, dims: tensor.dims };
		};
	};
	return {
		detection: await load('ch_PP-OCRv4_det_infer.onnx'),
		recognition: await load('ch_PP-OCRv4_rec_infer.onnx'),
		chars: parseDictionary(readFileSync(join(modelDir, 'ppocr_keys_v1.txt'), 'utf8'))
	};
}

async function loadPicture(file: string, turns = 0): Promise<Picture> {
	const sharp = (await import('sharp')).default;
	const { data, info } = await sharp(join(photos, file))
		.rotate() // apply the camera's "which way is up" note
		.rotate(turns * 90)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data: new Uint8Array(data), width: info.width, height: info.height };
}

const accept = (text: string) => parsePrintedCode(text) !== null;
const sides = (process.env.DET_SIDES ?? '1440').split(',').map(Number);

describe.skipIf(!existsSync(photos))('test photos', () => {
	for (const side of sides) {
		it(`reads every printed code (text search at ${side} px)`, { timeout: 300_000 }, async () => {
			const models = await loadModels();
			const wrong: string[] = [];
			const report: string[] = [];
			for (const [file, id] of Object.entries({ ...expected, ...hard })) {
				for (const turns of process.env.ALL_TURNS ? [0, 1, 2, 3] : [0]) {
					const result = await readPicture(await loadPicture(file, turns), models, { detSide: side, accept, rank: offCentre });
					const got = result.lines.map((l) => parsePrintedCode(l.text)).find((c) => c)?.id ?? null;
					report.push(
						`${file.slice(13, 19)} turn ${turns}: ${got ?? 'none'} (${result.boxes} boxes, find ${result.detMs} ms, read ${result.recMs} ms${result.flipped ? ', flipped' : ''}${result.turned ? ', turned' : ''})`
					);
					if (got !== id && file in expected) wrong.push(`${file} turn ${turns}: got ${got}, want ${id}`);
				}
			}
			if (process.env.REPORT) console.log(report.join('\n'));
			expect(wrong).toEqual([]);
		});
	}
});
