# site

Personal site at purnoor.pages.dev: a static page with the cuconv benchmark explorer, a feature-map figure, and my resume.

No build step. Preview locally with `python3 -m http.server` from this directory and open http://localhost:8000.

Regenerate the figure from a cuconv results directory (needs Pillow): `python3 tools/make_figure.py <cuconv>/results/t4-20261102-2346 img/cuconv-featuremaps.jpg`

`functions/` is empty on purpose; Cloudflare Pages Functions drop in there.
