// Easter egg: the footer contribution graph turns into Snake.
// Trigger: click the graph, type "snake", or enter the Konami code.
(() => {
	const ROWS = 7, CELL = 18, GAP = 4, STEP = CELL + GAP;
	// Full year on wide screens; the last 20 weeks on phones so cells stay big enough to steer.
	const colsFor = () => (wrap.clientWidth < 640 ? 20 : 53);
	let COLS;
	const canvas = document.getElementById('snake');
	const wrap = document.getElementById('contrib');
	const label = document.getElementById('snake-label');
	const scoreEl = document.getElementById('snake-score');
	const hint = document.getElementById('snake-hint');
	const playBtn = document.getElementById('snake-play');
	const playText = document.getElementById('snake-play-text');
	const ctx = canvas.getContext('2d');

	let grid, total;
	function setup() {
		COLS = colsFor();
		const dpr = window.devicePixelRatio || 1;
		canvas.width = (COLS * STEP - GAP) * dpr;
		canvas.height = (ROWS * STEP - GAP) * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		// Seeded PRNG so the "history" looks the same on every visit.
		let seed = 17;
		const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		grid = Array.from({ length: COLS * ROWS }, () => {
			const r = rand();
			return r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4;
		});
		total = grid.reduce((a, v) => a + v * 3, 0);
		label.textContent = `${total.toLocaleString()} contributions in the ${COLS === 53 ? 'last year' : 'last 20 weeks'}`;
		document.getElementById('snake-play-hint').textContent = COLS === 53 ? 'arrows / wasd / swipe' : 'tap play, then swipe to steer';
	}
	setup();

	const color = (lvl) => getComputedStyle(document.documentElement).getPropertyValue(`--c${lvl}`).trim();
	const idx = (x, y) => y * COLS + x;

	let snake, dir, nextDir, cells, score, timer = null, playing = false, over = false;
	let best = 0;
	try { best = Number(localStorage.getItem('snake-best')) || 0; } catch (e) {}

	function cellRect(x, y, fill) {
		ctx.fillStyle = fill;
		ctx.beginPath();
		ctx.roundRect(x * STEP, y * STEP, CELL, CELL, 3);
		ctx.fill();
	}

	function draw() {
		const palette = [0, 1, 2, 3, 4].map(color);
		const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const src = playing || over ? cells : grid;
		for (let y = 0; y < ROWS; y++)
			for (let x = 0; x < COLS; x++) cellRect(x, y, palette[src[idx(x, y)]]);
		if (snake) {
			snake.forEach(([x, y], i) => {
				ctx.globalAlpha = over ? 0.4 : 1 - (i / snake.length) * 0.6;
				cellRect(x, y, accent);
			});
			ctx.globalAlpha = 1;
		}
	}

	function start() {
		cells = grid.slice();
		snake = [[5, 3], [4, 3], [3, 3]];
		snake.forEach(([x, y]) => (cells[idx(x, y)] = 0));
		dir = nextDir = [1, 0];
		score = 0;
		playing = true;
		over = false;
		wrap.classList.add('playing');
		label.textContent = 'snake — eat the commits';
		hint.textContent = COLS === 53 ? 'arrows / wasd / swipe · esc to quit' : 'swipe on the grid to steer';
		updateScore();
		clearInterval(timer);
		timer = setInterval(tick, 110);
		canvas.focus({ preventScroll: true });
		wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function stop(final) {
		clearInterval(timer);
		playing = false;
		over = final;
		wrap.classList.remove('playing');
		if (final) {
			playText.textContent = `↻ Play again · score ${score}`;
			if (score > best) {
				best = score;
				try { localStorage.setItem('snake-best', best); } catch (e) {}
			}
			label.textContent = `game over — ${score} contributions · click to retry`;
		} else {
			snake = null;
			playText.textContent = '▶ Play';
			label.textContent = `${total.toLocaleString()} contributions in the ${COLS === 53 ? 'last year' : 'last 20 weeks'}`;
		}
		hint.textContent = 'less';
		updateScore();
		draw();
	}

	function updateScore() {
		scoreEl.textContent = playing || over ? `score ${score} · best ${best}` : '';
	}

	function tick() {
		dir = nextDir;
		const [hx, hy] = snake[0];
		const head = [(hx + dir[0] + COLS) % COLS, (hy + dir[1] + ROWS) % ROWS];
		const lvl = cells[idx(...head)];
		const body = lvl ? snake : snake.slice(0, -1);
		if (body.some(([x, y]) => x === head[0] && y === head[1])) return stop(true);
		snake.unshift(head);
		if (lvl) {
			score += lvl * 3;
			cells[idx(...head)] = 0;
			if (cells.every((v) => v === 0)) return stop(true);
		} else {
			snake.pop();
		}
		updateScore();
		draw();
	}

	function turn(dx, dy) {
		if (dx === -dir[0] && dy === -dir[1]) return;
		nextDir = [dx, dy];
	}

	const KEYS = {
		ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
		w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
	};
	const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
	let buffer = [];

	document.addEventListener('keydown', (e) => {
		const tag = e.target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		if (playing) {
			const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
			if (k) { e.preventDefault(); turn(...k); }
			else if (e.key === 'Escape') stop(false);
			return;
		}
		buffer = [...buffer, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-10);
		const typed = buffer.slice(-5).join('');
		if (typed === 'snake' || buffer.join() === KONAMI.join()) {
			buffer = [];
			start();
		}
	});

	canvas.tabIndex = 0;
	canvas.addEventListener('click', () => { if (!playing) start(); });
	playBtn.addEventListener('click', start);

	let touch = null;
	canvas.addEventListener('touchstart', (e) => { touch = e.touches[0]; }, { passive: true });
	canvas.addEventListener('touchend', (e) => {
		if (!touch || !playing) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
		if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) {
			Math.abs(dx) > Math.abs(dy) ? turn(Math.sign(dx), 0) : turn(0, Math.sign(dy));
		}
		touch = null;
	});

	new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	draw();
	let resizeTimer;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			if (!playing && colsFor() !== COLS) { over = false; snake = null; setup(); draw(); }
		}, 150);
	});
})();
