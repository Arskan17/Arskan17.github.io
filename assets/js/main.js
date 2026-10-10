(() => {
	const root = document.documentElement;

	document.getElementById('theme-toggle').addEventListener('click', () => {
		const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
		root.dataset.theme = next;
		try { localStorage.setItem('theme', next); } catch (e) {}
	});

	const menu = document.getElementById('menu-toggle');
	const links = document.getElementById('nav-links');
	menu.addEventListener('click', () => {
		const open = links.classList.toggle('open');
		menu.setAttribute('aria-expanded', open);
	});
	links.addEventListener('click', (e) => {
		if (e.target.tagName === 'A') {
			links.classList.remove('open');
			menu.setAttribute('aria-expanded', 'false');
		}
	});

	const io = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				entry.target.classList.add('is-visible');
				io.unobserve(entry.target);
			}
		}
	}, { threshold: 0.12 });
	document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

	// Pause looping decorative animations while they are off screen.
	const looping = new IntersectionObserver((entries) => {
		for (const entry of entries) entry.target.classList.toggle('is-offscreen', !entry.isIntersecting);
	});
	document.querySelectorAll('.demo, .btn--glow, #contrib').forEach((el) => looping.observe(el));

	document.getElementById('year').textContent = new Date().getFullYear();
})();
