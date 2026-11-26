// Copies the text-reader model files into static/ocr/ so the app can load them from its own address.
// Runs before `dev` and `build`. The copies are not committed (see .gitignore).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(app, 'static', 'ocr');
mkdirSync(out, { recursive: true });

const models = join(app, 'node_modules', '@gutenye', 'ocr-models', 'assets');
for (const f of ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ppocr_keys_v1.txt']) {
	cpSync(join(models, f), join(out, f));
}

console.log(`copied text-reader files to ${out}`);
