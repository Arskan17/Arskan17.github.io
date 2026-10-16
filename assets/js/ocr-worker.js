// OCR worker: runs EdgeParse's ocrs engine (Rust → wasm32-wasip1) off the main thread.
// The module only needs a handful of WASI calls and never touches the filesystem
// (models arrive as bytes), so a tiny stub stands in for a full WASI runtime.
const BASE = 'https://cdn.jsdelivr.net/gh/Arskan17/EdgeParse@2011ca7/package/';
const FILES = [
	{ key: 'wasm', url: `${BASE}ocr_wasm.wasm`, size: 4357578 },
	{ key: 'det', url: `${BASE}models/text-detection.onnx`, size: 2499479 },
	{ key: 'rec', url: `${BASE}models/text-recognition.onnx`, size: 9713177 },
];
const TOTAL = FILES.reduce((a, f) => a + f.size, 0);
const ENOSYS = 52, EBADF = 8;

let ex = null;
let ready = null;

const mem = () => new Uint8Array(ex.memory.buffer);
const view = () => new DataView(ex.memory.buffer);

function wasi() {
	return {
		random_get(ptr, len) { crypto.getRandomValues(mem().subarray(ptr, ptr + len)); return 0; },
		clock_time_get(_id, _precision, out) {
			view().setBigUint64(out, BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)), true);
			return 0;
		},
		environ_sizes_get(count, size) { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
		environ_get() { return 0; },
		fd_write(_fd, iovs, n, out) {
			const v = view(); let total = 0; let text = '';
			for (let i = 0; i < n; i++) {
				const p = v.getUint32(iovs + 8 * i, true), l = v.getUint32(iovs + 8 * i + 4, true);
				text += new TextDecoder().decode(mem().slice(p, p + l)); total += l;
			}
			if (text.trim()) console.warn('[ocr]', text.trim());
			v.setUint32(out, total, true);
			return 0;
		},
		proc_exit(code) { throw new Error(`OCR engine exited (${code})`); },
		sched_yield() { return 0; },
		fd_prestat_get() { return EBADF; },
		fd_close: () => EBADF, fd_fdstat_get: () => EBADF, fd_prestat_dir_name: () => EBADF,
		fd_read: () => EBADF, fd_seek: () => EBADF, path_open: () => ENOSYS,
	};
}

async function download(onBytes) {
	return Promise.all(FILES.map(async (f) => {
		const res = await fetch(f.url);
		if (!res.ok) throw new Error(`download failed: ${f.url} (${res.status})`);
		const reader = res.body.getReader();
		const chunks = []; let got = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value); got += value.length; onBytes(value.length);
		}
		const out = new Uint8Array(got); let o = 0;
		for (const c of chunks) { out.set(c, o); o += c.length; }
		return [f.key, out];
	})).then(Object.fromEntries);
}

function put(bytes) {
	const p = ex.alloc(bytes.length);
	mem().set(bytes, p);
	return p;
}

function readPrefixed(p) {
	const n = view().getUint32(p, true);
	const s = new TextDecoder().decode(mem().slice(p + 4, p + 4 + n));
	ex.free_result(p);
	return s;
}

async function init() {
	let loadedBytes = 0, lastPct = -1;
	const files = await download((n) => {
		loadedBytes += n;
		const pct = Math.min(99, Math.floor((loadedBytes / TOTAL) * 100));
		if (pct !== lastPct) { lastPct = pct; postMessage({ type: 'progress', pct, loaded: loadedBytes, total: TOTAL }); }
	});
	postMessage({ type: 'stage', text: 'Starting the engine and loading the models…' });
	const { instance } = await WebAssembly.instantiate(files.wasm, { wasi_snapshot_preview1: wasi() });
	ex = instance.exports;
	const rc = ex.ocr_init(put(files.det), files.det.length, put(files.rec), files.rec.length);
	if (rc !== 0) throw new Error(readPrefixed(ex.last_error()));
	postMessage({ type: 'progress', pct: 100, loaded: TOTAL, total: TOTAL });
}

onmessage = async ({ data }) => {
	try {
		if (data.type === 'init') {
			ready ??= init();
			await ready;
			postMessage({ type: 'ready' });
		} else if (data.type === 'ocr') {
			await ready;
			const p = ex.ocr_image(put(data.bytes), data.bytes.length);
			if (!p) throw new Error(readPrefixed(ex.last_error()));
			postMessage({ type: 'result', id: data.id, result: JSON.parse(readPrefixed(p)) });
		}
	} catch (err) {
		if (data.type === 'init') ready = null;
		postMessage({ type: 'error', id: data.id, message: String(err && err.message || err) });
	}
};
