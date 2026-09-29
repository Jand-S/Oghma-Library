// Tiny, dependency-free encoders used by the fixture generator:
// - PNG (RGB, filter 0, zlib) for cover images
// - ustar tar writer (regular files only) matching what src/services/bundle.ts `untar` reads
import zlib from "node:zlib";

// ---------- PNG ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode an RGB image. `pixel(x, y)` returns [r, g, b]. */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---------- TAR (ustar) ----------
function octal(value, length) {
  // length includes the trailing NUL
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function header(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);
  h.write(name, 0, "utf8");
  h.write(octal(0o644, 8), 100, "ascii"); // mode
  h.write(octal(0, 8), 108, "ascii"); // uid
  h.write(octal(0, 8), 116, "ascii"); // gid
  h.write(octal(size, 12), 124, "ascii"); // size
  h.write(octal(mtime, 12), 136, "ascii"); // mtime
  h.fill(0x20, 148, 156); // checksum placeholder = spaces
  h[156] = 0x30; // typeflag '0' regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/** files: Array<{ name: string, data: Buffer|string }> -> tar Buffer (deterministic). */
export function encodeTar(files, mtime = 1_780_000_000) {
  const parts = [];
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    parts.push(header(file.name, data.length, mtime));
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0)); // two zero blocks = end of archive
  return Buffer.concat(parts);
}

/** Deterministic gzip (Node writes mtime=0 and a fixed OS byte). */
export function gzip(buf) {
  return zlib.gzipSync(buf, { level: 9 });
}
