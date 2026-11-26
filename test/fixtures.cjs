"use strict";
// Original synthetic fixtures. No retail game bytes are distributed.
const iconv = require("iconv-lite");
const {transformString} = require("../pm4Ps2.module.js");
const word = n => {const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;};
const op = (code, value) => Buffer.concat([Buffer.from([code]), word(value)]);
const str = (code, text) => {const b = iconv.encode(text, "cp932"); return Buffer.concat([op(code, b.length), transformString(b, true)]);};
// Header: magic, 0x1B, statement count, symbol count, then per symbol
// [code offset][length][name], then [label count][labels]. Code offsets are
// relative to the byte after the 0x1B that starts the code.
function g2() {
    const header = Buffer.alloc(17); header.write("G2CD0460"); header[8] = 0x1b;
    header.writeUInt32LE(7, 9); header.writeUInt32LE(1, 13);
    const head = [Buffer.from([0x1b]), op(0x20, 1), op(0x20, 2), op(0x21, 3), Buffer.from([6]),
        op(3, 1), str(2, "アリス"), op(5, 0x2100),
        op(0x21, 4), Buffer.from([6]), str(2, "0001"), op(5, 0x1620), str(1, "こんにちは\\n世界 %d"), op(5, 99)];
    const target = Buffer.concat(head).length - 1; // statement 5, after the dialogue
    const code = Buffer.concat([...head,
        op(0x21, 5), str(2, "はい"), op(0x21, 6), str(2, "はい"), str(2, "gd/sys/example.spd"),
        Buffer.from([6]), op(0x13, target), str(2, "menu"), op(5, 0x118f),              // choice handler address
        Buffer.from([6]), op(3, 192), op(3, 350), op(3, 50), op(3, 0), op(5, 0x1011)]); // dialogue window SetRect
    const symbol = Buffer.concat([word(0), word(4), transformString(Buffer.from("MAIN"), true)]);
    return Buffer.concat([header, symbol, word(1), word(target), code]);
}
// A script spanning several sectors, with a jump over all of its dialogue.
function longG2(count = 50) {
    const header = Buffer.alloc(17); header.write("G2CD0460"); header[8] = 0x1b;
    const parts = [Buffer.from([0x1b]), op(0x20, 1), op(0x20, 2), op(7, 0)];
    let statement = 2;
    for (let i = 0; i < count; i++) parts.push(op(0x21, ++statement), str(1, "長い台詞その" + i + "\\nもう一行の台詞です。"));
    const end = Buffer.concat(parts).length - 1;
    parts.push(op(0x21, ++statement), Buffer.from([0x0e]));
    const code = Buffer.concat(parts); code.writeUInt32LE(end, 12);
    header.writeUInt32LE(statement + 1, 9);
    return Buffer.concat([header, word(1), word(end), code]);
}
function dirRecord(name, lba, size, directory = false) {
    const id = Buffer.from(name), n = 33 + id.length + (id.length % 2 ? 0 : 1), b = Buffer.alloc(n);
    b[0] = n; b.writeUInt32LE(lba, 2); b.writeUInt32BE(lba, 6); b.writeUInt32LE(size, 10); b.writeUInt32BE(size, 14);
    b[25] = directory ? 2 : 0; b.writeUInt16LE(1, 28); b.writeUInt16BE(1, 30); b[32] = id.length; id.copy(b, 33); return b;
}
function filesystem(buffer, base, files) {
    const sector = 2048, root = 20, pvd = base + 16 * sector;
    Buffer.from([1, 67, 68, 48, 48, 49, 1]).copy(buffer, pvd);
    buffer.writeUInt16LE(sector, pvd + 128); buffer.writeUInt16BE(sector, pvd + 130);
    dirRecord("\x00", root, sector, true).copy(buffer, pvd + 156);
    let p = base + root * sector;
    for (const f of files) {const r = dirRecord(f.name + ";1", f.lba, f.bytes.length); r.copy(buffer, p); p += r.length; f.bytes.copy(buffer, base + f.lba * sector);}
}
function iso(options = {}) {
    const b = Buffer.alloc((options.keyboard ? 1700 : 160) * 2048, 0), cvm = Buffer.alloc((options.keyboard ? 1600 : 100) * 2048);
    cvm.write("CVMH");
    // longRoom: a multi-sector ROOM.G2 followed by a debug TEST.G2 (unless noTestScript).
    const files = [
        options.longRoom ? {name: "ROOM.G2", lba: 40, bytes: longG2()} : {name: "ROOM.G2", lba: 24, bytes: g2()},
        {name: "PRIME4.G2", lba: 25, bytes: g2()},
        {name: "ITEM_NAM.TXT", lba: 26, bytes: iconv.encode("\r\n剣\r\n盾\r\n", "cp932")},
        {name: "ITEM_MSG.TXT", lba: 27, bytes: iconv.encode("\r\n強い剣\r\n強い盾\r\n", "cp932")}
    ];
    if (options.longRoom && !options.noTestScript) files.push({name: "TEST.G2", lba: 42, bytes: Buffer.alloc(6 * 2048, 0x33)});
    if (options.images) files.push({name: "W_STAT1.SPD", lba: 30, bytes: spd(260, 8)});
    if (options.artwork) files.push({name: "EV01.SPD", lba: 36, bytes: spd(32, 32)});
    if (options.keyboard) files.push({name: "ENTRY2A.SPD", lba: 60, bytes: spd(640, 448)}, {name: "ENTRY2B.SPD", lba: 630, bytes: spd(640, 448)});
    filesystem(cvm, 0x1800, files);
    const outer = [{name: "SYSTEM.CNF", lba: 22, bytes: Buffer.from("BOOT2 = cdrom0:\\SLPM_659.36;1\r\n")}, {name: "DATA.BIN", lba: 24, bytes: cvm}];
    if (options.keyboard) outer.push({name: "SLPM_659.36", lba: 1640, bytes: keyboardElf()});
    filesystem(b, 0, outer);
    b.fill(0x5a, (options.keyboard ? 1690 : 150) * 2048); // unrelated bytes must survive exports
    return b;
}
// Control-flow/name fixtures use explicit statements and labels, not game bytes.
function speakerG2() {
    const chunks = [Buffer.from([0x1b]), op(0x20, 1), op(0x20, 2)], labels = {}, fixups = [];
    let statement = 2, length = 11;
    function add(...bytes) { for (const b of bytes) { chunks.push(b); length += b.length; } }
    function stmt(...bytes) { add(op(0x21, ++statement), ...bytes); }
    function name(text) { stmt(Buffer.from([6]), op(3, 1), str(2, text), op(5, 0x2100)); }
    function jump(opcode, label) { fixups.push({offset: length + 1, label}); add(op(opcode, 0)); }
    name("アリス");
    stmt(Buffer.from([6]), str(2, "0001"), op(5, 0x1620), str(1, "最初の台詞"));
    stmt(str(2, "はい")); stmt(str(1, "続きの台詞"));
    stmt(op(5, 99), str(1, "不明な台詞"));
    name("ボブ"); stmt(Buffer.from([6]), op(3, 1), op(0x42, 2), op(5, 0x2100));
    stmt(str(1, "名前は実行時"));
    stmt(Buffer.from([6]), op(3, 1), op(0x42, 3), op(5, 0x2100)); stmt(str(1, "父の台詞"));
    stmt(Buffer.from([6]), op(3, 1), op(0x42, 99), op(5, 0x2100)); stmt(str(1, "未知の変数"));
    stmt(Buffer.from([6]), op(3, 0), op(5, 0x2100)); stmt(str(1, "地の文"));
    name("アリス"); stmt(op(0x0a, 0), str(1, "呼出し後"));
    name("アリス"); stmt();
    jump(8, "join");
    name("ボブ"); labels.join = length; stmt(str(1, "分岐の合流"));
    name("アリス"); stmt();
    jump(8, "same");
    labels.same = length; stmt(str(1, "同じ名前の合流"));

    stmt(Buffer.from([6]), op(3, 1), op(0x42, 2), op(5, 0x2100));
    stmt(str(1, "立ち絵の前"), op(5, 0x1105)); jump(0x0a, "portrait");
    stmt(str(1, "立ち絵の後"), op(5, 0x1105), op(5, 0x1502), str(1, "同じ話者の続き"));
    jump(0x0a, "maybeClear");
    stmt(str(1, "名前が消える可能性"), Buffer.from([0x0e]));

    labels.portrait = length;
    stmt(); jump(0x0a, "spritePath"); add(op(5, 0x1501), Buffer.from([0x0e]));
    labels.spritePath = length;
    stmt(); jump(7, "formatPath");
    name("ボブ"); // Unreachable through the unconditional jump.
    labels.formatPath = length;
    stmt(op(5, 0x1809), Buffer.from([0x0e]));
    labels.maybeClear = length;
    stmt(); jump(8, "end"); jump(0x0a, "clear");
    labels.end = length;
    add(Buffer.from([0x0e]));
    labels.clear = length;
    stmt(Buffer.from([6]), op(3, 0), op(5, 0x2100), Buffer.from([0x0e]));
    const code = Buffer.concat(chunks);
    for (const f of fixups) code.writeUInt32LE(labels[f.label] - 1, f.offset);
    const header = Buffer.alloc(21); header.write("G2CD0460"); header[8] = 0x1b; header.writeUInt32LE(statement + 1, 9);
    return Buffer.concat([header, word(0), code]);
}
function spd(width = 517, height = 300) {
    const columns = Math.ceil(width / 256), rows = Math.ceil(height / 256), pictures = [];
    for (let x = 0; x < columns; x++) for (let y = 0; y < rows; y++) {
        const w = Math.min(256, width - x * 256), h = Math.min(256, height - y * 256), picture = Buffer.alloc(48 + w * h * 4);
        picture.writeUInt32LE(picture.length); picture.writeUInt32LE(w * h * 4, 8); picture.writeUInt16LE(48, 12);
        picture[17] = 1; picture[19] = 3; picture.writeUInt16LE(w, 20); picture.writeUInt16LE(h, 22);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            const p = 48 + (yy * w + xx) * 4, sx = x * 256 + xx, sy = y * 256 + yy;
            picture[p] = sx % 256; picture[p + 1] = sy % 256; picture[p + 2] = (sx + sy) % 256; picture[p + 3] = (sx + sy) % 129;
        }
        pictures.push(picture);
    }
    const tim = Buffer.alloc(16); tim.write("TIM2"); tim[4] = 4; tim.writeUInt16LE(pictures.length, 6); tim.writeUInt16LE(width, 8); tim.writeUInt16LE(height, 10);
    const textures = Buffer.concat([tim, ...pictures]), container = Buffer.alloc(48); container.write("SPD\0"); container.writeUInt32LE(48 + textures.length + 32, 4); container.writeUInt32LE(2, 8);
    container.writeUInt32LE(1, 16); container.writeUInt32LE(textures.length, 20); container.writeUInt32LE(48, 24);
    container.writeUInt32LE(2, 32); container.writeUInt32LE(32, 36); container.writeUInt32LE(48 + textures.length, 40);
    return Buffer.concat([container, textures, Buffer.alloc(32, 0x5a)]);
}
function keyboardElf() {
    const keyboard = require("../pm4Ps2.keyboard.js"), b = Buffer.alloc(1024, 0x55);
    Buffer.from([0x7f, 69, 76, 70, 1, 1, 1]).copy(b); b.writeUInt16LE(8, 18);
    keyboard.tableBytes(keyboard.HIRAGANA).copy(b, 256); keyboard.tableBytes(keyboard.KATAKANA).copy(b, 480);
    iconv.encode("ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ", "cp932").copy(b, 704);
    iconv.encode("ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ", "cp932").copy(b, 768);
    iconv.encode("０１２３４５６７８９", "cp932").copy(b, 832); return b;
}
module.exports = {g2, longG2, iso, speakerG2, spd, keyboardElf};
