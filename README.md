# IIIF on GitHub Pages: a test

Text as Data 2026–27, University of Antwerp. Live: <https://dtaantwerp.github.io/iiif-test/>

GitHub Pages only serves files, but a IIIF Image API server computes every image on request. Here a service worker ([`sw.js`](sw.js)) plays that server inside the browser: it loads the full scan from `images/` once and computes region, size, rotation (with mirroring), quality (`default`, `color`, `gray`, `bitonal`) and format (`jpg`, `png`, `webp`) with a canvas. [`404.html`](404.html) installs the worker when an address is opened in a fresh browser, and loads it again.

- [`index.html`](index.html): try addresses, with examples
- [`manifest.json`](manifest.json) (written by [`make_manifest.py`](make_manifest.py)) and [`viewer.html`](viewer.html): the six pages in Mirador
- Limitation: only a browser that visited this site has the server; `curl`, Python or another site's viewer only see files.

The images are the three copies the teachers made for the Class Tradition (W, X, G), recto and verso.
