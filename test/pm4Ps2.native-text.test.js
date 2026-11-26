"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const iconv = require("iconv-lite");
const parser = require("../pm4Ps2.module.js");
const keyboard = require("../pm4Ps2.keyboard.js");
const {keyboardElf} = require("./fixtures.cjs");

const name = "SLPM_659.36";
const dateAt = 0x18c160, promptAt = 0x18ca60;
const date = "%d年%2d月%2d日", prompt = "データをロードしますか？";

test("native UI translation preserves executable slots and composes with the keyboard", t => {
    const original = Buffer.alloc(0x18d300);
    keyboardElf().copy(original);
    for (const [offset, source] of [[dateAt, date], [promptAt, prompt]]) iconv.encode(source, "cp932").copy(original, offset);
    original.fill(0xcc, 0x18ca79, 0x18ca80);
    assert.throws(() => parser.dataset(original, name), /original SLPM/);
    // Use synthetic strings and an in-process stand-in for the retail hash.
    t.mock.method(keyboard, "isOriginalExecutable", b => b === original);
    const extracted = parser.dataset(original, name);
    const row = extracted.data.findIndex(([text]) => text === date);
    assert.equal(extracted.parameters[row][0].maxBytes, 14);
    assert.match(extracted.parameters[row][0].rowInfoText, /daughter and father/);
    assert.deepEqual(parser.rebuildResource(original, name), original);
    const context = extracted.context[extracted.data.findIndex(([text]) => text === prompt)][0];
    const withText = parser.rebuildResource(original, name, {translationPair: {
        [date]: "%d-%02d-%02d", [prompt]: "Read save data?", [context + "\n" + prompt]: "Load save data?"
    }});
    const expected = Buffer.from(original);
    expected.fill(0, dateAt, dateAt + 15).write("%d-%02d-%02d", dateAt, "ascii");
    expected.fill(0, promptAt, promptAt + iconv.encode(prompt, "cp932").length + 1).write("Load save data?", promptAt, "ascii");
    assert.deepEqual(withText, expected);
    const combined = keyboard.patchExecutable(original, false, withText);
    assert.deepEqual(combined.subarray(dateAt), expected.subarray(dateAt));
    assert.notDeepEqual(combined.subarray(0, dateAt), original.subarray(0, dateAt));
    const issues = parser.validateResource(original, name, {translationPair: {
        [date]: "%d-%d-%n", [prompt]: "A very long load confirmation that exceeds the Japanese slot."
    }});
    assert.match(issues[0].message, /three decimal placeholders/);
    assert.match(issues[1].message, /maximum is/);
    assert.match(parser.validateResource(original, name, {translationPair: {[prompt]: "Load\nnow?"}})[0].message, /number of lines/);
    assert.match(parser.validateResource(original, name, {translationPair: {[prompt]: "Load\0now?"}})[0].message, /control characters/);
});
