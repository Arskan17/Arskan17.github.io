// EdgeParse WASM demo. The parser (~2.8 MB) is fetched lazily on first use; the OCR
// engine (~16.5 MB, see ocr-worker.js) only after the visitor explicitly asks for it.
const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/edgeparse-wasm@0.2.5/edgeparse_wasm.js';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const EXT = { markdown: 'md', json: 'json', html: 'html', text: 'txt' };
const IMAGE_RE = /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i;
const MAX_OCR_PAGES = 10;

const $ = (id) => document.getElementById(id);
const status = $('ep-status');
const output = $('ep-output');
const meta = $('ep-meta');
const drop = $('ep-drop');
const fileInput = $('ep-file');
const loaded = $('ep-loaded');
const card = $('edgeparse');
const gate = $('ep-gate');
const gateText = $('ep-gate-text');
const gateBtn = $('ep-gate-btn');
const progress = $('ep-progress');

let engine = null;
let currentFile = null;
let kind = null; // 'pdf' | 'image'
let ocrPages = null; // OCR results for currentFile, reformatted on tab change
let result = '';
let runToken = 0;
let ocrBusy = false; // format tabs must not cancel a running OCR pass

function setStatus(text, kind = '') {
	status.textContent = text;
	status.className = `demo__status mono ${kind}`;
}

async function loadEngine() {
	if (engine) return engine;
	setStatus('engine: loading wasm…');
	const mod = await import(ENGINE_URL);
	await mod.default();
	try { mod.init(); } catch (e) {}
	engine = mod;
	setStatus(`engine: v${mod.version()} ready`, 'ok');
	return engine;
}

// ---- OCR worker ---------------------------------------------------------------

let worker = null;
let ocrReady = false;
let ocrInit = null;
let jobId = 0;
const jobs = new Map();

function startOcr() {
	if (ocrInit) return ocrInit;
	worker ??= new Worker(new URL('./ocr-worker.js', import.meta.url), { type: 'module' });
	ocrInit = new Promise((resolve, reject) => {
		worker.onmessage = ({ data }) => {
			if (data.type === 'progress') {
				progress.value = data.pct;
				setStatus(`ocr: loading ${data.pct}%`);
			} else if (data.type === 'ready') {
				ocrReady = true;
				setStatus('ocr: ready', 'ok');
				resolve();
			} else if (data.type === 'result' || data.type === 'error') {
				const job = jobs.get(data.id);
				if (job) {
					jobs.delete(data.id);
					data.type === 'result' ? job.resolve(data.result) : job.reject(new Error(data.message));
				} else if (data.type === 'error') {
					ocrInit = null;
					reject(new Error(data.message));
				}
			}
		};
		worker.postMessage({ type: 'init' });
	});
	return ocrInit;
}

function ocrImage(bytes) {
	const id = ++jobId;
	return new Promise((resolve, reject) => {
		jobs.set(id, { resolve, reject });
		worker.postMessage({ type: 'ocr', id, bytes }, [bytes.buffer]);
	});
}

// Page range like "1-3,5" → sorted 1-based page numbers within [1, total].
function parseRange(spec, total) {
	if (!spec) return Array.from({ length: total }, (_, i) => i + 1);
	const set = new Set();
	for (const part of spec.split(',')) {
		const [a, b] = part.split('-').map((s) => parseInt(s, 10));
		if (Number.isNaN(a)) continue;
		for (let p = a; p <= (Number.isNaN(b) ? a : b); p++) if (p >= 1 && p <= total) set.add(p);
	}
	return [...set].sort((x, y) => x - y);
}

async function renderPdfPages(file, onPage) {
	const pdfjs = await import(PDFJS_URL);
	pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
	const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
	let pages = parseRange($('ep-pages').value.trim(), doc.numPages);
	const skipped = Math.max(0, pages.length - MAX_OCR_PAGES);
	pages = pages.slice(0, MAX_OCR_PAGES);
	const images = [];
	for (const [i, n] of pages.entries()) {
		onPage(i + 1, pages.length);
		const page = await doc.getPage(n);
		const vp = page.getViewport({ scale: 2 });
		const canvas = document.createElement('canvas');
		canvas.width = vp.width; canvas.height = vp.height;
		await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
		const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
		images.push({ page: n, bytes: new Uint8Array(await blob.arrayBuffer()) });
	}
	return { images, skipped };
}

