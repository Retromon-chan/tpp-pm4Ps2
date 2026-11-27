"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Worker} = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {g2, longG2, iso, speakerG2, pagedG2} = require("./fixtures.cjs");
const parser = require("../pm4Ps2.module.js");
const guidance = require("../pm4Ps2.guidance.js");
// Fixture layout: DATA.BIN at outer sector 24, embedded image at +0x1800, root directory at its sector 20.
const ROOT_DIRECTORY = 24 * 2048 + 0x1800 + 20 * 2048;
function assertOnlyChanged(before, after, ranges) {
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
        if (before[i] !== after[i] && !ranges.some(([start, size]) => i >= start && i < start + size)) {
            assert.fail("unexpected change at ISO offset " + i);
        }
    }
}

test("business API imports in Node without Translator++ globals", () => {
    for (const name of ["pm4Ps2Project", "parseFile", "writeFile", "detectpm4Ps2"]) {
        assert.equal(typeof parser[name], "function");
    }
});

test("detector rejects a non-game path", async () => {
    assert.equal(await parser.detectpm4Ps2("nonexistent-game-path"), false);
});

test("worker imports the business module and responds to ping", {timeout: 5000}, async () => {
    const worker = new Worker(require.resolve("../pm4Ps2.worker.js"), {workerData: {command: "ping"}});
    try {
        const message = await new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", code => reject(new Error("Worker exited before responding: " + code)));
        });
        assert.deepEqual(message, {result: "ok", errors: []});
    } finally {
        await worker.terminate();
    }
});

