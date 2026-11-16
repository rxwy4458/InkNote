// Draws the Android launcher icons and the splash icon from app/icon.svg (the same logo as the Windows app).
// Writes into android/app/src/main/res: adaptive icon (white background + logo foreground + monochrome layer for
// Android 13 themed icons) and round/square legacy icons for Android 7.
// Needs @napi-rs/canvas, which the desktop project already installs (npm ci in the repository root).
// Usage: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const {createCanvas, loadImage} = require('@napi-rs/canvas');
const res = path.resolve(here, '..', 'android', 'app', 'src', 'main', 'res');
const svg = fs.readFileSync(path.join(repo, 'app', 'icon.svg'), 'utf8');
const DENSITIES = {mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4};

const logo = async px => loadImage(Buffer.from(svg.replace('<svg ', `<svg width="${px}" height="${px}" `)));

// Where the logo's visible pixels are, measured once on a large rendering: centre and the radius of the smallest
// circle around that centre that holds every pixel. Used to fit the logo inside Android's round "safe zone".
async function measure() {
  const N = 1024, c = createCanvas(N, N), x = c.getContext('2d');
  x.drawImage(await logo(N), 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  let minX = N, minY = N, maxX = 0, maxY = 0;
  for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) if (d[(y * N + i) * 4 + 3] > 8) { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let r = 0;
  for (let y = minY; y <= maxY; y++) for (let i = minX; i <= maxX; i++) if (d[(y * N + i) * 4 + 3] > 8) r = Math.max(r, Math.hypot(i - cx, y - cy));
  return {cx: cx / N, cy: cy / N, r: r / N};
}

// Draws the logo so that its pixels fit in a circle of radius `radius` around (ox, oy).
async function drawLogo(x, size, ox, oy, radius, m) {
  const s = radius / m.r;
  x.drawImage(await logo(Math.ceil(s * 2)), ox - m.cx * s, oy - m.cy * s, s, s);
}

function save(canvas, ...parts) {
  const file = path.join(res, ...parts);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}

const m = await measure();
for (const [name, k] of Object.entries(DENSITIES)) {
  // Adaptive icon layers are 108 dp; the launcher masks them to 72 dp and only a 66 dp circle is always visible.
  const fg = Math.round(108 * k), f = createCanvas(fg, fg), fx = f.getContext('2d');
  await drawLogo(fx, fg, fg / 2, fg / 2, 31 * k, m);
  save(f, `mipmap-${name}`, 'ic_launcher_foreground.png');
  // Themed icon (Android 13+): one colour, with the white details of the nib cut out.
  const mono = createCanvas(fg, fg), mx = mono.getContext('2d');
  mx.drawImage(f, 0, 0);
  const img = mx.getImageData(0, 0, fg, fg), p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const white = Math.min(p[i], p[i + 1], p[i + 2]);
    const a = p[i + 3] * (1 - Math.max(0, white - 150) / 105);
    p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = Math.max(0, Math.min(255, Math.round(a)));
  }
  mx.putImageData(img, 0, 0);
  save(mono, `mipmap-${name}`, 'ic_launcher_monochrome.png');
  // Legacy icons for Android 7 (48 dp): a white tile with the logo.
  const lg = Math.round(48 * k);
  for (const round of [false, true]) {
    const c = createCanvas(lg, lg), x = c.getContext('2d'), inset = 2 * k, w = lg - inset * 2;
    x.shadowColor = 'rgba(0,0,0,.22)'; x.shadowBlur = 1.5 * k; x.shadowOffsetY = .6 * k;
    x.fillStyle = '#ffffff'; x.beginPath();
    if (round) x.arc(lg / 2, lg / 2, w / 2, 0, Math.PI * 2); else x.roundRect(inset, inset, w, w, 9 * k);
    x.fill(); x.shadowColor = 'transparent';
    await drawLogo(x, lg, lg / 2, lg / 2, w * .36, m);
    save(c, `mipmap-${name}`, round ? 'ic_launcher_round.png' : 'ic_launcher.png');
  }
}
console.log('✓ launcher icons written to', path.relative(process.cwd(), res));