async function runOcr() {
	if (ocrBusy) return;
	ocrBusy = true;
	const token = runToken;
	const file = currentFile;
	gate.hidden = false;
	gateBtn.hidden = true;
	progress.hidden = false;
	try {
		gateText.textContent = 'Loading the OCR engine…';
		await startOcr();
		progress.hidden = true;
		let inputs, skipped = 0;
		if (kind === 'image') {
			inputs = [{ page: 1, bytes: new Uint8Array(await file.arrayBuffer()) }];
		} else {
			gateText.textContent = 'Rendering pages…';
			({ images: inputs, skipped } = await renderPdfPages(file, (i, n) => { gateText.textContent = `Rendering page ${i}/${n}…`; }));
		}
		const pages = [];
		const t0 = performance.now();
		for (const [i, { page, bytes }] of inputs.entries()) {
			if (token !== runToken) return;
			gateText.textContent = `Reading text${inputs.length > 1 ? ` · page ${i + 1}/${inputs.length}` : ''}…`;
			setStatus(`ocr: page ${i + 1}/${inputs.length}`);
			pages.push({ page, ...(await ocrImage(bytes)) });
		}
		if (token !== runToken) return;
		ocrPages = { pages, skipped, ms: Math.round(performance.now() - t0) };
		setStatus('ocr: ready', 'ok');
		gate.hidden = true;
		render();
	} catch (err) {
		if (token !== runToken) return;
		console.error(err);
		setStatus('ocr: error', 'err');
		progress.hidden = true;
		gateBtn.hidden = false;
		gateBtn.textContent = 'Retry OCR';
		gateText.textContent = `OCR failed: ${err.message || err}`;
	} finally {
		if (token === runToken) ocrBusy = false;
	}
}

