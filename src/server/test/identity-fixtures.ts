/**
 * Synthetic test files. They carry real file signatures and headers (enough
 * for server-side validation) but no real identity data.
 */

/** Minimal JPEG: SOI, a SOF0 header with the given size, padding, EOI. */
export function fakeJpeg(width = 640, height = 480, padding = 2048): Uint8Array {
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  const body = new Uint8Array(padding).map((_, i) => (i * 37) % 251);
  return new Uint8Array([0xff, 0xd8, ...sof, ...body, 0xff, 0xd9]);
}

/** Minimal PNG: signature + IHDR with the given size. */
export function fakePng(width = 1000, height = 640): Uint8Array {
  const buf = Buffer.alloc(33 + 512);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return new Uint8Array(buf);
}

export function fakePdf(content = "Sample identity document"): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${content}\nstream\n${"x".repeat(512)}\nendstream\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
      "latin1",
    ),
  );
}

export const maliciousPdf = () =>
  new Uint8Array(
    Buffer.from(
      "%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n",
      "latin1",
    ),
  );
export const htmlBytes = () =>
  new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>"));
export const svgBytes = () =>
  new Uint8Array(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  );
export const exeBytes = () =>
  new Uint8Array(Buffer.from("MZ\x90\x00\x03\x00\x00\x00 this program cannot be run", "latin1"));
