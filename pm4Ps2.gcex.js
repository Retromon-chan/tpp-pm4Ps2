"use strict";
// GCEX archives of the Japanese PC release (Gainax / CyberFront, 2005): the
// game folder's `script` (text and bytecode) and `data`/`gd` (pictures).
// Portable: plain Node.js, no Translator++ globals.
//
//   +0x00 "GCEX"  +0x08 u64 index offset  +0x10 entry data, back to back
//   index: "GCE3", u32 flags, u32 index size, ..., +0x14 crc32 of the index
//   with this field zeroed, +0x18 u32 entry count, then 32-byte records
//   (+0x10 u64 unpacked size, +0x18 u64 stored size), then the names as
//   [u16 length][bytes]. Entry offsets are the running total of stored sizes.
//
// With index flag 0x10 (as in `script`) every entry is a chain of blocks:
// "GCE0" [u32 n][n bytes] stored, or "GCE1" [u32 unpacked][u32 0][u32 literal
// bytes][u32 literal bytes][u32 control bytes] compressed (LZP). The game
// reads each block into a 0x40020-byte buffer and stops when the blocks add
// up to exactly the unpacked size. Without the flag (`data`) entries are raw.
const BLOCK_MAX = 0x40020, CHUNK = 0x40000, DATA_START = 0x10, RECORD = 32, CHAINED = 0x10;

