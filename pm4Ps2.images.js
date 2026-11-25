"use strict";
const zlib = require("zlib");
function check(ok, message) { if (!ok) throw new Error(message); }
function range(b, p, n) { check(Number.isSafeInteger(p) && Number.isSafeInteger(n) && p >= 0 && n >= 0 && p + n <= b.length, "Truncated PM4 image data."); }
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = v & 1 ? (v >>> 1) ^ 0xedb88320 : v >>> 1; crcTable[i] = v; }
function crc32(b) { let v = 0xffffffff; for (const byte of b) v = crcTable[(v ^ byte) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; }
function pngChunk(type, bytes) {
    const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out;
}
function dimensions(width, height) { check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16 * 1024 * 1024, "Unsupported image dimensions."); }
function encodePng({width, height, data}) {
    dimensions(width, height); check(data.length === width * height * 4, "RGBA pixel buffer size mismatch.");
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    const rows = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
    return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}
function paeth(a, b, c) { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; }
function decodePng(b) {
    check(b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "Edited image must be a PNG.");
    let width, height, type, bpp, palette, alpha, ended = false; const compressed = [];
    for (let p = 8; p < b.length;) {
        range(b, p, 12); const n = b.readUInt32BE(p); range(b, p + 8, n + 4);
        const name = b.toString("ascii", p + 4, p + 8), bytes = b.subarray(p + 8, p + 8 + n);
        check(crc32(b.subarray(p + 4, p + 8 + n)) === b.readUInt32BE(p + 8 + n), "PNG checksum mismatch.");
        if (name === "IHDR") {
            check(p === 8 && n === 13, "Invalid PNG header."); width = bytes.readUInt32BE(); height = bytes.readUInt32BE(4); dimensions(width, height);
            type = bytes[9]; bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[type];
            check(bytes[8] === 8 && bpp && bytes[10] === 0 && bytes[11] === 0 && bytes[12] === 0, "Save edited PNGs as non-interlaced 8-bit RGB/RGBA (or 8-bit indexed/grayscale).");
        } else if (name === "PLTE") palette = bytes;
        else if (name === "tRNS") alpha = bytes;
        else if (name === "IDAT") { check(bpp, "PNG image data precedes its header."); compressed.push(bytes); }
        else if (name === "IEND") { check(n === 0, "Invalid PNG end marker."); ended = true; check(p + 12 === b.length, "Data after PNG end marker."); break; }
        else check(name !== "acTL" && name !== "fcTL" && name !== "fdAT" && name[0] === name[0].toLowerCase(), "Unsupported critical PNG chunk: " + name);
        p += n + 12;
    }
    check(ended && compressed.length, "Incomplete PNG.");
    const stride = width * bpp, expected = height * (stride + 1), raw = zlib.inflateSync(Buffer.concat(compressed), {maxOutputLength: expected});
    check(raw.length === expected, "PNG decompressed size mismatch.");
    const samples = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]; check(filter <= 4, "Invalid PNG filter.");
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? samples[y * stride + x - bpp] : 0, up = y ? samples[(y - 1) * stride + x] : 0, c = y && x >= bpp ? samples[(y - 1) * stride + x - bpp] : 0;
            const predictor = filter === 1 ? a : filter === 2 ? up : filter === 3 ? Math.floor((a + up) / 2) : filter === 4 ? paeth(a, up, c) : 0;
            samples[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
        }
    }
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const s = i * bpp, d = i * 4; let r, g, blue, a = 255;
        if (type === 6 || type === 2) { r = samples[s]; g = samples[s + 1]; blue = samples[s + 2]; if (type === 6) a = samples[s + 3]; else if (alpha?.length === 6 && r === alpha.readUInt16BE() && g === alpha.readUInt16BE(2) && blue === alpha.readUInt16BE(4)) a = 0; }
        else if (type === 3) { const index = samples[s]; check(palette && index * 3 + 2 < palette.length, "Invalid PNG palette index."); r = palette[index * 3]; g = palette[index * 3 + 1]; blue = palette[index * 3 + 2]; a = alpha?.[index] ?? 255; }
        else { r = g = blue = samples[s]; if (type === 4) a = samples[s + 1]; else if (alpha?.length === 2 && r === alpha.readUInt16BE()) a = 0; }
        data[d] = r; data[d + 1] = g; data[d + 2] = blue; data[d + 3] = a;
    }
    return {width, height, data};
}

