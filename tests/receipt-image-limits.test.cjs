const assert = require("node:assert/strict");
const { test } = require("node:test");
const sharp = require("sharp");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const { normalizeReceiptImage, MAX_RECEIPT_IMAGE_BYTES } = loadTypeScript("lib/telegram-media.ts");

function hasCode(code) {
  return error => error.name === "ReceiptImageError" && error.code === code;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pngWithDimensions(width, height) {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  image.writeUInt32BE(crc32(image.subarray(12, 29)), 29);
  return image;
}

test("real JPEG, PNG and WebP are decoded and normalized to a metadata-free PNG", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const image = await sharp({ create: { width: 120, height: 180, channels: 3, background: "white" } })
      .toFormat(format).withExif({ IFD0: { Artist: "private receipt owner" } }).toBuffer();
    const normalized = await normalizeReceiptImage(image);
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 120);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.exif, undefined);
  }
});

test("receipt orientation is applied before OCR and wide images are resized", async () => {
  const rotated = await sharp({ create: { width: 120, height: 180, channels: 3, background: "white" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const oriented = await sharp(await normalizeReceiptImage(rotated)).metadata();
  assert.equal(oriented.width, 180);
  assert.equal(oriented.height, 120);
  assert.equal(oriented.orientation, undefined);

  const wide = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "white" } }).png().toBuffer();
  const resized = await sharp(await normalizeReceiptImage(wide)).metadata();
  assert.equal(resized.width, 2500);
  assert.equal(resized.height, 1000);
});

test("encoded image limit is enforced before decoding", async () => {
  await assert.rejects(normalizeReceiptImage(Buffer.alloc(MAX_RECEIPT_IMAGE_BYTES + 1)), hasCode("too_large"));
});

test("oversized pixel and dimension headers are rejected without decoding a huge bitmap", async () => {
  await assert.rejects(normalizeReceiptImage(await pngWithDimensions(5000, 5000)), hasCode("too_many_pixels"));
  await assert.rejects(normalizeReceiptImage(await pngWithDimensions(10001, 1)), hasCode("too_many_pixels"));
});

test("a JPEG signature alone cannot pass actual decoder validation", async () => {
  await assert.rejects(normalizeReceiptImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0])), hasCode("invalid_image"));
  await assert.rejects(normalizeReceiptImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), hasCode("unsupported_format"));
});

test("truncated image payloads are rejected even when their header is valid", async () => {
  const valid = await sharp({ create: { width: 80, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeReceiptImage(valid.subarray(0, valid.length - 20)), hasCode("invalid_image"));
});

test("real animated WebP is rejected instead of recognizing just its first frame", async () => {
  const data = Buffer.alloc(8 * 16 * 3);
  data.fill(255, 0, 8 * 8 * 3);
  const animated = await sharp(data, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(normalizeReceiptImage(animated), hasCode("invalid_image"));
});

test("PNG animation control chunks are rejected before decoding", async () => {
  const valid = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8, 0);
  animation.write("acTL", 4, "ascii");
  animation.writeUInt32BE(2, 8);
  animation.writeUInt32BE(crc32(animation.subarray(4, 16)), 16);
  const animated = Buffer.concat([valid.subarray(0, 33), animation, valid.subarray(33)]);
  await assert.rejects(normalizeReceiptImage(animated), hasCode("invalid_image"));
});
