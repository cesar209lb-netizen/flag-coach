// QR codes, drawn in the app rather than fetched from a service.
//
// A join link is long enough that nobody wants to type it, so the invite
// screens show it as a QR code for a parent to point a camera at. The app has
// to keep working with no internet, so the encoder lives here instead of
// coming off a CDN. Byte mode only, which is what a URL needs.
//
// Follows ISO/IEC 18004. The version/block tables and the module-count formula
// are the standard ones.

// Error correction codewords per block, indexed [level][version].
const ECC_PER_BLOCK = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

// How many blocks the data is split into, indexed [level][version].
const EC_BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Total modules a version can spend on data plus error correction, before the
// finder/timing/alignment furniture is taken out.
function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const aligns = Math.floor(ver / 7) + 2;
    n -= (25 * aligns - 10) * aligns - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver, ecl) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver - 1] * EC_BLOCKS[ecl][ver - 1];

// Centres of the alignment patterns, which the spec spaces evenly.
function alignPositions(ver) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---------- GF(256) arithmetic for Reed-Solomon ----------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d; // the primitive polynomial QR uses
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// The divisor polynomial for `degree` error correction codewords.
function rsPolynomial(degree) {
  const poly = new Uint8Array(degree);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = gfMul(poly[j], root);
      if (j + 1 < degree) poly[j] ^= poly[j + 1];
    }
    root = gfMul(root, 2);
  }
  return poly;
}

function rsRemainder(data, divisor) {
  const out = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ out[0];
    out.copyWithin(0, 1);
    out[out.length - 1] = 0;
    for (let i = 0; i < out.length; i++) out[i] ^= gfMul(divisor[i], factor);
  }
  return out;
}

// ---------- Encoding ----------

class BitBuffer {
  constructor() { this.bits = []; }
  push(value, len) { for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1); }
  get length() { return this.bits.length; }
}

// Byte mode: a mode indicator, the length, then the raw UTF-8.
function encodeData(bytes, ver, ecl) {
  const capacity = dataCodewords(ver, ecl) * 8;
  const bb = new BitBuffer();
  bb.push(0b0100, 4);
  bb.push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) bb.push(b, 8);
  if (bb.length > capacity) return null;

  bb.push(0, Math.min(4, capacity - bb.length)); // terminator
  bb.push(0, (8 - (bb.length % 8)) % 8); // pad to a whole codeword
  // Alternating pad bytes fill whatever room is left.
  for (let pad = 0xec; bb.length < capacity; pad ^= 0xec ^ 0x11) bb.push(pad, 8);

  const words = new Uint8Array(bb.length / 8);
  bb.bits.forEach((bit, i) => { if (bit) words[i >>> 3] |= 0x80 >>> (i & 7); });
  return words;
}

// Split into blocks, add error correction to each, then interleave. The
// interleaving is what lets a scanner lose a chunk of the code and recover.
function addEcc(data, ver, ecl) {
  const blockCount = EC_BLOCKS[ecl][ver - 1];
  const eccLen = ECC_PER_BLOCK[ecl][ver - 1];
  const totalWords = Math.floor(rawDataModules(ver) / 8);
  const shortBlockLen = Math.floor(totalWords / blockCount) - eccLen;
  const longBlocks = totalWords % blockCount; // these carry one extra data word

  const divisor = rsPolynomial(eccLen);
  const blocks = [];
  for (let i = 0, off = 0; i < blockCount; i++) {
    const len = shortBlockLen + (i >= blockCount - longBlocks ? 1 : 0);
    const dat = data.subarray(off, off + len);
    off += len;
    blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
  }

  const out = new Uint8Array(totalWords);
  let k = 0;
  for (let i = 0; i <= shortBlockLen; i++) {
    for (const b of blocks) if (i < b.dat.length) out[k++] = b.dat[i];
  }
  for (let i = 0; i < eccLen; i++) {
    for (const b of blocks) out[k++] = b.ecc[i];
  }
  return out;
}

// ---------- Drawing the symbol ----------

class Matrix {
  constructor(size) {
    this.size = size;
    this.mods = Array.from({ length: size }, () => new Uint8Array(size));
    this.fixed = Array.from({ length: size }, () => new Uint8Array(size));
  }
  set(x, y, dark, fixed = true) {
    this.mods[y][x] = dark ? 1 : 0;
    if (fixed) this.fixed[y][x] = 1;
  }
  get(x, y) { return this.mods[y][x] === 1; }
  inside(x, y) { return x >= 0 && x < this.size && y >= 0 && y < this.size; }
}

