"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), iconv = require("iconv-lite");
const codec = require("./pm4Ps2.images.js");
const HIRAGANA = ["あかさたなはまやらわがざだばぱ", "いきしちにひみゆりをぎじぢびぴ", "うくすつぬふむよるんぐずづぶぷ", "えけせてねへめ　れ　げぜでべぺ", "おこそとのほも　ろ　ごぞどぼぽ", "ぁぃぅぇぉっゃゅょ　－　　　　"];
const KATAKANA = ["アカサタナハマヤラワガザダバパ", "イキシチニヒミユリヲギジヂビピ", "ウクスツヌフムヨルングズヅブプ", "エケセテネヘメ　レ　ゲゼデベペ", "オコソトノホモ　ロヴゴゾドボポ", "ァィゥェォッャュョ　－　　　　"];
const PAGES = [
    ["ABCDEFGHIJKLMNO", "PQRSTUVWXYZ", "0123456789", "-'.", "", ""],
    ["abcdefghijklmno", "pqrstuvwxyz", "0123456789", "-'.", "", ""]
];
const RESOURCES = ["SLPM_659.36", "ENTRY2A.SPD", "ENTRY2B.SPD"];
const NAME_PROMPT = "ENTRY5.SPD";
const ORIGINAL_ELF = "c673ed7fedf9e1532279c86728a11da8ac7422c1f864e5ddbd6256dcf620c4b3";
const ELF_ADDRESS_BASE = 0xfff80;
const LONG_NAME_INSTRUCTIONS = [
    // Keep the same 12-byte budget on both screens and after advancing focus.
    [0x1efb28, 0x28810006, 0x2881000c], [0x1f03e8, 0x28810006, 0x2881000c],
    [0x1efbb4, 0x00031842, 0x2c63000c], [0x1f0474, 0x00031842, 0x2c63000c],
    [0x1efbbc, 0x1064038b, 0x1060038b], [0x1f047c, 0x106401d1, 0x106001d1],
    // Count and delete ASCII bytes. Skip the second append from each key slot.
    [0x1ed228, 0x00021042, 0], [0x1ed2c4, 0x00021042, 0],
    [0x1efe30, 0x00023840, 0x0040382d], [0x1f06f0, 0x00023840, 0x0040382d],
    [0x1f09d4, 0x00102e3c, 0x10000003], [0x1f09d8, 0x262400cc, 0],
    [0x1f0bac, 0x00102e3c, 0x10000003], [0x1f0bb0, 0x262400c0, 0],
    // Disable the six original underlines and give the two name previews room.
    [0x1ed39c, 0x38a50001, 0x0000282d], [0x1ec97c, 0x2405001e, 0x24050018]
];
function check(ok, message) { if (!ok) throw new Error(message); }
function isOriginalExecutable(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex") === ORIGINAL_ELF;
}
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
function inspectExecutable(buffer, longNames = false) {
    check(buffer.length >= 52 && buffer.subarray(0, 7).equals(Buffer.from([0x7f, 69, 76, 70, 1, 1, 1])) && buffer.readUInt16LE(18) === 8, "English keyboard requires the supported PS2 MIPS ELF executable.");
    const tables = [HIRAGANA, KATAKANA].map(rows => {
        const bytes = tableBytes(rows), offset = buffer.indexOf(bytes);
        check(offset >= 0 && buffer.indexOf(bytes, offset + 1) === -1, "Original PS2 kana keyboard table is missing or ambiguous. English keyboard was not applied.");
        return {offset, size: bytes.length};
    });
    check(tables[0].offset + tables[0].size <= tables[1].offset || tables[1].offset + tables[1].size <= tables[0].offset, "Keyboard tables overlap.");
    // The full-width option uses the existing Latin glyph map.
    for (const text of ["ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ", "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ", "０１２３４５６７８９"]) {
        check(buffer.includes(iconv.encode(text, "cp932")), "Expected Latin character map is missing from the PS2 executable.");
    }
    if (longNames) {
        check(isOriginalExecutable(buffer),
            "12-character names require the original SLPM_659.36 executable.");
        for (const [address, original] of LONG_NAME_INSTRUCTIONS) {
            check(buffer.readUInt32LE(address - ELF_ADDRESS_BASE) === original, "Unexpected name-entry instruction at 0x" + address.toString(16) + ".");
        }
    }
    return {tables};
}
function patchExecutable(buffer, longNames = false, current = buffer) {
    const {tables} = inspectExecutable(buffer, longNames), output = Buffer.from(current);
    for (let page = 0; page < 2; page++) tableBytes(PAGES[page], true).copy(output, tables[page].offset);
    if (longNames) {
        for (const [page, rows] of PAGES.entries()) {
            for (const [row, keys] of rows.entries()) {
                for (let col = 0; col < keys.length; col++) {
                    const offset = tables[page].offset + row * 32 + col * 2;
                    output[offset] = keys.charCodeAt(col);
                    output[offset + 1] = 0x40;
                }
            }
        }
        for (const [address, , value] of LONG_NAME_INSTRUCTIONS) output.writeUInt32LE(value, address - ELF_ADDRESS_BASE);
    }
    return output;
}
const PAPER_DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
function repairPaper(image, paper, rect) {
    // Remove dark lettering and its antialiased edges. Sample the surrounding
    // parchment at each glyph so empty areas keep their original grain.
    const {data, width} = image;
    const mask = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const offset = ((rect.y + y) * width + rect.x + x) * 4;
            if (data[offset + 1] >= 130 && paper.data[offset + 1] >= 130) continue;
            for (let dy = Math.max(0, y - 3); dy <= Math.min(rect.height - 1, y + 3); dy++) {
                mask.fill(1, dy * rect.width + Math.max(0, x - 3), dy * rect.width + Math.min(rect.width, x + 4));
            }
        }
    }
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            if (!mask[y * rect.width + x]) continue;
            const offset = ((rect.y + y) * width + rect.x + x) * 4;
            let red = 0, green = 0, blue = 0, total = 0;
            for (const [dx, dy] of PAPER_DIRECTIONS) {
                for (let distance = 1; distance <= 48; distance++) {
                    const sx = x + dx * distance, sy = y + dy * distance;
                    if (sx >= 0 && sx < rect.width && sy >= 0 && sy < rect.height && mask[sy * rect.width + sx]) continue;
                    const sample = ((rect.y + sy) * width + rect.x + sx) * 4;
                    const weight = 1 / (distance * (dx && dy ? Math.SQRT2 : 1));
                    red += data[sample] * weight;
                    green += data[sample + 1] * weight;
                    blue += data[sample + 2] * weight;
                    total += weight;
                    break;
                }
            }
            data[offset] = Math.round(red / total);
            data[offset + 1] = Math.round(green / total);
            data[offset + 2] = Math.round(blue / total);
        }
    }
}
function patchKeyboardSheet(original, current, page) {
    check(page === 0 || page === 1, "Invalid English keyboard page.");
    const paper = codec.decodeSpd(original), image = codec.decodeSpd(current);
    check(paper.width === 640 && paper.height === 448 && image.width === 640 && image.height === 448, "English keyboard requires the original 640 x 448 name-entry sheets.");
    for (let row = 0; row < 6; row++) for (let col = 0; col < 15; col++) repairPaper(image, paper, {x: 68 + col * 36 - 15, y: 168 + row * 36 - 15, width: 30, height: 30});
    for (const rect of [{x: 61, y: 375, width: 110, height: 30}, {x: 197, y: 375, width: 110, height: 30}, {x: 343, y: 375, width: 86, height: 30}, {x: 485, y: 375, width: 88, height: 30}]) {
        // Older caption edits can bake a flat strip behind the text. Restore
        // these four small regions before removing the original lettering.
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            const start = (y * image.width + rect.x) * 4;
            paper.data.copy(image.data, start, start, start + rect.width * 4);
        }
        repairPaper(image, paper, rect);
    }
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
function patchNamePrompts(current) {
    const image = codec.decodeSpd(current);
    const prompts = codec.decodePng(fs.readFileSync(path.join(__dirname, "res", "long-name-prompts.png")));
    check(image.width === 456 && image.height === 496 && prompts.width === 456 && prompts.height === 72,
        "12-character names require the original name prompt sheet layout.");
    prompts.data.copy(image.data);
    return codec.rebuildSpd(current, image);
}
function usesLongNames(options = {}) { return (options.custom?.pm4LongEnglishNames ?? options.longEnglishNames) === true; }
function isEnabled(options = {}) { return usesLongNames(options) || (options.custom?.pm4EnglishKeyboard ?? options.englishKeyboard) === true; }
function resources(longNames) { return longNames ? [...RESOURCES, NAME_PROMPT] : RESOURCES; }
function injectOptionFields() {
    return {
        schema: {pm4EnglishKeyboard: {type: "boolean", title: "English name-entry keyboard", default: false,
            description: "Use uppercase and lowercase English letters, numbers and punctuation, with up to six full-width characters per field."},
            pm4LongEnglishNames: {type: "boolean", title: "12-character English names", default: false,
                description: "Enable the English keyboard with up to 12 half-width characters in the surname and given name."}},
        form: [{key: "pm4EnglishKeyboard", fieldHtmlClass: "flipSwitch", inlinetitle: "Enable English keyboard"},
            {key: "pm4LongEnglishNames", fieldHtmlClass: "flipSwitch", inlinetitle: "Allow 12 half-width characters per name field"}]
    };
}
module.exports = {HIRAGANA, KATAKANA, PAGES, RESOURCES, NAME_PROMPT, nativeLetter, tableBytes, inspectExecutable, isOriginalExecutable, patchExecutable,
    patchKeyboardSheet, patchNamePrompts, resources, isEnabled, usesLongNames, injectOptionFields};