// ---- Output -----------------------------------------------------------------------

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatOcr(fmt, { pages }) {
	const multi = pages.length > 1;
	if (fmt === 'json') {
		return JSON.stringify({ source: 'ocr', pages: pages.map(({ page, width, height, lines }) => ({ page, width, height, lines })) }, null, 2);
	}
	if (fmt === 'html') {
		return pages.map((p) => `<section data-page="${p.page}">\n${p.lines.map((l) => `  <p>${escapeHtml(l.text)}</p>`).join('\n')}\n</section>`).join('\n');
	}
	if (fmt === 'markdown') {
		return pages.map((p) => `${multi ? `## Page ${p.page}\n\n` : ''}${p.lines.map((l) => l.text).join('\n')}`).join('\n\n');
	}
	return pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n\n');
}

function show(text, info) {
	result = text;
	output.textContent = text || '// (no text found)';
	meta.textContent = info;
	$('ep-copy').disabled = $('ep-download').disabled = !text;
}

function render() {
	const fmt = format();
	const { pages, skipped, ms } = ocrPages;
	const lines = pages.reduce((a, p) => a + p.lines.length, 0);
	show(formatOcr(fmt, ocrPages), `${currentFile.name} → ${fmt} via OCR · ${pages.length} page${pages.length > 1 ? 's' : ''} · ${lines} lines · ${ms} ms${skipped ? ` · first ${MAX_OCR_PAGES} pages only` : ''}`);
}

function showGate(reason) {
	result = '';
	$('ep-copy').disabled = $('ep-download').disabled = true;
	output.textContent = '';
	meta.textContent = reason;
	gate.hidden = false;
	progress.hidden = true;
	gateBtn.hidden = false;
	gateBtn.textContent = ocrReady ? 'Run OCR' : 'Load OCR engine & run · 16.5 MB';
	gateText.textContent = ocrReady
		? 'The OCR engine is loaded. Run it on this file?'
		: 'This needs OCR. The ocrs engine (Rust → WASM) and its models are a one-time 16.5 MB download, and everything runs on your device.';
	if (ocrReady) runOcr();
}

function format() {
	return document.querySelector('input[name="ep-format"]:checked').value;
}

async function run() {
	if (!currentFile || ocrBusy) return;
	const token = ++runToken;
	gate.hidden = true;
	if (ocrPages) return render();
	if (kind === 'image') return showGate(`${currentFile.name} is an image`);

	const fmt = format();
	output.textContent = '// parsing…';
	try {
		const ep = await loadEngine();
		const bytes = new Uint8Array(await currentFile.arrayBuffer());
		const pages = $('ep-pages').value.trim() || null;
		const tables = $('ep-cluster').checked ? 'cluster' : 'default';
		const t0 = performance.now();
		let text = ep.convert_to_string(bytes, fmt, pages, null, tables);
		const ms = Math.round(performance.now() - t0);
		if (token !== runToken) return;
		const plain = fmt === 'text' ? text : ep.convert_to_string(bytes, 'text', pages, null, tables);
		if (!plain.trim()) return showGate(`${currentFile.name}: no text layer found (scanned?)`);
		if (fmt === 'json') {
			try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
		}
		show(text, `${currentFile.name} → ${fmt} · ${ms} ms · ${text.length.toLocaleString()} chars`);
	} catch (err) {
		console.error(err);
		setStatus('engine: error', 'err');
		show('', 'parse failed');
		output.textContent = `// failed: ${err && err.message ? err.message : err}`;
	}
}

function pick(file) {
	if (!file) return;
	const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
	const isImage = IMAGE_RE.test(file.name) || file.type.startsWith('image/');
	if (!isPdf && !isImage) {
		output.textContent = '// please choose a PDF or an image (PNG, JPG, WebP, BMP, TIFF, GIF)';
		return;
	}
	runToken++; // abandon any parse/OCR still running for the previous file
	ocrBusy = false;
	currentFile = file;
	kind = isPdf ? 'pdf' : 'image';
	ocrPages = null;
	drop.classList.add('has-file');
	card.classList.add('is-active');
	$('ep-filename').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
	run();
}

fileInput.addEventListener('change', () => {
	pick(fileInput.files[0]);
	fileInput.value = ''; // allow re-picking the same file
});
for (const zone of [drop, loaded]) {
	['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); }));
	['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
	zone.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
}

gateBtn.addEventListener('click', runOcr);
$('ep-another').addEventListener('click', () => fileInput.click());
$('ep-clear').addEventListener('click', () => {
	runToken++;
	ocrBusy = false;
	currentFile = null;
	ocrPages = null;
	result = '';
	gate.hidden = true;
	drop.classList.remove('has-file');
	card.classList.remove('is-active');
	output.textContent = '// Your extracted document will appear here.';
	meta.textContent = 'output';
	$('ep-copy').disabled = $('ep-download').disabled = true;
});

document.querySelectorAll('input[name="ep-format"]').forEach((r) => r.addEventListener('change', run));
$('ep-cluster').addEventListener('change', () => { if (kind === 'pdf' && !ocrPages) run(); });
$('ep-pages').addEventListener('change', () => { if (ocrBusy) return; ocrPages = null; run(); });

$('ep-copy').addEventListener('click', async () => {
	try { await navigator.clipboard.writeText(result); $('ep-copy').textContent = 'copied'; }
	catch (e) { $('ep-copy').textContent = 'failed'; }
	setTimeout(() => { $('ep-copy').textContent = 'copy'; }, 1500);
});

$('ep-download').addEventListener('click', () => {
	const blob = new Blob([result], { type: 'text/plain' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${currentFile.name.replace(/\.[^.]+$/, '')}.${EXT[format()]}`;
	a.click();
	URL.revokeObjectURL(a.href);
});

// Warm the parser on first intent (hover/focus), not on scroll, and never on Save-Data.
// The OCR engine is never warmed; it only loads from the gate button.
const warm = () => {
	if (navigator.connection && navigator.connection.saveData) return;
	loadEngine().catch(() => setStatus('engine: offline', 'err'));
};
card.addEventListener('pointerenter', warm, { once: true });
card.addEventListener('focusin', warm, { once: true });
setStatus('engine: loads on first use');
