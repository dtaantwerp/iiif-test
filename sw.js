// A IIIF Image API 3.0 "server" that runs in the browser.
// GitHub Pages only serves files. This service worker answers every request
// under iiif/ itself: it loads the full image from images/ and computes the
// requested region, size, rotation, quality and format with a canvas.
//
//   iiif/{identifier}/info.json
//   iiif/{identifier}/{region}/{size}/{rotation}/{quality}.{format}

const SCOPE = new URL(self.registration.scope);
const IIIF = SCOPE.pathname + 'iiif/';
const FORMATS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const QUALITIES = ['default', 'color', 'gray', 'bitonal'];
const bitmaps = new Map();  // identifier -> decoded full image, kept while the worker lives

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === SCOPE.origin && url.pathname.startsWith(IIIF)) {
    event.respondWith(handle(url.pathname.slice(IIIF.length)));
  }
});

class IIIFError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function handle(path) {
  try {
    const parts = path.split('/').map(decodeURIComponent);
    const id = parts[0];
    if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) {
      return Response.redirect(SCOPE.href + 'iiif/' + id + '/info.json', 303);
    }
    if (parts.length === 2 && parts[1] === 'info.json') return infoJson(id);
    if (parts.length !== 5) throw new IIIFError(400, 'Expected {region}/{size}/{rotation}/{quality}.{format}');
    return await image(id, parts[1], parts[2], parts[3], parts[4]);
  } catch (err) {
    return new Response(`${err.status || 500} ${err.message}\n`, {
      status: err.status || 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

async function load(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new IIIFError(404, `No image called ${id}`);
  if (!bitmaps.has(id)) {
    const response = await fetch(SCOPE.href + 'images/' + id + '.jpg');
    if (!response.ok) throw new IIIFError(404, `No image called ${id}`);
    bitmaps.set(id, await createImageBitmap(await response.blob()));
  }
  return bitmaps.get(id);
}

async function infoJson(id) {
  const img = await load(id);
  const info = {
    '@context': 'http://iiif.io/api/image/3/context.json',
    id: SCOPE.href + 'iiif/' + id,
    type: 'ImageService3',
    protocol: 'http://iiif.io/api/image',
    profile: 'level2',
    width: img.width,
    height: img.height,
    tiles: [{ width: 512, scaleFactors: [1, 2, 4, 8] }],
    extraQualities: ['color', 'gray', 'bitonal'],
    extraFormats: ['webp'],
    extraFeatures: ['mirroring', 'regionSquare', 'rotationArbitrary', 'sizeUpscaling'],
  };
  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/ld+json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

function parseRegion(region, W, H) {
  if (region === 'full') return [0, 0, W, H];
  if (region === 'square') {
    const s = Math.min(W, H);
    return [Math.floor((W - s) / 2), Math.floor((H - s) / 2), s, s];
  }
  const pct = region.startsWith('pct:');
  const nums = (pct ? region.slice(4) : region).split(',').map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new IIIFError(400, `Bad region: ${region}`);
  }
  let [x, y, w, h] = pct ? [nums[0] * W / 100, nums[1] * H / 100, nums[2] * W / 100, nums[3] * H / 100] : nums;
  [x, y, w, h] = [x, y, w, h].map(Math.round);
  w = Math.min(w, W - x);  // a region that runs off the image is cut off at its edge
  h = Math.min(h, H - y);
  if (x >= W || y >= H || w <= 0 || h <= 0) throw new IIIFError(400, `Region outside the image: ${region}`);
  return [x, y, w, h];
}

function parseSize(size, w, h) {
  const s = size.replace(/^\^/, '');  // ^ allows upscaling; we always allow it
  if (s === 'max' || s === 'full') return [w, h];  // 'full' is Image API 2
  if (s.startsWith('pct:')) {
    const p = Number(s.slice(4));
    if (!(p > 0)) throw new IIIFError(400, `Bad size: ${size}`);
    return [Math.round(w * p / 100), Math.round(h * p / 100)];
  }
  const fit = s.startsWith('!');
  const [a, b] = (fit ? s.slice(1) : s).split(',');
  const sw = a === '' ? null : Number(a);
  const sh = b === '' || b === undefined ? null : Number(b);
  if ((sw !== null && !(sw > 0)) || (sh !== null && !(sh > 0)) || (sw === null && sh === null)) {
    throw new IIIFError(400, `Bad size: ${size}`);
  }
  if (fit) {
    if (sw === null || sh === null) throw new IIIFError(400, `Bad size: ${size}`);
    const scale = Math.min(sw / w, sh / h);
    return [Math.round(w * scale), Math.round(h * scale)];
  }
  if (sh === null) return [sw, Math.round(h * sw / w)];
  if (sw === null) return [Math.round(w * sh / h), sh];
  return [sw, sh];
}

async function image(id, region, size, rotation, qualityFormat) {
  const dot = qualityFormat.lastIndexOf('.');
  const quality = qualityFormat.slice(0, dot);
  const format = qualityFormat.slice(dot + 1);
  if (!QUALITIES.includes(quality)) throw new IIIFError(400, `Bad quality: ${quality}`);
  if (!FORMATS[format]) throw new IIIFError(400, `Format not supported: ${format}`);
  const mirror = rotation.startsWith('!');
  const degrees = Number(mirror ? rotation.slice(1) : rotation);
  if (!Number.isFinite(degrees) || degrees < 0 || degrees > 360) throw new IIIFError(400, `Bad rotation: ${rotation}`);

  const img = await load(id);
  const [x, y, w, h] = parseRegion(region, img.width, img.height);
  const [sw, sh] = parseSize(size, w, h);
  if (sw * sh > 40e6) throw new IIIFError(400, 'Requested image too large');

  // the rotated image needs a canvas the size of its bounding box
  const rad = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const cw = Math.round(sw * cos + sh * sin), ch = Math.round(sw * sin + sh * cos);
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: quality === 'gray' || quality === 'bitonal' });
  ctx.imageSmoothingQuality = 'high';  // smoother downscaling: less moiré on squared paper
  if (format === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }  // jpg has no transparency
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(img, x, y, w, h, -sw / 2, -sh / 2, sw, sh);

  if (quality === 'gray' || quality === 'bitonal') {
    const data = ctx.getImageData(0, 0, cw, ch);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      let v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (quality === 'bitonal') v = v < 128 ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
  }

  const blob = await canvas.convertToBlob({ type: FORMATS[format], quality: 0.9 });
  return new Response(blob, {
    headers: { 'Content-Type': FORMATS[format], 'Access-Control-Allow-Origin': '*' },
  });
}