test("structural extraction, speakers, budgets, deduplication, and unchanged round trip", () => {
    const b = g2(), data = parser.dataset(b, "ROOM.G2");
    assert.equal(data.data.length, 3);
    assert.equal(data.data[1][0], "こんにちは\n世界 %d");
    assert.equal(data.parameters[1][0].rowInfoText, "アリス");
    assert.match(data.parameters[1][0].rowInfoNote, /CP932/);
    assert.equal(data.comments, undefined); // bulk comments force one render per row in the host
    assert.equal(data.context[2].length, 2);
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
});
test("speaker commands persist across statements and voice calls; runtime roles and unknown speakers are distinct", () => {
    const b = speakerG2(), strings = parser.readG2(b).strings;
    const get = text => strings.find(t => t.text === text);
    for (const text of ["最初の台詞", "続きの台詞", "同じ名前の合流"]) {
        assert.equal(get(text).rowInfoText, "アリス"); assert.equal(get(text).speakerKind, "literal");
    }
    for (const text of ["不明な台詞", "呼出し後", "分岐の合流"]) {
        assert.equal(get(text).rowInfoText, ""); assert.equal(get(text).speakerKind, "unknown");
    }
    assert.equal(get("名前は実行時").rowInfoText, "Daughter"); assert.equal(get("名前は実行時").speakerKind, "runtime");
    assert.equal(get("名前は実行時").speakerVariable, 2);
    assert.equal(get("父の台詞").rowInfoText, "Father (custom name)"); assert.equal(get("父の台詞").speakerVariable, 3);
    assert.equal(get("未知の変数").rowInfoText, ""); assert.equal(get("未知の変数").speakerKind, "runtime");
    assert.equal(get("地の文").rowInfoText, ""); assert.equal(get("地の文").speakerKind, "none");
    assert.equal(get("はい").rowInfoText, "");
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
    const dataset = parser.dataset(b, "ROOM.G2"), row = dataset.indexIds["最初の台詞"];
    assert.equal(dataset.parameters[row][0].speakerSource, "pm4-name-command");
});
test("page advances and nested portrait helpers keep the speaker until a reachable name change", () => {
    const b = speakerG2(), strings = parser.readG2(b).strings;
    for (const text of ["立ち絵の前", "立ち絵の後", "同じ話者の続き"]) {
        const token = strings.find(t => t.text === text);
        assert.equal(token.rowInfoText, "Daughter");
        assert.equal(token.speakerKind, "runtime");
        assert.equal(token.speakerVariable, 2);
    }
    const after = strings.find(t => t.text === "名前が消える可能性");
    assert.equal(after.rowInfoText, "");
    assert.equal(after.speakerKind, "unknown");
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
});
test("project guidance adds an editable cast and upgrades only the generated daughter label", () => {
    const room = parser.dataset(speakerG2(), "ROOM.G2");
    const row = room.indexIds["名前は実行時"];
    const speaker = room.parameters[row][0];
    speaker.rowInfoText = "Daughter (custom name)";
    room.parameters[row].push({rowInfoText: "Daughter (custom name)", rowInfoSource: "editor"});
    const project = {gameEngine: "pm4Ps2", files: {"/ROOM.G2": room}};
    assert.equal(guidance.applyProjectDefaults(project), true);
    assert.equal(speaker.rowInfoText, "Daughter");
    assert.equal(room.parameters[row][1].rowInfoText, "Daughter (custom name)");
    assert.equal(room.translationConstraintType, "gameText");
    const reference = project.files["Actor Reference"];
    assert.equal(project.references["Actor Reference"], reference);
    assert.equal(reference.actorTranslationColumn, 1);
    assert.equal(reference.actorInfoColumn, 2);
    const names = new Map(reference.data.map(cells => [cells[0], cells]));
    assert.equal(names.size, reference.data.length);
    assert.match(names.get("Daughter")[2], /female \(she\/her\)/);
    assert.deepEqual(names.get("キューブ").slice(0, 2), ["キューブ", "Cube"]);
    names.get("キューブ")[1] = "Cube (edited)";
    assert.equal(guidance.applyProjectDefaults(project), false);
    assert.equal(names.get("キューブ")[1], "Cube (edited)");
    assert.equal(project.options.translationConstraints.types.gameText.byteBudget.parameter, "maxBytes");
    assert.equal(guidance.legacyEnginePrompts.includes(guidance.enginePrompt), false);
});
test("projects saved with fixed-length budgets migrate to the relocating limits", () => {
    const room = parser.dataset(g2(), "ROOM.G2"), items = parser.dataset(require("iconv-lite").encode("\r\n剣\r\n", "cp932"), "ITEM_NAM.TXT");
    const expected = JSON.parse(JSON.stringify({room: room.parameters, items: items.parameters}));
    // Strip what older versions did not store.
    for (const occurrences of [...room.parameters, ...items.parameters]) for (const info of occurrences) {
        delete info.maxBytes; delete info.textKind; delete info.translationConstraints;
        info.rowInfoNote = "CP932 budget: " + info.byteLength + " bytes; keep line count and % codes.";
    }
    const project = {gameEngine: "pm4Ps2", files: {"/ROOM.G2": room, "/ITEM_NAM.TXT": items}, options: {translationConstraints: {
        enabled: true, types: {gameText: {encoding: "cp932", byteBudget: {mode: "parameter", parameter: "byteLength", encoding: "cp932"}}}}}};
    assert.equal(guidance.applyProjectDefaults(project), true);
    assert.equal(project.options.translationConstraints.types.gameText.byteBudget.parameter, "maxBytes");
    assert.deepEqual(JSON.parse(JSON.stringify({room: room.parameters, items: items.parameters})), expected);
    assert.equal(guidance.applyProjectDefaults(project), false);
});
function scriptStrings(b) {
    const program = parser.g2Program(b);
    return program.instructions.filter(i => i.op === 1 || i.op === 2).map(i => {
        const start = program.codeBase + i.offset + 5;
        return require("iconv-lite").decode(parser.transformString(b.subarray(start, start + i.value)), "cp932");
    });
}
test("context overrides, group fallbacks, missing translations, and exact replacement text", () => {
    const b = g2(), tokens = parser.readG2(b).strings, yes = tokens.filter(t => t.text === "はい");
    const pair = {"はい": "Yes", [yes[1].context.join("/") + "\nはい"]: "No"};
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: pair});
    // Exact text, no padding: the bytecode is relocated instead.
    assert.deepEqual(scriptStrings(output), ["アリス", "0001", "こんにちは\\n世界 %d", "Yes", "No", "gd/sys/example.spd", "menu"]);
    assert.equal(output.length, b.length - 3);
    parser.verifyRelocation(b, output);
    // English short labels are intentionally excluded from JP text extraction.
    assert.equal(parser.readG2(output).strings.some(t => t.text === "はい"), false);
    const group = parser.rebuildResource(b, "ROOM.G2", {translationPair: {"g2\nはい": "No"}, translationInfo: {groupLevel: 1}});
    assert.notDeepEqual(group, b);
});
test("longer translations relocate symbols, labels, jumps, calls and choice handlers", () => {
    const b = g2(), before = parser.g2Program(b);
    const source = "こんにちは\n世界 %d", longer = "Hello there, this line is much longer than the Japanese\nand the whole world is still here %d";
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: longer}});
    const after = parser.g2Program(output);
    assert.ok(output.length > b.length);
    parser.verifyRelocation(b, output);
    const statement5 = p => p.instructions.find(i => i.op === 0x21 && i.value === 5).offset;
    const handler = p => p.instructions.find(i => i.op === 0x13).value;
    assert.equal(handler(before), statement5(before));
    assert.equal(handler(after), statement5(after)); // PUSHADDR moved with its target
    assert.equal(after.labels[0], statement5(after));
    assert.equal(after.symbols[0].code, 0);
    assert.ok(statement5(after) > statement5(before));
    assert.equal(parser.readG2(output).strings.find(t => t.opcode === 1).text, longer);
    // Speaker analysis follows the relocated control flow to the same result.
    const speakers = buffer => parser.readG2(buffer).strings.map(t => [t.rowInfoText, t.speakerKind]);
    const flow = speakerG2(), relocated = parser.rebuildResource(flow, "ROOM.G2", {translationPair: {"最初の台詞": "A considerably longer first line of dialogue"}});
    assert.ok(relocated.length > flow.length);
    parser.verifyRelocation(flow, relocated);
    assert.deepEqual(speakers(relocated), speakers(flow));
});
test("text window capacity is raised only on request and only at the known SetRect", () => {
    const b = g2();
    assert.deepEqual([...parser.textWindowConstants(b).values()], [120]);
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
    const output = parser.rebuildResource(b, "ROOM.G2", {expandTextWindows: true});
    assert.equal(output.length, b.length);
    const pushes = parser.g2Program(output).instructions.filter(i => i.op === 3).map(i => i.value);
    assert.deepEqual(pushes.slice(-4), [192, 350, 120, 0]);
    parser.verifyRelocation(b, output, parser.textWindowConstants(b));
    assert.throws(() => parser.verifyRelocation(b, output), /operand/);
});
test("byte limits allow longer English within the engine's window and buffer limits", () => {
    assert.equal(parser.byteLimit("dialogue", 40, 2), 360);
    assert.equal(parser.byteLimit("dialogue", 294, 11), 588);
    assert.equal(parser.byteLimit("dialogue", 600, 12), 960);
    assert.equal(parser.byteLimit("short", 4), 24);
    assert.equal(parser.byteLimit("short", 16), 24);
    assert.equal(parser.byteLimit("short", 30), 45);
    assert.equal(parser.byteLimit("itemName", 8), 18);
    assert.equal(parser.byteLimit("description", 40, 2), 180);
    const data = parser.dataset(g2(), "ROOM.G2");
    const dialogue = data.parameters[data.indexIds["こんにちは\n世界 %d"]][0];
    assert.equal(dialogue.maxBytes, 360); assert.equal(dialogue.textKind, "dialogue");
    assert.match(dialogue.rowInfoNote, /CP932 limit: 360 bytes \(Japanese: 19\); the box shows 3 lines of about 34 .*continue on a new page/);
    assert.deepEqual(dialogue.translationConstraints, {maxCharsPerLine: 34});
    const label = data.parameters[data.indexIds["はい"]][0];
    assert.equal(label.maxBytes, 24); assert.equal(label.translationConstraints, undefined);
});
test("JIS-form punctuation such as the em dash is stored as its Shift-JIS character", () => {
    const b = g2(), source = "こんにちは\n世界 %d";
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello—world\nwait〜 %d"}});
    const text = scriptStrings(output)[2];
    assert.equal(text, "Hello―world\\nwait～ %d");
    assert.ok(require("iconv-lite").encode(text, "cp932").includes(Buffer.from([0x81, 0x5c])));
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "café"}}), /"é" U\+00E9/);
});
test("line count never blocks export; Translator++ only warns about lines and width", () => {
    const b = g2(), source = "こんにちは\n世界 %d";
    const text = translation => parser.readG2(parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: translation}}))
        .strings.find(t => t.opcode === 1).text;
    assert.equal(text("Hello, world %d"), "Hello, world %d");
    assert.equal(text("One\nTwo\nThree %d"), "One\nTwo\nThree %d");
    assert.deepEqual(parser.validateResource(b, "ROOM.G2", {translationPair: {"はい": "Yes\nNo"}}), []);
    assert.equal(guidance.validationRules.lineCount, "warn");
    assert.equal(guidance.validationRules.blankLines, "warn");
    assert.equal(guidance.validationRules.lineWidth, "warn");
    // Projects that already block on line count are relaxed once, then left to the user.
    const saved = [], save = (project, policy) => { project.options.validationPolicy = policy; saved.push(policy); };
    const project = {options: {validationPolicy: {version: 1, rules: {lineCount: "block", blankLines: "block", maxBytes: "block"}}}};
    assert.equal(guidance.relaxLineRules(project, save), true);
    assert.deepEqual(project.options.validationPolicy.rules, {lineCount: "warn", blankLines: "warn", maxBytes: "block"});
    project.options.validationPolicy.rules.lineCount = "block";
    assert.equal(guidance.relaxLineRules(project, save), false);
    assert.equal(project.options.validationPolicy.rules.lineCount, "block");
});
test("dialogue longer than three lines continues on new pages", () => {
    assert.equal(parser.paginate("a\nb\nc\n", 3), "a\nb\nc\n");
    assert.equal(parser.paginate("a\nb\nc\n\nd\ne\nf\ng\n", 3), "a\nb\nc\fd\ne\nf\fg\n");
    const b = pagedG2(), program = buffer => parser.g2Program(buffer);
    const listing = buffer => {
        const {codeBase, instructions} = program(buffer);
        return instructions.filter(i => i.op !== 0x21 && i.op !== 0x20).map(i => i.op === 1
            ? require("iconv-lite").decode(parser.transformString(buffer.subarray(codeBase + i.offset + 5, codeBase + i.offset + i.size)), "cp932")
            : i.op === 6 ? "ARGS" : i.op === 0x0e ? "RET" : i.op + ":" + i.value);
    };
    const rows = (...n) => n.map(i => "Row " + i).join("\n"), stats = {};
    const output = parser.rebuildResource(b, "ROOM.G2", {stats, translationPair: {
        "一行目\n二行目\n三行目": rows(1, 2, 3) + "\n\n" + rows(5, 6, 7, 8) + "\n",
        "語り一\n語り二": rows(1, 2, 3, 4),
        "名前は{{daughter}}です。": "A\nB\nC {{daughter}}\nD\nE\nF\nG"}});
    const br = "\\n";
    assert.deepEqual(listing(output), ["3:1", "9:" + program(output).instructions.find(i => i.op === 1).offset,
        // The jump lands on the first page; page turns are ARGS + SYSCALL 0x1105.
        "Row 1" + br + "Row 2" + br + "Row 3", "ARGS", "5:4357", "Row 5" + br + "Row 6" + br + "Row 7", "ARGS", "5:4357", "Row 8" + br,
        "ARGS", "5:4357",
        // A box built up over 0x1104 waits is not paged.
        "Row 1" + br + "Row 2" + br + "Row 3" + br + "Row 4", "ARGS", "5:4356", br + "語り三", "ARGS", "5:4356", "ARGS", "5:4098",
        // A page that starts right after the inline name turns before the next literal.
        "A" + br + "B" + br + "C ", "ARGS", "66:2", "5:4106", "ARGS", "5:4357", "D" + br + "E" + br + "F", "ARGS", "5:4357", "G",
        "ARGS", "5:4357", "RET"]);
    assert.equal(stats.pagedMessages, 2);
    // Each page must fit the message buffer; the whole message may not.
    const line = n => "x".repeat(n), box = "一行目\n二行目\n三行目";
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {[box]: [line(400), line(400), line(400), "x"].join("\n")}}),
        /a page of the translation uses 1204 CP932 bytes/);
    assert.ok(parser.rebuildResource(b, "ROOM.G2", {translationPair: {[box]: [line(300), line(300), line(300), line(300)].join("\n")}}).length);
});
test("multiline translation preserves runtime escapes and placeholders", () => {
    const b = g2(), source = "こんにちは\n世界 %d";
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello\r\nWorld %d"}});
    const text = parser.readG2(output).strings.find(t => t.opcode === 1).text;
    assert.equal(text.trimEnd(), "Hello\nWorld %d");
    assert.equal(text.split("\n").length, 2);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello\nWorld %s"}}), /placeholders/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "x".repeat(961)}}), /maximum is 960/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "😀"}}), /CP932/);
});
test("preflight collects every invalid row with readable row numbers and all duplicate contexts", () => {
    const b = g2(), options = {translationPair: {
        "こんにちは\n世界 %d": "Hello\nworld %s",
        "はい": "x".repeat(1000)
    }};
    const issues = parser.validateResource(b, "ROOM.G2", options);
    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map(i => i.row), [1, 2]);
    assert.equal(issues[1].contexts.length, 2);
    assert.equal(issues[1].byteLength, 1000);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", options), error => {
        assert.equal(error.name, "PM4TranslationError");
        assert.equal(error.issues.length, 2);
        assert.match(error.message, /ROOM.G2: row 2 .*placeholders/);
        assert.match(error.message, /ROOM.G2: row 3 .*shorten by 40 bytes/);
        return true;
    });
    assert.deepEqual(parser.validateResource(b, "ROOM.G2", {translationPair: {"はい": "Yes"}}), []);
});
test("over-limit text and stray control characters are warnings, not export errors", () => {
    const b = g2(), warnings = [], options = {translationPair: {
        "こんにちは\n世界 %d": "A".repeat(200) + "\n" + "B".repeat(190) + " %d",
        "はい": "Certainly, at once, my lord",
        "アリス": "Ali\u0007ce"
    }, warnings};
    assert.deepEqual(parser.validateResource(b, "ROOM.G2", options), []);
    const output = parser.rebuildResource(b, "ROOM.G2", options);
    assert.deepEqual(warnings.map(w => w.row), [0, 1, 2]);
    assert.match(warnings[0].message, /removed an invisible control character/);
    assert.match(warnings[1].message, /uses 395 CP932 bytes, over the recommended 360/);
    assert.equal(warnings[2].contexts.length, 2);
    assert.equal(scriptStrings(output)[0], "Alice");
    assert.match(parser.warningLines(warnings)[2], /ROOM.G2: row 3 .*recommended 24/);
});
test("corrupt signatures, truncated operands, invalid jumps, and unknown opcodes fail", () => {
    assert.throws(() => parser.readG2(Buffer.from("not a game")), /Unsupported/);
    assert.throws(() => parser.readG2(g2().subarray(0, 50)), /Truncated|missing|count/);
    assert.throws(() => parser.readG2(g2().subarray(0, -1)), /Truncated/);
    const bad = Buffer.concat([g2(), Buffer.from([0xff])]);
    assert.throws(() => parser.readG2(bad), /Unknown G2 opcode/);
    const jump = g2(); jump.writeUInt32LE(2, 33); assert.throws(() => parser.readG2(jump), /jump target/);
    const op = g2(); op[parser.readG2(op).codeStart] = 0; assert.throws(() => parser.readG2(op), /missing|table/);
});
test("item list preserves CRLF, empty header, duplicate rows, and byte budgets", () => {
    const ic = require("iconv-lite"), b = ic.encode("\r\n名前\r\n名前\r\n", "cp932");
    const data = parser.dataset(b, "ITEM_NAM.TXT"); assert.equal(data.data.length, 1); assert.equal(data.context[0].length, 2);
    assert.deepEqual(parser.rebuildResource(b, "ITEM_NAM.TXT"), b);
    const output = parser.rebuildResource(b, "ITEM_NAM.TXT", {translationPair: {"名前": "Name"}});
    assert.equal(output.toString("ascii"), "\r\nName\r\nName\r\n");
    const longer = parser.rebuildResource(b, "ITEM_NAM.TXT", {translationPair: {"名前": "Longer Name"}});
    assert.equal(longer.toString("ascii"), "\r\nLonger Name\r\nLonger Name\r\n");
    const warnings = [], long = parser.rebuildResource(b, "ITEM_NAM.TXT", {translationPair: {"名前": "An extraordinarily long item"}, warnings});
    assert.equal(long.toString("ascii"), "\r\nAn extraordinarily long item\r\nAn extraordinarily long item\r\n");
    assert.match(warnings[0].message, /over the recommended 18/);
    const description = ic.encode("\r\n強い剣\\n攻撃力２\r\n", "cp932");
    const text = "A strong sword forged in the capital\nAttack +2";
    assert.equal(parser.rebuildResource(description, "ITEM_MSG.TXT", {translationPair: {"強い剣\n攻撃力２": text}}).toString("ascii"),
        "\r\n" + text.replace("\n", String.fromCharCode(92) + "n") + "\r\n");
});
test("complete ISO import, no-op export, patch, wrong source, and exclusive output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-test-"));
    try {
        const source = path.join(root, "original.iso"), bytes = iso(); await fs.writeFile(source, bytes);
        const scanned = await parser.pm4Ps2Project.scan(source, {stagingDir: path.join(root, "stage")});
        assert.equal(scanned.files.length, 4); assert.equal(await parser.detectpm4Ps2(source), true);
        const options = {manifest: scanned.manifest}, noOp = path.join(root, "no-op.iso");
        await parser.exportIso(source, noOp, options); assert.deepEqual(await fs.readFile(noOp), bytes);
        const translated = path.join(root, "translated.iso"), pair = {translationPair: {"はい": "Yes"}};
        const result = await parser.exportIso(source, translated, {...options, translations: {"ROOM.G2": pair}});
        // Any text change also raises the text-window capacity in both game scripts.
        assert.deepEqual(result.patchedFiles, ["ROOM.G2", "PRIME4.G2"]);
        const output = await fs.readFile(translated), [room, prime] = scanned.manifest.resources;
        const after = await parser.inspectIso(translated);
        const expectedRoom = parser.rebuildResource(g2(), "ROOM.G2", {...pair, expandTextWindows: true});
        assert.equal(after.resources[0].offset, room.offset);
        assert.equal(after.resources[0].size, expectedRoom.length);
        assert.deepEqual(output.subarray(room.offset, room.offset + expectedRoom.length), expectedRoom);
        assert.deepEqual(output.subarray(prime.offset, prime.offset + prime.size), parser.rebuildResource(g2(), "PRIME4.G2", {expandTextWindows: true}));
        assertOnlyChanged(bytes, output, [[room.offset, 2048], [prime.offset, 2048], [ROOT_DIRECTORY, 2048]]);
        assert.deepEqual(await fs.readFile(source), bytes);
        const textOnly = await parser.exportIso(source, path.join(root, "text-only.iso"), {...options, translations: {"ROOM.G2": pair}, expandTextWindows: false});
        assert.deepEqual(textOnly.patchedFiles, ["ROOM.G2"]);
        await assert.rejects(parser.exportIso(source, source, options), /overwrite/);
        await assert.rejects(parser.exportIso(source, translated, options), /EEXIST/);
        const invalid = path.join(root, "invalid.iso");
        const warned = await parser.exportIso(source, path.join(root, "warned.iso"), {...options, translations: {"ROOM.G2": {translationPair: {"はい": "Far too long for a choice"}}}});
        assert.equal(warned.warnings.length, 1); assert.match(warned.warningLines[0], /recommended 24/);
        const overLimit = {translationPair: {"はい": "x".repeat(1000)}};
        await assert.rejects(parser.exportIso(source, invalid, {...options, translations: {"ROOM.G2": overLimit, "PRIME4.G2": overLimit}}), error => {
            assert.equal(error.issues.length, 2);
            assert.deepEqual(error.issues.map(i => i.file), ["ROOM.G2", "PRIME4.G2"]);
            return true;
        });
        await assert.rejects(parser.exportIso(source, invalid, {...options, translations: {"ROOM.G2": overLimit}}), /maximum/);
        await assert.rejects(fs.stat(invalid), /ENOENT/);
        bytes[bytes.length - 1] ^= 1; await fs.writeFile(source, bytes);
        await assert.rejects(parser.exportIso(source, invalid, options), /checksum/);
        assert.equal((await fs.readdir(root)).some(f => f.endsWith(".partial")), false);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
function longTranslations() {
    const translationPair = {};
    for (let i = 0; i < 50; i++) translationPair["長い台詞その" + i + "\nもう一行の台詞です。"] = "A".repeat(80) + "\n" + "B".repeat(80);
    return {translationPair};
}
test("a script that outgrows its sectors moves into the debug script's space", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-grow-"));
    try {
        const source = path.join(root, "original.iso"), bytes = iso({longRoom: true}); await fs.writeFile(source, bytes);
        const scanned = await parser.pm4Ps2Project.scan(source, {stagingDir: path.join(root, "stage")});
        const room = scanned.manifest.resources[0], output = path.join(root, "grown.iso"), translations = {"ROOM.G2": longTranslations()};
        assert.equal(Math.ceil(room.size / 2048), 2);
        const result = await parser.exportIso(source, output, {manifest: scanned.manifest, translations});
        assert.deepEqual(result.reclaimed, ["TEST.G2"]);
        const expected = parser.rebuildResource(longG2(), "ROOM.G2", {...translations["ROOM.G2"], expandTextWindows: true});
        assert.ok(Math.ceil(expected.length / 2048) > 2);
        assert.deepEqual(result.resized.find(r => r.name === "ROOM.G2"), {name: "ROOM.G2", size: expected.length, offset: room.offset});
        const after = await parser.inspectIso(output), written = await fs.readFile(output);
        assert.equal(after.resources[0].size, expected.length);
        assert.deepEqual(written.subarray(room.offset, room.offset + expected.length), expected);
        parser.verifyRelocation(longG2(), expected);
        // ROOM.G2 now spans the old TEST.G2 sectors; TEST.G2 is listed as empty.
        await assert.rejects(parser.inspectIso(output, {includeTestScripts: true}), /PM4|G2|Truncated/);
        const prime = scanned.manifest.resources[1];
        assertOnlyChanged(bytes, written, [[room.offset, 8 * 2048], [prime.offset, 2048], [ROOT_DIRECTORY, 2048]]);
        assert.deepEqual(await fs.readFile(source), bytes);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
test("export refuses, without leaving files behind, when no disc space is left", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-full-"));
    try {
        const source = path.join(root, "original.iso"); await fs.writeFile(source, iso({longRoom: true, noTestScript: true}));
        const scanned = await parser.pm4Ps2Project.scan(source, {stagingDir: path.join(root, "stage")});
        const output = path.join(root, "full.iso");
        await assert.rejects(parser.exportIso(source, output, {manifest: scanned.manifest, translations: {"ROOM.G2": longTranslations()}}), /does not fit/);
        await assert.rejects(fs.stat(output), /ENOENT/);
        assert.equal((await fs.readdir(root)).some(f => f.endsWith(".partial")), false);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test("inline placeholders survive movement, empty operands, legacy pairs and branch entries", () => {
    const base = g2(), parts = [base];
    let statement = base.readUInt32LE(9) - 1;
    function word(op, n) {
        const b = Buffer.alloc(5); b[0] = op; b.writeUInt32LE(n, 1); return b;
    }
    function text(s) {
        const bytes = Buffer.from(s);
        parts.push(word(1, bytes.length), parser.transformString(bytes, true));
    }
    function print(id) {
        parts.push(word(0x21, ++statement), Buffer.from([6]), word(0x42, id), word(5, 0x100a));
    }
    text("Adopt "); print(2); text(" today.");
    parts.push(Buffer.from([0x0e]));
    print(3); text(" spoke to "); print(17);
    // Jump into a variable statement. Text before that entry cannot be joined.
    const jump = word(7, 0); parts.push(jump); text("Separate");
    jump.writeUInt32LE(Buffer.concat(parts).length - parser.g2Program(base).codeBase, 1);
    print(4); text("!");
    const source = Buffer.concat(parts);
    source.writeUInt32LE(statement + 1, 9);
    const name = "ROOM.G2", row = "Adopt {{daughter}} today.";
    const second = "{{father}} spoke to {{str17}}";
    const data = parser.dataset(source, name);
    assert.ok(data.indexIds[row] >= 0 && data.indexIds[second] >= 0);
    assert.ok(data.indexIds["Separate"] >= 0 && data.indexIds["{{str4}}!"] >= 0);
    assert.deepEqual(parser.rebuildResource(source, name), source);
    const target = "Before {{father}}{{str17}} after";
    const rebuilt = parser.rebuildResource(source, name, {translationPair: {
        [second]: target, [row]: "{{daughter}} joined.", "{{str4}}!": "Address {{str4}}!"
    }});
    const next = parser.dataset(rebuilt, name);
    for (const key of [target, "{{daughter}} joined.", "Address {{str4}}!"]) assert.ok(next.indexIds[key] >= 0);
    for (const bad of ["missing", "{{father}}", "{{daughter}}{{daughter}}", "{{daughter}}{{oops}}"]) {
        assert.throws(() => parser.rebuildResource(source, name, {translationPair: {[row]: bad}}), /runtime variable/);
    }
    const legacy = parser.rebuildResource(source, name, {translationPair: {"Adopt ": "Welcome "}});
    assert.ok(parser.dataset(legacy, name).indexIds["Welcome {{daughter}} today."] >= 0);
    const rowId = data.indexIds[row], [left, , right] = data.parameters[rowId][0].inlineParts;
    guidance.migrateInlineRows({data: [[left.source, "Met "], [right.source, " here.", " there."]],
        context: [[left.context], [right.context]], parameters: [[{translation: "Saw "}], [{}]]}, data);
    assert.deepEqual(data.data[rowId].slice(1), ["Met {{daughter}} here.", "Met {{daughter}} there."]);
    assert.equal(data.parameters[rowId][0].translation, "Saw {{daughter}} there.");
});
