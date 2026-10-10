# Arskan17.github.io

My personal portfolio, served by GitHub Pages at https://arskan17.github.io.

It is a static site with no framework and no build step: `index.html`, `assets/css/main.css` and vanilla JS in `assets/js/`.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(The page has to be served over HTTP; ES modules and WASM do not load from `file://`.)