function drawFurniture(m, ver, ecl) {
  const size = m.size;
  // Finder patterns plus the blank separator ring around each.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!m.inside(x, y)) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        m.set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Timing lines.
  for (let i = 0; i < size; i++) {
    if (!m.fixed[6][i]) m.set(i, 6, i % 2 === 0);
    if (!m.fixed[i][6]) m.set(6, i, i % 2 === 0);
  }
  // Alignment patterns, skipping the corners the finders already own.
  const pos = alignPositions(ver);
  for (let a = 0; a < pos.length; a++) {
    for (let b = 0; b < pos.length; b++) {
      const corner = (a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          m.set(pos[a] + dx, pos[b] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Reserve the format areas; the real bits go in once the mask is chosen.
  reserveFormat(m);
  m.set(8, size - 8, true); // the always-dark module
  if (ver >= 7) drawVersion(m, ver);
}

function reserveFormat(m) {
  const size = m.size;
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { m.set(i, 8, false); m.set(8, i, false); }
  }
  for (let i = 0; i < 8; i++) {
    m.set(size - 1 - i, 8, false);
    m.set(8, size - 1 - i, false);
  }
}

function drawFormat(m, ecl, mask) {
  const size = m.size;
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) m.set(8, i, bit(i));
  m.set(8, 7, bit(6));
  m.set(8, 8, bit(7));
  m.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(i));

  for (let i = 0; i < 8; i++) m.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.set(8, size - 15 + i, bit(i));
  m.set(8, size - 8, true);
}

function drawVersion(m, ver) {
  const size = m.size;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.set(a, b, dark);
    m.set(b, a, dark);
  }
}

// Data snakes up and down the symbol in two-module-wide columns.
function drawData(m, words) {
  const size = m.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing line is not a data column
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (m.fixed[y][x]) continue;
        const bit = i < words.length * 8 && ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        m.set(x, y, bit, false);
        i++;
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, mask) {
  const fn = MASKS[mask];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.fixed[y][x] && fn(x, y)) m.mods[y][x] ^= 1;
    }
  }
}

// The spec's four penalty rules; the lowest-scoring mask is the one to use.
function penalty(m) {
  const size = m.size;
  let score = 0;

  const runScore = (line) => {
    let total = 0, run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) total += 3 + (run - 5);
      run = 1;
    }
    return total;
  };
  for (let y = 0; y < size; y++) score += runScore(Array.from(m.mods[y]));
  for (let x = 0; x < size; x++) score += runScore(Array.from({ length: size }, (_, y) => m.mods[y][x]));

  // 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m.mods[y][x];
      if (v === m.mods[y][x + 1] && v === m.mods[y + 1][x] && v === m.mods[y + 1][x + 1]) score += 3;
    }
  }

  // Finder-like 1:1:3:1:1 runs, which could confuse a scanner.
  const PATTERN = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (line, at) => {
    for (let i = 0; i < 7; i++) if (line[at + i] !== PATTERN[i]) return false;
    const before = line.slice(Math.max(0, at - 4), at);
    const after = line.slice(at + 7, at + 11);
    const clear = (side) => side.length >= 4 && side.every((v) => v === 0);
    return clear(before) || clear(after);
  };
  for (let y = 0; y < size; y++) {
    const row = Array.from(m.mods[y]);
    for (let x = 0; x + 7 <= size; x++) if (hasPattern(row, x)) score += 40;
  }
  for (let x = 0; x < size; x++) {
    const col = Array.from({ length: size }, (_, y) => m.mods[y][x]);
    for (let y = 0; y + 7 <= size; y++) if (hasPattern(col, y)) score += 40;
  }

  // Overall balance of dark to light.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += m.mods[y][x];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Encode `text` and return the finished symbol as rows of booleans, where true
 * is a dark module. Throws if the text is too long for a QR code at all.
 */
export function qrModules(text, { ecl = 'L', minVersion = 1 } = {}) {
  const bytes = new TextEncoder().encode(text);
  for (let ver = Math.max(1, minVersion); ver <= 40; ver++) {
    const data = encodeData(bytes, ver, ecl);
    if (!data) continue;

    const words = addEcc(data, ver, ecl);
    const m = new Matrix(ver * 4 + 17);
    drawFurniture(m, ver, ecl);
    drawData(m, words);

    // Try every mask and keep the best-scoring one.
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(m, mask);
      drawFormat(m, ecl, mask);
      const score = penalty(m);
      if (!best || score < best.score) best = { score, mask, mods: m.mods.map((r) => Uint8Array.from(r)) };
      applyMask(m, mask); // masking is its own inverse
    }
    return best.mods.map((row) => Array.from(row, (v) => v === 1));
  }
  throw new Error('Too much text for a QR code');
}

/**
 * The same symbol as SVG markup, sized in modules so it scales to any box.
 * `margin` is the quiet zone in modules — scanners need at least 4.
 */
export function qrSvg(text, { ecl = 'L', margin = 4, label = 'QR code' } = {}) {
  const rows = qrModules(text, { ecl });
  const size = rows.length + margin * 2;
  // One path for every dark module keeps the markup small and crisp at any size.
  let d = '';
  rows.forEach((row, y) => {
    row.forEach((dark, x) => { if (dark) d += `M${x + margin} ${y + margin}h1v1h-1z`; });
  });
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