function parseSpd(b) {
    range(b, 0, 16); check(b.subarray(0, 4).equals(Buffer.from("SPD\0")) && b.readUInt32LE(4) === b.length, "Unsupported PM4 SPD container.");
    const count = b.readUInt32LE(8); check(count > 0 && count <= 16, "Invalid SPD section count."); range(b, 16, count * 16);
    const sections = [];
    for (let i = 0; i < count; i++) {
        const p = 16 + i * 16, section = {id: b.readUInt32LE(p), size: b.readUInt32LE(p + 4), offset: b.readUInt32LE(p + 8)};
        range(b, section.offset, section.size); check(section.offset >= 16 + count * 16, "SPD section overlaps the directory.");
        check(!sections.some(s => section.offset < s.offset + s.size && section.offset + section.size > s.offset), "Overlapping SPD sections."); sections.push(section);
    }
    const section = sections.find(s => s.id === 1); check(section, "SPD texture section is missing.");
    const t = section.offset; range(b, t, 16);
    check(b.toString("ascii", t, t + 4) === "TIM2" && b[t + 4] === 4 && b[t + 5] === 0, "Unsupported TIM2 revision/alignment.");
    const width = b.readUInt16LE(t + 8), height = b.readUInt16LE(t + 10); dimensions(width, height);
    const columns = Math.ceil(width / 256), rows = Math.ceil(height / 256), pictureCount = b.readUInt16LE(t + 6);
    check(pictureCount === columns * rows, "TIM2 tile count does not match the sheet dimensions.");
    const tiles = []; let p = t + 16;
    for (let i = 0; i < pictureCount; i++) {
        range(b, p, 48); const total = b.readUInt32LE(p), clut = b.readUInt32LE(p + 4), imageSize = b.readUInt32LE(p + 8), headerSize = b.readUInt16LE(p + 12);
        const tw = b.readUInt16LE(p + 20), th = b.readUInt16LE(p + 22), x = Math.floor(i / rows) * 256, y = (i % rows) * 256;
        check(b[p + 19] === 3 && clut === 0 && b.readUInt16LE(p + 14) === 0 && b[p + 17] === 1 && headerSize === 48 && imageSize === tw * th * 4 && total === 48 + imageSize, "Only single-level, uncompressed RGBA32 TIM2 tiles are supported.");
        check(tw === Math.min(256, width - x) && th === Math.min(256, height - y), "Unexpected TIM2 tile order/dimensions.");
        check(((b.readUInt32LE(p + 24) >>> 20) & 63) === 0, "Unsupported TIM2 GS pixel storage format.");
        range(b, p, total); check(p + total <= section.offset + section.size, "TIM2 tile exceeds its SPD section.");
        tiles.push({x, y, width: tw, height: th, offset: p + 48, size: imageSize}); p += total;
    }
    check(p === section.offset + section.size, "Unexpected data after TIM2 tiles."); return {width, height, tiles, sections};
}
function decodeSpd(b) {
    const layout = parseSpd(b), data = Buffer.alloc(layout.width * layout.height * 4);
    for (const tile of layout.tiles) for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
        const src = tile.offset + (y * tile.width + x) * 4, dst = ((tile.y + y) * layout.width + tile.x + x) * 4;
        check(b[src + 3] <= 128, "Unsupported PS2 alpha value above 128.");
        data[dst] = b[src]; data[dst + 1] = b[src + 1]; data[dst + 2] = b[src + 2]; data[dst + 3] = Math.round(b[src + 3] * 255 / 128);
    }
    return {width: layout.width, height: layout.height, data};
}
function rebuildSpd(b, image) {
    const layout = parseSpd(b); check(image.width === layout.width && image.height === layout.height, "Edited PNG dimensions must remain " + layout.width + " x " + layout.height + ".");
    check(image.data.length === image.width * image.height * 4, "RGBA pixel buffer size mismatch."); const output = Buffer.from(b);
    for (const tile of layout.tiles) for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
        const dst = tile.offset + (y * tile.width + x) * 4, src = ((tile.y + y) * image.width + tile.x + x) * 4;
        output[dst] = image.data[src]; output[dst + 1] = image.data[src + 1]; output[dst + 2] = image.data[src + 2]; output[dst + 3] = Math.round(image.data[src + 3] * 128 / 255);
    }
    return output;
}
// Curated interface candidates, not character portraits or scene artwork.
function isImageCandidate(name) { return /^(W_[A-Z0-9_]+|TMENU[0-9A-Z]+|ENTRY[0-9A-Z]+|SCHD\d{2}|HAR\d{2}|ALBUM[123]|MAP0[12][AB]?|EXPLA|LOGO[123])\.SPD$/.test(name); }
module.exports = {parseSpd, decodeSpd, rebuildSpd, encodePng, decodePng, isImageCandidate};
