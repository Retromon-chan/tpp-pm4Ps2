"use strict";
const fs = require("fs"), path = require("path"), iconv = require("iconv-lite");
const codec = require("./pm4Ps2.images.js");
const HIRAGANA = ["あかさたなはまやらわがざだばぱ", "いきしちにひみゆりをぎじぢびぴ", "うくすつぬふむよるんぐずづぶぷ", "えけせてねへめ　れ　げぜでべぺ", "おこそとのほも　ろ　ごぞどぼぽ", "ぁぃぅぇぉっゃゅょ　－　　　　"];
const KATAKANA = ["アカサタナハマヤラワガザダバパ", "イキシチニヒミユリヲギジヂビピ", "ウクスツヌフムヨルングズヅブプ", "エケセテネヘメ　レ　ゲゼデベペ", "オコソトノホモ　ロヴゴゾドボポ", "ァィゥェォッャュョ　－　　　　"];
const PAGES = [
    ["ABCDEFGHIJKLMNO", "PQRSTUVWXYZ", "0123456789", "-'.", "", ""],
    ["abcdefghijklmno", "pqrstuvwxyz", "0123456789", "-'.", "", ""]
];
const RESOURCES = ["SLPM_659.36", "ENTRY2A.SPD", "ENTRY2B.SPD"];
function check(ok, message) { if (!ok) throw new Error(message); }
function nativeLetter(letter) {
    if (!letter) return "　";
    if (letter === "'") return "’";
    return String.fromCharCode(letter.charCodeAt(0) + 0xfee0);
}
function tableBytes(rows, english = false) {
    const buffer = Buffer.alloc(6 * 32);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 15; col++) {
        const text = english ? nativeLetter(rows[row][col]) : rows[row][col];
        check(text, "Invalid keyboard table dimensions."); const bytes = iconv.encode(text, "cp932");
        check(bytes.length === 2 && iconv.decode(bytes, "cp932") === text, "Keyboard character cannot be represented as two-byte CP932: " + text);
        bytes.copy(buffer, row * 32 + col * 2);
    }
    return buffer;
}
function inspectExecutable(buffer) {
    check(buffer.length >= 52 && buffer.subarray(0, 7).equals(Buffer.from([0x7f, 69, 76, 70, 1, 1, 1])) && buffer.readUInt16LE(18) === 8, "English keyboard requires the supported PS2 MIPS ELF executable.");
    const tables = [HIRAGANA, KATAKANA].map(rows => {
        const bytes = tableBytes(rows), offset = buffer.indexOf(bytes);
        check(offset >= 0 && buffer.indexOf(bytes, offset + 1) === -1, "Original PS2 kana keyboard table is missing or ambiguous. English keyboard was not applied.");
        return {offset, size: bytes.length};
    });
    check(tables[0].offset + tables[0].size <= tables[1].offset || tables[1].offset + tables[1].size <= tables[0].offset, "Keyboard tables overlap.");
    // The game's CP932 character map includes the full-width Latin alphabets.
    // Keep its two-byte input representation; do not insert zero/ASCII bytes
    // into a fixed-width character slot or reuse the PC edition's font workaround.
    for (const text of ["ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ", "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ", "０１２３４５６７８９"]) {
        check(buffer.includes(iconv.encode(text, "cp932")), "Expected Latin character map is missing from the PS2 executable.");
    }
    return {tables};
}
function patchExecutable(buffer) {
    const {tables} = inspectExecutable(buffer), output = Buffer.from(buffer);
    for (let page = 0; page < 2; page++) tableBytes(PAGES[page], true).copy(output, tables[page].offset);
    return output;
}
function repairPaper(target, source, rect) {
    // Borrow an original empty key cell, level each scanline to the target's
    // clean left/right border, and feather the seams. No original art is shipped.
    const sample = {x: 305, y: 259, width: 30, height: 30};
    const {width, height} = source;
    check(rect.x > 0 && rect.y >= 0 && rect.x + rect.width < width && rect.y + rect.height <= height, "Keyboard mask is outside the sheet.");
    for (let y = 0; y < rect.height; y++) {
        const sy = sample.y + y % sample.height, ty = rect.y + y;
        for (let x = 0; x < rect.width; x++) {
            const sx = sample.x + x % sample.width, dst = (ty * width + rect.x + x) * 4, src = (sy * width + sx) * 4;
            const feather = Math.min(1, (x + 1) / 3, (rect.width - x) / 3, (y + 1) / 3, (rect.height - y) / 3);
            for (let c = 0; c < 3; c++) {
                const left = source.data[(ty * width + rect.x - 1) * 4 + c], right = source.data[(ty * width + rect.x + rect.width) * 4 + c];
                const sampleAverage = (source.data[(sy * width + sample.x) * 4 + c] + source.data[(sy * width + sample.x + sample.width - 1) * 4 + c]) / 2;
                const clean = Math.max(0, Math.min(255, source.data[src + c] + (left + right) / 2 - sampleAverage));
                const border = left + (right - left) * (x + 1) / (rect.width + 1);
                target.data[dst + c] = Math.round(clean * feather + border * (1 - feather));
            }
            target.data[dst + 3] = source.data[src + 3];
        }
    }
}
function patchKeyboardSheet(original, current, page) {
    check(page === 0 || page === 1, "Invalid English keyboard page.");
    const paper = codec.decodeSpd(original), image = codec.decodeSpd(current);
    check(paper.width === 640 && paper.height === 448 && image.width === 640 && image.height === 448, "English keyboard requires the original 640 x 448 name-entry sheets.");
    for (let row = 0; row < 6; row++) for (let col = 0; col < 15; col++) repairPaper(image, paper, {x: 68 + col * 36 - 15, y: 168 + row * 36 - 15, width: 30, height: 30});
    for (const rect of [{x: 61, y: 375, width: 110, height: 30}, {x: 197, y: 375, width: 110, height: 30}, {x: 343, y: 375, width: 86, height: 30}, {x: 485, y: 375, width: 88, height: 30}]) repairPaper(image, paper, rect);
    const overlay = codec.decodePng(fs.readFileSync(path.join(__dirname, "res", page ? "keyboard-lowercase.png" : "keyboard-uppercase.png")));
    check(overlay.width === image.width && overlay.height === image.height, "English keyboard overlay dimensions are invalid.");
    for (let p = 0; p < image.data.length; p += 4) {
        const alpha = overlay.data[p + 3] / 255; if (!alpha) continue;
        const oldAlpha = image.data[p + 3] / 255, outAlpha = alpha + oldAlpha * (1 - alpha);
        for (let c = 0; c < 3; c++) image.data[p + c] = Math.round((overlay.data[p + c] * alpha + image.data[p + c] * oldAlpha * (1 - alpha)) / outAlpha);
        image.data[p + 3] = Math.round(outAlpha * 255);
    }
    return codec.rebuildSpd(current, image);
}
function isEnabled(options = {}) { return (options.custom?.pm4EnglishKeyboard ?? options.englishKeyboard) === true; }
function injectOptionFields() {
    return {
        schema: {pm4EnglishKeyboard: {type: "boolean", title: "English name-entry keyboard", default: false,
            description: "Replace kana keys with uppercase/lowercase English letters, numbers and punctuation. Names use full-width Latin characters. The existing name-length limit stays the same."}},
        form: [{key: "pm4EnglishKeyboard", fieldHtmlClass: "flipSwitch", inlinetitle: "Enable English keyboard"}]
    };
}
module.exports = {HIRAGANA, KATAKANA, PAGES, RESOURCES, nativeLetter, tableBytes, inspectExecutable, patchExecutable, patchKeyboardSheet, isEnabled, injectOptionFields};