function check(condition, message) { if (!condition) throw new Error(message); }
const CRC_TABLE = Array.from({length: 256}, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
function crc32(b) {
    let crc = 0xffffffff;
    for (const v of b) crc = CRC_TABLE[(crc ^ v) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function indexCrc(index) { const copy = Buffer.from(index); copy.writeUInt32LE(0, 0x14); return crc32(copy); }
function u64(b, p) { const v = b.readBigUInt64LE(p); check(v <= BigInt(Number.MAX_SAFE_INTEGER), "Invalid GCEX size."); return Number(v); }

function parseArchive(b) {
    check(b.length >= 0x30 && b.subarray(0, 4).toString("latin1") === "GCEX", "Not a GCEX archive.");
    const indexOffset = u64(b, 8);
    check(indexOffset >= DATA_START && indexOffset + 0x20 <= b.length, "The GCEX archive is truncated.");
    check(b.subarray(indexOffset, indexOffset + 4).toString("latin1") === "GCE3", "Unsupported GCEX index (expected GCE3).");
    const flags = b.readUInt32LE(indexOffset + 4), indexSize = b.readUInt32LE(indexOffset + 8);
    check(indexOffset + indexSize === b.length, "The GCEX index does not end the archive.");
    const index = b.subarray(indexOffset), count = index.readUInt32LE(0x18);
    check(count > 0 && count < 100000 && 0x20 + count * RECORD <= indexSize, "Invalid GCEX entry count.");
    check(indexCrc(index) === index.readUInt32LE(0x14), "The GCEX index checksum does not match.");
    const entries = [];
    let names = 0x20 + count * RECORD, offset = DATA_START;
    for (let i = 0; i < count; i++) {
        const record = index.subarray(0x20 + i * RECORD, 0x40 + i * RECORD);
        check(names + 2 <= indexSize, "Truncated GCEX name table.");
        const length = index.readUInt16LE(names); check(names + 2 + length <= indexSize, "Truncated GCEX name table.");
        const name = index.subarray(names + 2, names + 2 + length).toString("latin1"); names += 2 + length;
        check(/^[\x21-\x7e]+$/.test(name), "Invalid GCEX entry name.");
        const stored = u64(record, 0x18), unpacked = u64(record, 0x10);
        check(offset + stored <= indexOffset, "GCEX entry " + name + " runs past the index.");
        entries.push({name, offset, stored, unpacked, record});
        offset += stored;
    }
    check(offset === indexOffset && names === indexSize, "GCEX entries and index do not line up.");
    return {flags, chained: Boolean(flags & CHAINED), indexOffset, header: index.subarray(0, 0x20), names: index.subarray(0x20 + count * RECORD), entries};
}

// Elias-gamma-like codes, MSB first: k zero bits, a one, then k-1 more bits.
function decodeLzp(literals, control, size) {
    const out = Buffer.alloc(size), table = new Int32Array(65536).fill(-1);
    let n = 0, h = 0, li = 0, cp = 0, current = 0, available = 0;
    function bit() {
        if (!available) { check(cp < control.length, "The compressed GCE1 control stream ended early."); current = control[cp++]; available = 8; }
        return (current >> --available) & 1;
    }
    function gamma() {
        let k = 0; while (k < 32 && !bit()) k++;
        if (k <= 1) return k;
        let v = 1; for (let i = 1; i < k; i++) v = v * 2 + bit();
        return v;
    }
    function put(v) { check(n < size, "A GCE1 block unpacks past its size."); table[h] = n; out[n++] = v; h = ((h & 255) << 8) | v; }
    if (!size) return out;
    for (;;) {
        for (let run = gamma(); run > 0; run--) { check(li < literals.length, "The compressed GCE1 literal stream ended early."); put(literals[li++]); }
        if (n >= size) break;
        let pos = table[h]; check(pos >= 0 && pos < n, "Damaged GCE1 block: a match points at missing data.");
        for (let length = gamma() + 1; length > 0; length--) put(out[pos++]);
        if (n >= size) break;
    }
    return out;
}
function block(b, p) {
    check(p + 8 <= b.length, "Truncated GCEX block.");
    const magic = b.subarray(p, p + 4).toString("latin1");
    if (magic === "GCE0") {
        const n = b.readUInt32LE(p + 4); check(p + 8 + n <= b.length, "Truncated GCE0 block.");
        return {size: 8 + n, unpacked: n, data: () => b.subarray(p + 8, p + 8 + n)};
    }
    check(magic === "GCE1" && p + 0x18 <= b.length, "Unknown GCEX block " + JSON.stringify(magic) + ".");
    const unpacked = b.readUInt32LE(p + 4), literalSize = b.readUInt32LE(p + 12), controlSize = b.readUInt32LE(p + 20);
    const start = p + 0x18; check(start + literalSize + controlSize <= b.length, "Truncated GCE1 block.");
    return {size: 0x18 + literalSize + controlSize, unpacked,
        data: () => decodeLzp(b.subarray(start, start + literalSize), b.subarray(start + literalSize, start + literalSize + controlSize), unpacked)};
}
// Unpacks one entry the way the game's chain loop does.
function unpackEntry(b, archive, entry) {
    const stored = b.subarray(entry.offset, entry.offset + entry.stored);
    if (!archive.chained) { check(entry.stored === entry.unpacked, "Raw GCEX entry sizes disagree: " + entry.name); return Buffer.from(stored); }
    const parts = []; let p = 0, total = 0;
    while (total < entry.unpacked) {
        const next = block(stored, p);
        check(next.unpacked > 0 && next.unpacked <= BLOCK_MAX, "Invalid GCEX block size in " + entry.name + ".");
        const data = next.data(); check(data.length === next.unpacked, "GCEX block size mismatch in " + entry.name + ".");
        parts.push(data); total += data.length; p += next.size;
    }
    check(total === entry.unpacked && p === entry.stored, "GCEX blocks of " + entry.name + " do not add up to its sizes.");
    return Buffer.concat(parts);
}
// Stored GCE0 blocks; the game accepts them in place of compressed ones.
function storedBlocks(data) {
    check(data.length > 0, "Cannot store an empty GCEX entry.");
    const parts = [];
    for (let p = 0; p < data.length; p += CHUNK) {
        const piece = data.subarray(p, p + CHUNK), head = Buffer.alloc(8);
        head.write("GCE0", "latin1"); head.writeUInt32LE(piece.length, 4); parts.push(head, piece);
    }
    return Buffer.concat(parts);
}
// replacements: Map(entry name -> new unpacked bytes). Other entries are copied
// byte for byte; the index gets the new sizes and checksum.
function buildArchive(b, replacements = new Map()) {
    const archive = parseArchive(b);
    for (const name of replacements.keys()) check(archive.entries.some(e => e.name === name), "Unknown GCEX entry: " + name);
    check(!replacements.size || archive.chained, "This GCEX archive stores raw entries; only block archives can be rebuilt.");
    const bodies = [], records = [];
    for (const entry of archive.entries) {
        const data = replacements.get(entry.name);
        const body = data ? storedBlocks(data) : b.subarray(entry.offset, entry.offset + entry.stored);
        const record = Buffer.from(entry.record);
        if (data) { record.writeBigUInt64LE(BigInt(data.length), 0x10); record.writeBigUInt64LE(BigInt(body.length), 0x18); }
        bodies.push(body); records.push(record);
    }
    const index = Buffer.concat([archive.header, ...records, archive.names]);
    index.writeUInt32LE(indexCrc(index), 0x14);
    const head = Buffer.alloc(DATA_START); head.write("GCEX", "latin1");
    head.writeBigUInt64LE(BigInt(DATA_START + bodies.reduce((total, body) => total + body.length, 0)), 8);
    return Buffer.concat([head, ...bodies, index]);
}
module.exports = {parseArchive, unpackEntry, buildArchive, storedBlocks, decodeLzp, crc32, BLOCK_MAX, CHUNK};
