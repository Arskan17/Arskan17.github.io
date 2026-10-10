// EdgeParse WASM demo. The engine (~2.8 MB) is fetched lazily on first use.
const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/edgeparse-wasm@0.2.5/edgeparse_wasm.js';
const EXT = { markdown: 'md', json: 'json', html: 'html', text: 'txt' };

const $ = (id) => document.getElementById(id);
const status = $('ep-status');
const output = $('ep-output');
const meta = $('ep-meta');
const drop = $('ep-drop');
const fileInput = $('ep-file');

let engine = null;
let currentFile = null;
let result = '';

function setStatus(text, kind = '') {
	status.textContent = `engine: ${text}`;
	status.className = `demo__status mono ${kind}`;
}

async function loadEngine() {
	if (engine) return engine;
	setStatus('loading wasm…');
	const mod = await import(ENGINE_URL);
	await mod.default();
	try { mod.init(); } catch (e) {}
	engine = mod;
	setStatus(`v${mod.version()} ready`, 'ok');
	return engine;
}

function format() {
	return document.querySelector('input[name="ep-format"]:checked').value;
}

async function run() {
	if (!currentFile) return;
	const fmt = format();
	output.textContent = '// parsing…';
	try {
		const ep = await loadEngine();
		const bytes = new Uint8Array(await currentFile.arrayBuffer());
		const pages = $('ep-pages').value.trim() || null;
		const tables = $('ep-cluster').checked ? 'cluster' : 'default';
		const t0 = performance.now();
		result = ep.convert_to_string(bytes, fmt, pages, null, tables);
		const ms = Math.round(performance.now() - t0);
		if (fmt === 'json') {
			try { result = JSON.stringify(JSON.parse(result), null, 2); } catch (e) {}
		}
		output.textContent = result || '// (no text found — scanned PDFs need OCR)';
		meta.textContent = `${currentFile.name} → ${fmt} · ${ms} ms · ${result.length.toLocaleString()} chars`;
		$('ep-copy').disabled = $('ep-download').disabled = !result;
	} catch (err) {
		console.error(err);
		setStatus('error', 'err');
		output.textContent = `// failed: ${err && err.message ? err.message : err}`;
		$('ep-copy').disabled = $('ep-download').disabled = true;
	}
}

function pick(file) {
	if (!file) return;
	if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
		output.textContent = '// please choose a PDF file';
		return;
	}
	currentFile = file;
	drop.classList.add('has-file');
	$('ep-filename').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
	run();
}

fileInput.addEventListener('change', () => pick(fileInput.files[0]));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

document.querySelectorAll('input[name="ep-format"]').forEach((r) => r.addEventListener('change', run));
$('ep-cluster').addEventListener('change', run);
$('ep-pages').addEventListener('change', run);

$('ep-copy').addEventListener('click', async () => {
	try { await navigator.clipboard.writeText(result); $('ep-copy').textContent = 'copied'; }
	catch (e) { $('ep-copy').textContent = 'failed'; }
	setTimeout(() => { $('ep-copy').textContent = 'copy'; }, 1500);
});

$('ep-download').addEventListener('click', () => {
	const blob = new Blob([result], { type: 'text/plain' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${currentFile.name.replace(/\.pdf$/i, '')}.${EXT[format()]}`;
	a.click();
	URL.revokeObjectURL(a.href);
});

// Warm the engine when the demo scrolls into view.
new IntersectionObserver((entries, obs) => {
	if (entries.some((e) => e.isIntersecting)) {
		obs.disconnect();
		loadEngine().catch(() => setStatus('offline', 'err'));
	}
}, { rootMargin: '200px' }).observe($('edgeparse'));
