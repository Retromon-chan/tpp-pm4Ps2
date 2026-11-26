"use strict";
// Portable PS2 parser: no app globals, external executables, or PC patch data.
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const {Transform} = require("stream");
const {pipeline} = require("stream/promises");
const iconv = require("iconv-lite");
const imageCodec = require("./pm4Ps2.images.js");
const keyboard = require("./pm4Ps2.keyboard.js");
const SECTOR = 2048;
const MAIN_FILES = ["ROOM.G2", "PRIME4.G2", "ITEM_NAM.TXT", "ITEM_MSG.TXT"];
const TEST_FILES = ["TEST.G2", "DEVTEST.G2"];
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const normalize = text => text.replace(/\r\n?/g, "\n");
const display = text => normalize(text).replace(/\\n/g, "\n");
const japanese = text => /[\u3000-\u30ff\u3400-\u9fff\uff61-\uff9f]/.test(text);
function check(condition, message) { if (!condition) throw new Error(message); }
function range(b, p, n) { check(Number.isSafeInteger(p) && Number.isSafeInteger(n) && p >= 0 && n >= 0 && p + n <= b.length, "Truncated or invalid PM4 data."); }
function u32(b, p) { range(b, p, 4); return b.readUInt32LE(p); }
function transformString(b, encode = false) { return Buffer.from(Array.from(b, (v, i) => (v + (encode ? 1 : -1) * (i + b.length)) & 255)); }
// Shift-JIS characters that Microsoft's CP932 table maps to a different Unicode
// code point than JIS does. Editors and AI output usually produce the JIS form
// (e.g. the em dash U+2014 for 0x815C), which iconv's CP932 would reject.
const CP932_EQUIVALENTS = {"—": "―", "〜": "～", "‖": "∥", "−": "－",
    "¢": "￠", "£": "￡", "¬": "￢"};
const CP932_EQUIVALENT_PATTERN = new RegExp("[" + Object.keys(CP932_EQUIVALENTS).join("") + "]", "g");
function strictEncode(text) {
    const normalized = text.replace(CP932_EQUIVALENT_PATTERN, ch => CP932_EQUIVALENTS[ch]);
    const bytes = iconv.encode(normalized, "cp932");
    const bad = [...normalized].filter(ch => iconv.decode(iconv.encode(ch, "cp932"), "cp932") !== ch);
    check(!bad.length, "Text contains characters that cannot be represented in CP932 (Shift-JIS): " +
        [...new Set(bad)].map(ch => "\"" + ch + "\" U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(", ") + ".");
    return bytes;
}
function strictDecode(bytes) {
    const text = iconv.decode(bytes, "cp932");
    check(!text.includes("\ufffd"), "Invalid CP932 text in PM4 resource."); return text;
}
// Operand widths follow the SLPM_659.36 interpreter dispatch at 0x1791A0 and
// were checked against all four scripts. Parsing must consume the complete file,
// every sequential statement, and every jump target.
const span = (from, to) => Array.from({length: to - from + 1}, (_, i) => from + i);
const WORD_OPS = new Set([3, 5, 7, 8, 9, 0x0a, 0x0b, 0x13, 0x14, 0x20, 0x21, 0x22, ...span(0x40, 0x53)]);
const SINGLE_OPS = new Set([4, 6, 0x0d, 0x0e, 0x10, 0x11, 0x15, 0x16, ...span(0x82, 0x98), ...span(0x9a, 0xa4), 0xf0]);
const STRING_OPS = new Set([1, 2, 0x0f]);   // [op][u32 byte length][scrambled bytes]
const SKIP_OP = 0x0c;                       // [op][u32][u32 relative seek]
// Operands that hold code offsets: JMP/JZ/JNZ/CALL and PUSHADDR (0x13, the
// choice-menu handler address passed to native 0x118F). 0xFFFFFFFF is "end".
const ABSOLUTE_OPS = new Set([7, 8, 9, 0x0a, 0x13]);
const END_OF_CODE = 0xffffffff;
const G2_MAGIC = Buffer.from("G2CD0460\x1b", "binary");
const CODE_PREFIX = Buffer.from("1b20010000002002000000", "hex");
// Page advance, sprite show/hide, voice playback, and the string operations
// used to build sprite paths leave the active name plate alone.
const NAME_PRESERVING_NATIVE_CALLS = new Set([0x1105, 0x1501, 0x1502, 0x1620, 0x1801, 0x1803, 0x1804, 0x1805, 0x1809]);

function findNameChangingPaths(events) {
    const predecessors = Array.from(events, () => []);
    const mayChangeName = new Uint8Array(events.length);
    const queue = [];
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (event.type === "return") continue;
        if (event.next !== undefined && event.next < events.length) predecessors[event.next].push(index);
        if (event.targetIndex !== undefined && event.targetIndex < events.length) predecessors[event.targetIndex].push(index);
        if (event.type === "name" || event.type === "unknown" || event.next === events.length || event.targetIndex === events.length) {
            mayChangeName[index] = 1;
            queue.push(index);
        }
    }
    // A script call preserves the name only if neither the callee nor a
    // nested callee can reach a name command or an unverified operation.
    for (let head = 0; head < queue.length; head++) {
        for (const index of predecessors[queue[head]]) {
            if (mayChangeName[index]) continue;
            mayChangeName[index] = 1;
            queue.push(index);
        }
    }
    return mayChangeName;
}

function assignSpeakers(events, entries, boundaries, codeBase) {
    const UNKNOWN = null, runtimeStates = new Map(), incoming = new Array(events.length);
    const queue = [];
    function locate(offset) {
        let lo = 0, hi = events.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].offset < offset) lo = mid + 1; else hi = mid; }
        return lo;
    }
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (event.type !== "return" && !event.unconditional) event.next = index + 1;
        if (event.target !== undefined) {
            event.targetIndex = boundaries.has(event.target - codeBase) ? locate(event.target) : events.length;
        }
    }
    const mayChangeName = findNameChangingPaths(events);
    function runtimeState(variableId) {
        if (!runtimeStates.has(variableId)) runtimeStates.set(variableId, {variableId});
        return runtimeStates.get(variableId);
    }
    function merge(index, value) {
        if (index >= events.length) return;
        const before = incoming[index];
        const after = before === undefined ? value : before === value ? before : UNKNOWN;
        if (before !== after) { incoming[index] = after; queue.push(index); }
    }
    for (const offset of entries) if (boundaries.has(offset - codeBase)) merge(locate(offset), UNKNOWN);
    for (const event of events) if (event.targetIndex !== undefined && event.type !== "branch") merge(event.targetIndex, UNKNOWN);
    for (let head = 0; head < queue.length; head++) {
        const index = queue[head], event = events[index]; let state = incoming[index];
        if (event.type === "name") state = event.kind === "literal" ? event.name : event.kind === "none" ? "" : runtimeState(event.variableId);
        else if (event.type === "unknown" || (event.type === "call" && mayChangeName[event.targetIndex] !== 0)) state = UNKNOWN;
        if (event.type === "branch") merge(event.targetIndex, state);
        if (event.next !== undefined) merge(event.next, state);
    }
    for (let index = 0; index < events.length; index++) {
        const event = events[index]; if (event.type !== "dialogue") continue;
        const state = incoming[index];
        const runtime = state && typeof state === "object";
        const roles = {2: "Daughter", 3: "Father (custom name)"};
        event.token.rowInfoText = typeof state === "string" ? state : runtime ? roles[state.variableId] || "" : "";
        event.token.speakerKind = typeof state === "string" ? (state ? "literal" : "none") : runtime ? "runtime" : "unknown";
        if (runtime && Number.isInteger(state.variableId)) event.token.speakerVariable = state.variableId;
    }
}
// Header layout as read by the loader at 0x17FB40: magic, 0x1B, u32 statement
// count, u32 symbol count, then per symbol [u32 code offset][u32 length][name],
// then [u32 label count][label count x u32 code offset]. The loader then skips
// to the next 0x1B; code offsets are relative to the byte after it.
function g2Header(b) {
    check(b.subarray(0, 9).equals(G2_MAGIC), "Unsupported G2 script (expected G2CD0460).");
    const statementCount = u32(b, 9), symbolCount = u32(b, 13);
    check(symbolCount < 100000 && statementCount < 1000000, "Invalid G2 header counts.");
    let p = 17;
    const symbols = [];
    for (let i = 0; i < symbolCount; i++) {
        const code = u32(b, p), n = u32(b, p + 4); p += 8; range(b, p, n);
        symbols.push({code, name: b.subarray(p, p + n)}); p += n;
    }
    const labelCount = u32(b, p); p += 4;
    check(labelCount < 1000000, "Invalid G2 label table."); range(b, p, labelCount * 4);
    const tableStart = p, labels = Array.from({length: labelCount}, (_, i) => b.readUInt32LE(p + 4 * i));
    p += labelCount * 4;
    const codeStart = b.indexOf(0x1b, p);
    check(codeStart >= 0 && b.subarray(codeStart, codeStart + CODE_PREFIX.length).equals(CODE_PREFIX), "G2 bytecode entry marker is missing.");
    return {statementCount, symbols, labels, tableStart, codeStart, codeBase: codeStart + 1};
}
function inlineDialogue(strings, prints, targets) {
    const result = [], parts = [...strings.map(token => ({token, start: token.offset - 5,
        end: token.offset + token.byteLength})), ...prints].sort((a, b) => a.start - b.start);
    let run = [];
    function flush() {
        const literals = run.filter(part => part.token);
        if (literals.length && run.some(part => part.marker)) {
            result.push({...literals[0].token, context: ["g2-inline", run[0].start.toString(16)], parts: run,
                text: run.map(part => part.marker || part.token.text).join(""),
                byteLength: literals.reduce((total, part) => total + part.token.byteLength, 0)});
        } else {
            for (const {token} of literals) if (token.text.trim()) result.push(token);
        }
        run = [];
    }
    for (const part of parts) {
        const prev = run[run.length - 1];
        if (prev && (prev.end !== part.start || targets.has(part.start) ||
            (prev.token && part.token) || prev.token?.opcode === 2 || part.token?.opcode === 2)) flush();
        run.push(part);
    }
    flush();
    return result;
}
function readG2(b, joinVariables = false) {
    const header = g2Header(b), {statementCount, codeStart} = header;
    for (const symbol of header.symbols) strictDecode(transformString(symbol.name));
    const symbols = header.symbols.map(s => s.code);
    let p = header.codeBase;
    const boundaries = new Set(), strings = [], events = [];
    const targets = new Set([...header.labels, ...symbols].map(n => header.codeBase + n)), prints = [];
    let statement = 0, arguments_ = [];
    while (p < b.length) {
        const offset = p, opcode = b[p++]; boundaries.add(offset - codeStart - 1);
        if (opcode === 0x0f) {
            const byteLength = u32(b, p); p += 4; range(b, p, byteLength); p += byteLength;
            arguments_.push({opcode});
        } else if (opcode === SKIP_OP) {
            range(b, p, 8); targets.add(p + 8 + u32(b, p + 4)); p += 8; arguments_.push({opcode});
        } else if (opcode === 1 || opcode === 2) {
            const byteLength = u32(b, p); p += 4; range(b, p, byteLength);
            const rawText = strictDecode(transformString(b.subarray(p, p + byteLength))), text = display(rawText);
            if ((joinVariables && opcode === 1) || (text.trim() && (opcode === 1 || japanese(text)))) {
                check(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), "Unexpected control character in G2 text.");
                const token = {offset: p, byteLength, text, rawText, context: ["g2", offset.toString(16)], statement, opcode, rowInfoText: ""};
                strings.push(token);
                if (opcode === 1) events.push({offset, type: "dialogue", token});
            }
            arguments_.push({opcode, value: text});
            p += byteLength;
        } else if (WORD_OPS.has(opcode)) {
            const value = u32(b, p); p += 4;
            if (ABSOLUTE_OPS.has(opcode)) targets.add(header.codeBase + value);
            if (opcode === 0x20 || opcode === 0x21) {
                check(value === statement + 1, "Nonsequential G2 statement index at 0x" + offset.toString(16));
                statement = value; arguments_ = [];
            } else if (opcode === 5) {
                if (value === 0x2100) {
                    const mode = arguments_[0], name = arguments_[1];
                    const literal = arguments_.length === 2 && mode?.opcode === 3 && mode.value === 1 && name?.opcode === 2 && !/[\n%\\$]/.test(name.value);
                    const cleared = arguments_.length === 1 && mode?.opcode === 3 && mode.value === 0;
                    const variableId = arguments_.length === 2 && mode?.opcode === 3 && mode.value === 1 && name?.opcode === 0x42 ? name.value : undefined;
                    events.push({offset, type: "name", kind: literal ? "literal" : cleared ? "none" : "runtime", name: literal ? name.value : "", variableId});
                } else if (value === 0x100a && arguments_.length === 1 && arguments_[0].opcode === 0x42 &&
                    boundaries.has(offset - 11 - header.codeBase) &&
                    b[offset - 11] === 0x21 && b[offset - 6] === 6 && b[offset - 5] === 0x42) {
                    const id = arguments_[0].value;
                    const label = id === 2 ? "daughter" : id === 3 ? "father" : "str" + id;
                    prints.push({start: offset - 11, end: p, call: offset, marker: "{{" + label + "}}"});
                } else if (!NAME_PRESERVING_NATIVE_CALLS.has(value)) events.push({offset, type: "unknown"});
                arguments_ = [];
            } else {
                if (opcode === 7 || opcode === 8 || opcode === 9) {
                    events.push({offset, type: "branch", target: codeStart + 1 + value, unconditional: opcode === 7});
                } else if (opcode === 0x0a || opcode === 0x13) {
                    events.push({offset, type: opcode === 0x0a ? "call" : "unknown", target: codeStart + 1 + value});
                }
                arguments_.push({opcode, value});
            }
        } else {
            check(SINGLE_OPS.has(opcode), "Unknown G2 opcode 0x" + opcode.toString(16) + " at 0x" + offset.toString(16));
            if (opcode === 6) arguments_ = [];
            else arguments_.push({opcode});
            if (opcode === 0x0e) events.push({offset, type: "return"});
        }
        if (arguments_.length > 16) arguments_ = [{opcode: -1}];
    }
    check(statement + 1 === statementCount, "G2 statement count mismatch.");
    for (const target of header.labels) check(boundaries.has(target), "G2 jump target is not an instruction boundary.");
    // Every symbol is a function entry on an instruction boundary in all four
    // retail scripts. (The former "stale sell_item at 72" was PRIME4's label count.)
    for (const offset of symbols) check(boundaries.has(offset), "G2 symbol target is not an instruction boundary.");
    const codeBase = header.codeBase;
    assignSpeakers(events, [codeBase, ...symbols.map(offset => codeBase + offset)], boundaries, codeBase);
    const safePrints = prints.filter(part => ![part.start + 5, part.start + 6, part.call].some(n => targets.has(n)));
    return {strings: joinVariables ? inlineDialogue(strings, safePrints, targets) : strings, codeStart, statementCount, symbolCount: symbols.length, unresolvedSymbols: []};
}
function readItems(b) {
    const text = strictDecode(b);
    check(!text.replace(/\r\n/g, "").includes("\n"), "Expected CRLF item text.");
    const strings = []; let offset = 0;
    text.split("\r\n").forEach((rawText, line) => {
        const byteLength = strictEncode(rawText).length;
        if (line > 0 && rawText.trim()) strings.push({offset, byteLength, text: display(rawText), rawText, context: ["item", String(line)], line});
        offset += byteLength + 2;
    });
    check(strings.length > 0, "No item text found."); return {strings};
}
// CP932 limits per occurrence. The writer relocates bytecode, so these are engine
// limits rather than the Japanese slot sizes. Dialogue and item descriptions go to
// the message window: its render-slot pool (TEXT_WINDOWS) and its ~1 KB text
// buffer at window+0x64 (strcpy/strcat at 0x16E5A0) are the hard limits. Long
// multi-line messages are letters in the full-screen window. Short strings are
// speaker plates and choices; item names share the item list's slot pool.
const BYTE_LIMITS = {dialogue: 180, description: 180, short: 24, itemName: 18, longMessage: 960};
function byteLimit(kind, byteLength, lines = 1) {
    if (kind === "dialogue" || kind === "description") {
        return lines <= 3 ? Math.max(byteLength, BYTE_LIMITS[kind])
            : Math.max(byteLength, Math.min(BYTE_LIMITS.longMessage, Math.max(byteLength * 2, BYTE_LIMITS[kind])));
    }
    // Short strings already long in Japanese (status/result messages) are not
    // tiny choice labels; give them the usual English expansion.
    if (kind === "short") return Math.max(byteLength, BYTE_LIMITS.short, Math.ceil(byteLength * 1.5));
    return Math.max(byteLength, BYTE_LIMITS[kind] ?? BYTE_LIMITS.short);
}
// Line breaks are plain `\n` text to the engine, so export never checks line
// counts. The message box shows about three lines of ~34 half-width characters
// (width estimated from the Japanese, not measured in game); Translator++ only
// warns about line count, blank lines and width (see pm4Ps2.guidance.js).
const LINE_WIDTH = 34;
// Per-occurrence parameters for Translator++: the byte limit, and for wrappable
// text a width guideline. Used by import and by project upgrades.
function occurrenceLimits(kind, byteLength, source) {
    const maxBytes = byteLimit(kind, byteLength, source.split("\n").length);
    const wrappable = kind === "dialogue" || kind === "description";
    return {maxBytes, textKind: kind,
        ...(wrappable ? {translationConstraints: {maxCharsPerLine: LINE_WIDTH}} : {}),
        rowInfoNote: "CP932 limit: " + maxBytes + " bytes (Japanese: " + byteLength + "); " + (wrappable
            ? "the box shows about 3 lines of " + LINE_WIDTH + " half-width characters; keep % codes."
            : "keep % codes.")};
}
function textKind(name, token) {
    if (/^ITEM_MSG\.TXT$/i.test(name)) return "description";
    if (/^ITEM_NAM\.TXT$/i.test(name)) return "itemName";
    return token.opcode === 1 ? "dialogue" : "short";
}
function readResource(b, name) {
    const result = /\.G2$/i.test(name) ? readG2(b, true) : readItems(b);
    for (const token of result.strings) {
        token.kind = textKind(name, token);
        token.maxBytes = byteLimit(token.kind, token.byteLength, token.text.split("\n").length);
    }
    return result;
}

// ---- Variable-length G2 rebuilding ----
function g2Program(b) {
    const header = g2Header(b), {codeBase} = header, instructions = [];
    for (let p = codeBase; p < b.length;) {
        const op = b[p]; let size;
        if (STRING_OPS.has(op)) size = 5 + u32(b, p + 1);
        else if (op === SKIP_OP) size = 9;
        else if (WORD_OPS.has(op)) size = 5;
        else { check(SINGLE_OPS.has(op), "Unknown G2 opcode 0x" + op.toString(16) + " at 0x" + p.toString(16)); size = 1; }
        range(b, p, size);
        instructions.push({offset: p - codeBase, op, size, value: size >= 5 ? b.readUInt32LE(p + 1) : undefined,
            value2: op === SKIP_OP ? b.readUInt32LE(p + 5) : undefined});
        p += size;
    }
    return {...header, instructions, end: b.length - codeBase};
}
function instructionIndex(program) {
    const index = new Map(program.instructions.map((insn, i) => [insn.offset, i]));
    index.set(program.end, program.instructions.length); return index;
}
// texts: Map(absolute offset of a string's bytes -> new plain CP932 bytes).
// constants: Map(code offset of a PUSHI -> new value).
function relocateG2(b, texts = new Map(), constants = new Map(), insertions = new Map()) {
    const program = g2Program(b), {codeBase} = program, remap = new Map(), sizes = [];
    let position = 0;
    for (const insn of program.instructions) {
        const text = STRING_OPS.has(insn.op) ? texts.get(codeBase + insn.offset + 5) : undefined;
        const size = text ? 5 + text.length : insn.size;
        remap.set(insn.offset, position); sizes.push(size); position += size;
        const extra = insertions.get(codeBase + insn.offset);
        if (extra) position += 5 + (extra.before || extra.after).length;
    }
    remap.set(program.end, position);
    const at = offset => { check(remap.has(offset), "G2 code offset " + offset + " is not an instruction boundary."); return remap.get(offset); };
    const code = Buffer.alloc(position);
    program.instructions.forEach((insn, i) => {
        const source = codeBase + insn.offset, extra = insertions.get(source);
        let w = remap.get(insn.offset);
        if (extra) {
            const bytes = extra.before || extra.after, dst = extra.before ? w : w + sizes[i];
            code[dst] = 1;
            code.writeUInt32LE(bytes.length, dst + 1);
            transformString(bytes, true).copy(code, dst + 5);
            if (extra.before) w += 5 + bytes.length;
        }
        const text = STRING_OPS.has(insn.op) ? texts.get(source + 5) : undefined;
        if (text) { code[w] = insn.op; code.writeUInt32LE(text.length, w + 1); transformString(text, true).copy(code, w + 5); return; }
        b.copy(code, w, source, source + insn.size);
        if (ABSOLUTE_OPS.has(insn.op) && insn.value !== END_OF_CODE) code.writeUInt32LE(at(insn.value), w + 1);
        else if (insn.op === SKIP_OP) code.writeUInt32LE(at(insn.offset + 9 + insn.value2) - (w + 9), w + 5);
        else if (insn.op === 3 && constants.has(insn.offset)) code.writeUInt32LE(constants.get(insn.offset) >>> 0, w + 1);
        check(sizes[i] === insn.size, "Internal G2 size error.");
    });
    const parts = [b.subarray(0, 17)];
    for (const symbol of program.symbols) {
        const head = Buffer.alloc(8); head.writeUInt32LE(at(symbol.code), 0); head.writeUInt32LE(symbol.name.length, 4);
        parts.push(head, symbol.name);
    }
    const labels = Buffer.alloc(4 + 4 * program.labels.length); labels.writeUInt32LE(program.labels.length, 0);
    program.labels.forEach((target, i) => labels.writeUInt32LE(at(target), 4 + 4 * i));
    parts.push(labels, b.subarray(program.tableStart + 4 * program.labels.length, codeBase), code);
    return Buffer.concat(parts);
}
// Proves that a rebuilt script is the same program: every instruction, jump,
// call, menu handler, symbol and label points at the corresponding instruction.
function verifyRelocation(original, rebuilt, constants = new Map(), insertions = new Map()) {
    const a = g2Program(original), b = g2Program(rebuilt), ia = instructionIndex(a), ib = instructionIndex(b);
    const fail = message => { throw new Error("Rebuilt G2 verification failed: " + message); };
    if (a.statementCount !== b.statementCount || a.instructions.length + insertions.size !== b.instructions.length) fail("instruction count");
    if (a.symbols.length !== b.symbols.length || a.labels.length !== b.labels.length) fail("table sizes");
    const entries = [], originals = [];
    let cursor = 0;
    function verifyExtra(bytes) {
        const ins = b.instructions[cursor++];
        if (ins?.op !== 1 || ins.value !== bytes.length ||
            !rebuilt.subarray(b.codeBase + ins.offset + 5, b.codeBase + ins.offset + ins.size).equals(transformString(bytes, true))) fail("inserted dialogue");
    }
    for (const ins of a.instructions) {
        entries.push(cursor);
        const extra = insertions.get(a.codeBase + ins.offset);
        if (extra?.before) verifyExtra(extra.before);
        originals.push(cursor++);
        if (extra?.after) verifyExtra(extra.after);
    }
    entries.push(cursor);
    const same = (x, y) => ia.has(x) && ib.has(y) && entries[ia.get(x)] === ib.get(y);
    a.instructions.forEach((x, i) => {
        const y = b.instructions[originals[i]];
        if (x.op !== y.op) fail("opcode at instruction " + i);
        if (STRING_OPS.has(x.op)) return;
        if (ABSOLUTE_OPS.has(x.op)) {
            if ((x.value === END_OF_CODE) !== (y.value === END_OF_CODE) || (x.value !== END_OF_CODE && !same(x.value, y.value))) fail("target of instruction " + i);
        } else if (x.op === SKIP_OP) {
            if (x.value !== y.value || !same(x.offset + 9 + x.value2, y.offset + 9 + y.value2)) fail("skip at instruction " + i);
        } else if (x.value !== y.value && !(x.op === 3 && constants.get(x.offset) === y.value)) fail("operand of instruction " + i);
    });
    a.symbols.forEach((s, i) => { if (!s.name.equals(b.symbols[i].name) || !same(s.code, b.symbols[i].code)) fail("symbol " + i); });
    a.labels.forEach((t, i) => { if (!same(t, b.labels[i])) fail("label " + i); });
}
// Text windows are configured by native 0x1011 (SetRect x, y, characters, 0) in
// Platform_Start of both PRIME4.G2 and ROOM.G2. The handler (0x16C1D0) stores
// characters x 5 render slots; drawn English uses about three slots per
// character, so the Japanese sizes crop longer lines (observed in PCSX2: the
// dialogue window stopped after ~80 characters at 50; 120 showed the full text).
const TEXT_WINDOWS = [
    {rect: [192, 350, 50, 0], characters: 120},   // dialogue window
    ...[[92, 317], [140, 214], [380, 214], [64, 243], [456, 243], [260, 193]].map(([x, y]) => ({rect: [x, y, 9, 0], characters: 16}))
];
function textWindowConstants(b) {
    const {instructions} = g2Program(b), found = new Map();
    for (let i = 4; i < instructions.length; i++) {
        if (instructions[i].op !== 5 || instructions[i].value !== 0x1011) continue;
        const args = instructions.slice(i - 4, i);
        if (!args.every(x => x.op === 3)) continue;
        const window = TEXT_WINDOWS.find(w => w.rect.every((v, k) => args[k].value === v));
        if (window) found.set(args[2].offset, window.characters);
    }
    return found;
}
function dataset(b, name) {
    const result = {data: [], context: [], parameters: [], tags: [], indexIds: Object.create(null)};
    for (const token of readResource(b, name).strings) {
        let row = result.indexIds[token.text];
        if (row === undefined) {
            row = result.data.length; result.indexIds[token.text] = row;
            result.data.push([token.text, ""]); result.context.push([]); result.parameters.push([]); result.tags.push([]);
        }
        result.context[row].push(token.context.join("/"));
        result.parameters[row].push({byteLength: token.byteLength, ...occurrenceLimits(token.kind, token.byteLength, token.text),
            ...(token.parts ? {inlineParts: token.parts.map(p => p.marker || {context: p.token.context.join("/"), source: p.token.text})} : {}),
            offset: token.offset, statement: token.statement, rowInfoText: token.rowInfoText || "",
            ...(token.opcode === 1 ? {speakerKind: token.speakerKind, speakerSource: "pm4-name-command"} : {}),
            ...(Number.isInteger(token.speakerVariable) ? {speakerVariable: token.speakerVariable} : {})});
    }
    check(result.data.length, "No translatable text in " + name); return result;
}
function lookup(token, options) {
    const pairs = options.translationPair || {}, keys = [token.context.join("/") + "\n" + token.text];
    const group = options.translationInfo?.groupLevel || 0;
    if (group > 0) keys.push(token.context.slice(0, group).join("/") + "\n" + token.text);
    keys.push(token.text);
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(pairs, key) && typeof pairs[key] === "string" && pairs[key] !== "") return pairs[key];
    return token.parts ? token.parts.map(part => part.marker || lookup(part.token, options)).join("") : token.text;
}
function codes(text) { return text.match(/%[-+0 #]*\d*(?:\.\d+)?[diuoxXfFeEgGcs%]|\\[^n]/g) || []; }
// Returns changes keyed by the string's byte offset (G2) or line number (items).
// Only problems that break the export or the game block it: characters CP932
// cannot store, changed % codes, and text over HARD_BYTE_LIMIT (the ~1 KB
// message buffer at window+0x64). byteLimit() values are layout estimates
// (box widths, slot pools: overflow crops or spills text, nothing crashes), so
// exceeding them is a warning, like line counts. Stray control characters
// (never intended in game text) are removed with a warning.
const HARD_BYTE_LIMIT = 960;
const CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
function resourceChanges(b, name, options = {}) {
    const changes = new Map(), insertions = new Map(), issues = [], warnings = [], rows = new Map(), unique = new Map();
    function report(list, token, row, target, bytes, message) {
        const key = JSON.stringify([list === issues, row, target, message]), existing = unique.get(key);
        if (existing) { existing.contexts.push(token.context.join("/")); return; }
        const entry = {file: name, row, source: token.text, target, byteLength: bytes?.length, budget: token.maxBytes,
            context: token.context.join("/"), contexts: [token.context.join("/")], message};
        list.push(entry); unique.set(key, entry);
    }
    for (const token of readResource(b, name).strings) {
        if (!rows.has(token.text)) rows.set(token.text, rows.size);
        const row = rows.get(token.text);
        let target = display(lookup(token, options)); if (target === token.text) continue;
        const errors = [], notes = [];
        CONTROL_CHARACTERS.lastIndex = 0;
        if (CONTROL_CHARACTERS.test(target)) { target = target.replace(CONTROL_CHARACTERS, ""); notes.push("removed an invisible control character"); }
        if (JSON.stringify(codes(target)) !== JSON.stringify(codes(token.text))) errors.push("preserve % placeholders and control codes in order");
        const markers = token.parts?.filter(p => p.marker) || [];
        const pieces = target.split(/(\{\{[^{}\n]*\}\})/g);
        if (pieces.some((s, i) => i % 2 === 0 && /\{\{|\}\}/.test(s)) ||
            JSON.stringify(pieces.filter((_, i) => i % 2)) !== JSON.stringify(markers.map(p => p.marker))) {
            errors.push("preserve the runtime variable placeholders in order: " + markers.map(p => p.marker).join(" "));
        }
        let bytes, chunks;
        try {
            chunks = pieces.filter((_, i) => i % 2 === 0).map(s => strictEncode(s.replace(/\n/g, "\\n")));
            bytes = Buffer.concat(chunks);
        } catch (e) { errors.push(e.message); }
        if (bytes && bytes.length > HARD_BYTE_LIMIT) {
            errors.push("translation uses " + bytes.length + " CP932 bytes; maximum is " + HARD_BYTE_LIMIT + " (the message buffer; shorten by " + (bytes.length - HARD_BYTE_LIMIT) + " bytes)");
        } else if (bytes && bytes.length > token.maxBytes) {
            notes.push("uses " + bytes.length + " CP932 bytes, over the recommended " + token.maxBytes + "; it may not fit its box");
        }
        if (errors.length) { report(issues, token, row, target, bytes, errors.join("; ")); continue; }
        if (notes.length) report(warnings, token, row, target, bytes, notes.join("; "));
        if (!markers.length) changes.set(/\.G2$/i.test(name) ? token.offset : token.line, bytes);
        else {
            let index = 0;
            for (let i = 0; i < token.parts.length; i++) {
                const part = token.parts[i];
                if (part.token) {
                    changes.set(part.token.offset, chunks[index]);
                    continue;
                }
                if (i === 0 && chunks[index].length) insertions.set(part.start, {before: chunks[index]});
                index++;
                if (!token.parts[i + 1]?.token && chunks[index].length) insertions.set(part.call, {after: chunks[index]});
            }
        }
    }
    return {changes, insertions, issues, warnings};
}
function warningLines(warnings, limit = 50) {
    const lines = warnings.slice(0, limit).map(w => w.file + ": row " + (w.row + 1) + " (" + w.context + "): " + w.message + ".");
    if (warnings.length > limit) lines.push("... and " + (warnings.length - limit) + " more.");
    return lines;
}
function translationError(issues) {
    const lines = issues.slice(0, 50).map(i => i.file + ": row " + (i.row + 1) + " (" + i.context + "): " + i.message + ".");
    if (issues.length > 50) lines.push("... and " + (issues.length - 50) + " more issues.");
    const error = new Error("Cannot export: " + issues.length + " invalid translation" + (issues.length === 1 ? "" : "s") + ". Shorten over-limit text, keep placeholders, and remove invalid characters.\n" + lines.join("\n"));
    error.name = "PM4TranslationError"; error.issues = issues; return error;
}
function validateResource(b, name, options = {}) { return resourceChanges(b, name, options).issues; }
function resourceWarnings(b, name, options = {}) { return resourceChanges(b, name, options).warnings; }
// Translations may be longer or shorter than the Japanese. G2 bytecode is
// relocated and verified; item lists are rejoined with their CRLF structure.
// expandTextWindows also raises the text windows' character capacity.
function rebuildResource(b, name, options = {}) {
    const {changes, insertions, issues, warnings} = resourceChanges(b, name, options);
    if (Array.isArray(options.warnings)) options.warnings.push(...warnings);
    if (issues.length) throw translationError(issues);
    let output;
    if (/\.G2$/i.test(name)) {
        const constants = options.expandTextWindows ? textWindowConstants(b) : new Map();
        if (!changes.size && !constants.size) return Buffer.from(b);
        output = relocateG2(b, changes, constants, insertions);
        verifyRelocation(b, output, constants, insertions);
    } else {
        if (!changes.size) return Buffer.from(b);
        // CP932 trail bytes are 0x40-0xFC, so CR LF never occurs inside a character.
        const lines = [];
        for (let start = 0; ;) {
            const end = b.indexOf("\r\n", start);
            lines.push(end < 0 ? b.subarray(start) : b.subarray(start, end));
            if (end < 0) break; start = end + 2;
        }
        for (const [line, bytes] of changes) lines[line] = bytes;
        output = Buffer.concat(lines.flatMap((line, i) => i ? [Buffer.from("\r\n"), line] : [line]));
    }
    readResource(output, name); return output;
}
async function parseFile(sourcePath) { return dataset(await fs.promises.readFile(sourcePath), path.basename(sourcePath)); }
async function writeFile(sourcePath, destinationPath, options = {}) {
    check(path.resolve(sourcePath).toLowerCase() !== path.resolve(destinationPath).toLowerCase(), "Original resources are read-only.");
    const output = rebuildResource(await fs.promises.readFile(sourcePath), path.basename(sourcePath), options);
    await fs.promises.mkdir(path.dirname(destinationPath), {recursive: true});
    await fs.promises.writeFile(destinationPath, output, {flag: "wx"}); return destinationPath;
}
async function readAt(handle, offset, size, totalSize) {
    check(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && size <= 32 * 1024 * 1024 && offset + size <= totalSize, "Invalid ISO extent.");
    const b = Buffer.alloc(size); let done = 0;
    while (done < size) { const {bytesRead} = await handle.read(b, done, size - done, offset + done); check(bytesRead > 0, "Unexpected end of ISO."); done += bytesRead; }
    return b;
}
async function isoFiles(handle, base, imageSize, regionSize = imageSize - base, records = undefined) {
    const pvd = await readAt(handle, base + 16 * SECTOR, SECTOR, imageSize);
    check(pvd.subarray(0, 7).equals(Buffer.from([1, 67, 68, 48, 48, 49, 1])), "Expected an unencrypted ISO9660 filesystem.");
    check(pvd.readUInt16LE(128) === SECTOR, "Only 2048-byte ISO sectors are supported.");
    const files = [], visited = new Set();
    async function walk(lba, size, prefix = "", depth = 0) {
        check(depth < 16 && !visited.has(lba), "Invalid ISO directory tree."); visited.add(lba);
        check(lba * SECTOR + size <= regionSize, "ISO directory is outside its container.");
        const b = await readAt(handle, base + lba * SECTOR, size, imageSize);
        for (let p = 0; p < b.length;) {
            const n = b[p]; if (!n) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; }
            range(b, p, n); check(n >= 34 && b[p + 32] <= n - 33, "Invalid ISO directory record.");
            const recordOffset = base + lba * SECTOR + p, r = b.subarray(p, p + n); p += n;
            const id = r.subarray(33, 33 + r[32]); if (id.length === 1 && id[0] < 2) continue;
            check(!(r[25] & 0x80) && r[1] === 0 && r[26] === 0 && r[27] === 0, "Multi-extent/interleaved ISO resources are unsupported.");
            const entryLba = u32(r, 2), entrySize = u32(r, 10);
            check(entryLba === r.readUInt32BE(6) && entrySize === r.readUInt32BE(14), "ISO endian fields disagree.");
            check(entryLba * SECTOR + entrySize <= regionSize, "ISO resource is outside its container.");
            const name = id.toString("ascii").replace(/;\d+$/, "");
            check(!/[\\/]/.test(name) && name !== "..", "Invalid ISO filename.");
            if (r[25] & 2) await walk(entryLba, entrySize, prefix + name + "/", depth + 1);
            else {
                files.push({name: prefix + name, offset: base + entryLba * SECTOR, size: entrySize});
                records?.set(prefix + name, {lba: entryLba, size: entrySize, recordOffset});
            }
        }
    }
    await walk(u32(pvd, 158), u32(pvd, 166)); return files;
}
// Directory records of the embedded CVM image, for resources that change size.
async function cvmDirectory(handle, imageSize) {
    const outer = await isoFiles(handle, 0, imageSize), data = outer.find(f => f.name === "DATA.BIN");
    check(data, "DATA.BIN is missing.");
    const base = data.offset + 0x1800, regionSize = data.size - 0x1800, records = new Map();
    await isoFiles(handle, base, imageSize, regionSize, records);
    return {base, regionSize, records};
}
const sectors = bytes => Math.ceil(bytes / SECTOR);
// Text resources that outgrow their sectors move into space reclaimed from
// their own old extents and the debug-menu scripts TEST.G2/DEVTEST.G2
// (prime4.g2 loads them only from its developer menu). ROOM.G2 is directly
// followed by TEST.G2, so it can grow to 2,116 sectors in place. DATA.BIN has
// no free space at its end, and the ISO size never changes.
function planExtents(records, sizes, reclaimable = TEST_FILES) {
    const placement = new Map(), moving = [];
    for (const [name, size] of sizes) {
        const record = records.get(name); check(record, "Missing ISO record " + name);
        if (sectors(size) <= Math.max(1, sectors(record.size))) placement.set(name, record.lba); else moving.push(name);
    }
    if (!moving.length) return {placement, reclaimed: []};
    const pool = moving.concat(reclaimable.filter(name => records.has(name) && !sizes.has(name)));
    const regions = [];
    for (const [start, end, name] of pool.map(n => [records.get(n).lba, records.get(n).lba + sectors(records.get(n).size), n]).sort((a, b) => a[0] - b[0])) {
        const last = regions[regions.length - 1];
        if (last && start <= last.end) { last.end = Math.max(last.end, end); last.names.push(name); } else regions.push({start, end, names: [name]});
    }
    for (const [name, record] of records) {
        if (pool.includes(name) || !record.size) continue;
        const start = record.lba, end = record.lba + sectors(record.size);
        check(!regions.some(r => start < r.end && r.start < end), "ISO layout is not supported: " + name + " overlaps reclaimable space.");
    }
    const used = new Set();
    for (const name of moving.sort((a, b) => sizes.get(b) - sizes.get(a))) {
        const need = sectors(sizes.get(name)), region = regions.find(r => r.end - r.start >= need);
        check(region, name + " is " + sizes.get(name) + " bytes and does not fit the space available on the disc (largest free area: " +
            Math.max(...regions.map(r => (r.end - r.start) * SECTOR)) + " bytes). Shorten some translations.");
        placement.set(name, region.start);
        for (const other of pool) {
            const r = records.get(other);
            if (r.lba < region.start + need && region.start < r.lba + sectors(r.size)) used.add(other);
        }
        region.start += need;
    }
    return {placement, reclaimed: reclaimable.filter(name => used.has(name))};
}
function directoryEntry(lba, size) {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(lba, 0); b.writeUInt32BE(lba, 4); b.writeUInt32LE(size, 8); b.writeUInt32BE(size, 12); return b;
}
async function inspectIso(isoPath, options = {}) {
    const handle = await fs.promises.open(isoPath, "r");
    try {
        const stat = await handle.stat(), outer = await isoFiles(handle, 0, stat.size);
        const system = outer.find(f => f.name === "SYSTEM.CNF"), data = outer.find(f => f.name === "DATA.BIN");
        check(system && data, "Not a supported Princess Maker 4 PS2 disc.");
        const config = (await readAt(handle, system.offset, system.size, stat.size)).toString("ascii");
        check(/SLPM_659\.36;1/.test(config), "Only the Japanese PS2 release SLPM_659.36 is supported.");
        check((await readAt(handle, data.offset, 4, stat.size)).toString("ascii") === "CVMH", "DATA.BIN is not a CRI CVM container.");
        const inner = await isoFiles(handle, data.offset + 0x1800, stat.size, data.size - 0x1800), resources = [];
        for (const name of MAIN_FILES.concat(options.includeTestScripts ? TEST_FILES : [])) {
            const record = inner.find(f => f.name === name); check(record, "Missing PS2 resource " + name);
            const b = await readAt(handle, record.offset, record.size, stat.size); readResource(b, name);
            resources.push({...record, sha256: hash(b)});
        }
        const manifest = {format: 1, serial: "SLPM_659.36", isoSize: stat.size, resources};
        if (options.includeImages || options.includeAllImages) {
            if (options.includeAllImages) manifest.includeAllImages = true;
            manifest.imageResources = [];
            const isSheet = options.includeAllImages ? name => /^[A-Z0-9_]+\.SPD$/.test(name) : imageCodec.isImageCandidate;
            for (const record of inner.filter(f => isSheet(f.name))) {
                const b = await readAt(handle, record.offset, record.size, stat.size), layout = imageCodec.parseSpd(b);
                manifest.imageResources.push({...record, sha256: hash(b), width: layout.width, height: layout.height});
            }
        }
        if (options.includeKeyboard) {
            manifest.keyboardResources = [];
            for (const name of keyboard.resources(options.includeLongNames)) {
                const record = (name === "SLPM_659.36" ? outer : inner).find(r => r.name === name);
                check(record, "English keyboard resource is missing: " + name);
                const b = await readAt(handle, record.offset, record.size, stat.size);
                if (name === "SLPM_659.36") keyboard.inspectExecutable(b, options.includeLongNames);
                else {
                    const image = imageCodec.parseSpd(b);
                    const [width, height] = name === keyboard.NAME_PROMPT ? [456, 496] : [640, 448];
                    check(image.width === width && image.height === height, "Unsupported keyboard sheet dimensions: " + name);
                }
                manifest.keyboardResources.push({...record, sha256: hash(b)});
            }
        }
        return manifest;
    } finally { await handle.close(); }
}
async function hashFile(file) {
    const digest = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest("hex");
}
async function extractImages(isoPath, destinationDir, options = {}) {
    const manifest = await inspectIso(isoPath, {...options, includeImages: true});
    if (options.expectedSha256) check(await hashFile(isoPath) === options.expectedSha256, "Source ISO checksum differs from the project.");
    await fs.promises.mkdir(destinationDir, {recursive: true});
    const handle = await fs.promises.open(isoPath, "r"), files = [];
    try {
        for (const record of manifest.imageResources) {
            const b = await readAt(handle, record.offset, record.size, manifest.isoSize);
            check(hash(b) === record.sha256, "Source image changed during extraction: " + record.name);
            const image = imageCodec.decodeSpd(b), png = imageCodec.encodePng(image), name = record.name.replace(/\.SPD$/, ".png");
            const destination = path.join(destinationDir, name);
            // Staging originals are immutable: repeat extraction verifies rather
            // than overwriting a file an artist might have painted accidentally.
            if (fs.existsSync(destination)) check((await fs.promises.readFile(destination)).equals(png), "Extracted PNG already exists with different content: " + destination);
            else await fs.promises.writeFile(destination, png, {flag: "wx"});
            files.push({...record, pngPath: destination, pixelSha256: hash(image.data)});
            options.onProgress?.(files.length, manifest.imageResources.length);
        }
    } finally { await handle.close(); }
    return {manifest, files};
}
class pm4Ps2Project {
    static async scan(entryPoint, options = {}) {
        const isoPath = path.resolve(entryPoint), manifest = await inspectIso(isoPath, options.init || options);
        manifest.isoSha256 = await hashFile(isoPath);
        const sourceDir = options.stagingDir || await fs.promises.mkdtemp(path.join(os.tmpdir(), "tpp-pm4-"));
        await fs.promises.mkdir(sourceDir, {recursive: true});
        const handle = await fs.promises.open(isoPath, "r");
        try {
            for (const r of manifest.resources) {
                const b = await readAt(handle, r.offset, r.size, manifest.isoSize); check(hash(b) === r.sha256, "Source ISO changed during import.");
                await fs.promises.writeFile(path.join(sourceDir, r.name), b, {flag: "wx"});
            }
        } finally { await handle.close(); }
        return {sourceDir, files: manifest.resources.map(f => f.name), manifest, isoPath};
    }
}
async function detectpm4Ps2(entryPoint) { try { await inspectIso(entryPoint); return true; } catch (_) { return false; } }
async function exportIso(sourcePath, destinationPath, options = {}) {
    const expected = options.manifest;
    check(expected?.format === 1 && /^[a-f0-9]{64}$/.test(expected.isoSha256 || ""), "Project source manifest is missing. Recreate this project.");
    check(path.resolve(sourcePath).toLowerCase() !== path.resolve(destinationPath).toLowerCase(), "Cannot overwrite the source ISO.");
    const longNames = keyboard.usesLongNames(options);
    const actual = await inspectIso(sourcePath, {includeTestScripts: expected.resources.some(f => TEST_FILES.includes(f.name)),
        includeImages: Boolean(expected.imageResources), includeAllImages: expected.includeAllImages === true,
        includeKeyboard: keyboard.isEnabled(options), includeLongNames: longNames});
    check(JSON.stringify(actual.resources) === JSON.stringify(expected.resources) && actual.isoSize === expected.isoSize, "The source ISO no longer matches this project.");
    if (expected.imageResources) check(JSON.stringify(actual.imageResources) === JSON.stringify(expected.imageResources), "Source image resources no longer match this project.");
    for (const name of Object.keys(options.images || {})) check(expected.imageResources?.some(r => r.name === name), "Unrecognized PM4 image replacement: " + name);
    const handle = await fs.promises.open(sourcePath, "r"), patches = [], issues = [], warnings = [];
    let directory, plan = {placement: new Map(), reclaimed: []};
    try {
        for (const record of expected.resources) {
            const selected = options.translations?.[record.name]; if (!selected) continue;
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            try {
                const output = rebuildResource(original, record.name, {...selected, warnings});
                if (!output.equals(original)) patches.push({record, output, resizable: true});
            } catch (error) {
                if (error.name !== "PM4TranslationError") throw error;
                issues.push(...error.issues);
            }
        }
        // Translated text needs larger text-window render pools. Both game scripts
        // run the same window setup, so patch both whenever any text changed.
        if (!issues.length && patches.length && options.expandTextWindows !== false) {
            for (const record of expected.resources.filter(r => r.name === "ROOM.G2" || r.name === "PRIME4.G2")) {
                const original = await readAt(handle, record.offset, record.size, expected.isoSize);
                const output = rebuildResource(original, record.name, {...(options.translations?.[record.name] || {}), expandTextWindows: true});
                const existing = patches.find(p => p.record.name === record.name);
                if (existing) existing.output = output; else if (!output.equals(original)) patches.push({record, output, resizable: true});
            }
        }
        if (patches.some(p => p.resizable && p.output.length !== p.record.size)) {
            directory = await cvmDirectory(handle, expected.isoSize);
            plan = planExtents(directory.records, new Map(patches.filter(p => p.resizable).map(p => [p.record.name, p.output.length])));
        }
        for (const record of expected.imageResources || []) {
            const png = options.images?.[record.name]; if (!png) continue;
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            let output;
            try { output = imageCodec.rebuildSpd(original, imageCodec.decodePng(png)); }
            catch (error) { throw new Error(record.name + ": " + error.message); }
            if (!output.equals(original)) patches.push({record, output});
        }
        for (const record of actual.keyboardResources || []) {
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            const existing = patches.find(p => p.record.name === record.name);
            const current = existing?.output || original;
            let output;
            if (record.name === "SLPM_659.36") output = keyboard.patchExecutable(original, longNames);
            else if (record.name === keyboard.NAME_PROMPT) output = keyboard.patchNamePrompts(current);
            else output = keyboard.patchKeyboardSheet(original, current, record.name === "ENTRY2A.SPD" ? 0 : 1);
            if (existing) existing.output = output;
            else if (!output.equals(original)) patches.push({record, output});
        }
    } finally { await handle.close(); }
    if (issues.length) throw translationError(issues);
    // Validate every translation before copying. Stream the copy and digest to
    // keep memory bounded even in 32-bit NW.js. Publish only after verification.
    await fs.promises.mkdir(path.dirname(destinationPath), {recursive: true});
    const temporary = destinationPath + "." + crypto.randomBytes(6).toString("hex") + ".partial"; let ownsTemporary = false;
    try {
        const reserved = await fs.promises.open(temporary, "wx"); ownsTemporary = true; await reserved.close();
        const digest = crypto.createHash("sha256");
        await pipeline(fs.createReadStream(sourcePath), new Transform({transform(chunk, encoding, callback) { digest.update(chunk); callback(null, chunk); }}), fs.createWriteStream(temporary));
        check(digest.digest("hex") === expected.isoSha256, "Source ISO checksum differs from the imported disc.");
        const target = await fs.promises.open(temporary, "r+");
        const writeAll = async (data, at) => {
            for (let done = 0; done < data.length;) { const {bytesWritten} = await target.write(data, done, data.length - done, at + done); check(bytesWritten > 0, "Unable to write patched ISO."); done += bytesWritten; }
        };
        const moved = [];
        try {
            if (directory) {
                // Blank every extent being rewritten or reclaimed, then place the
                // resized resources and update their directory records.
                for (const name of [...plan.placement.keys(), ...plan.reclaimed]) {
                    const r = directory.records.get(name);
                    await writeAll(Buffer.alloc(sectors(r.size) * SECTOR), directory.base + r.lba * SECTOR);
                }
                for (const name of plan.reclaimed) await writeAll(directoryEntry(directory.records.get(name).lba, 0), directory.records.get(name).recordOffset + 2);
            }
            for (const patch of patches) {
                const {record, output} = patch;
                if (directory && plan.placement.has(record.name)) {
                    const r = directory.records.get(record.name), lba = plan.placement.get(record.name);
                    const padded = Buffer.alloc(sectors(output.length) * SECTOR); output.copy(padded);
                    await writeAll(padded, directory.base + lba * SECTOR);
                    await writeAll(directoryEntry(lba, output.length), r.recordOffset + 2);
                    patch.offset = directory.base + lba * SECTOR;
                    if (lba !== r.lba || output.length !== r.size) moved.push({name: record.name, size: output.length, offset: patch.offset});
                } else {
                    check(output.length === record.size, "Internal error: " + record.name + " changed size without a directory update.");
                    await writeAll(output, record.offset); patch.offset = record.offset;
                }
                check((await readAt(target, patch.offset, output.length, expected.isoSize)).equals(output), "Patched resource verification failed: " + record.name);
            }
            if (directory) {
                // The rewritten directory must describe exactly the planned layout.
                const after = await cvmDirectory(target, expected.isoSize);
                for (const [name, before] of directory.records) {
                    const now = after.records.get(name), patch = patches.find(p => p.record.name === name);
                    const want = patch && plan.placement.has(name) ? {lba: plan.placement.get(name), size: patch.output.length}
                        : plan.reclaimed.includes(name) ? {lba: before.lba, size: 0} : before;
                    check(now && now.lba === want.lba && now.size === want.size, "ISO directory verification failed: " + name);
                }
            }
            await target.sync();
        } finally { await target.close(); }
        // Atomic exclusive hard link within the output directory. Never replaces
        // an existing file, including another hard link to the original disc.
        await fs.promises.link(temporary, destinationPath);
        return {path: destinationPath, patchedFiles: patches.map(p => p.record.name), size: expected.isoSize, resized: moved, reclaimed: plan.reclaimed,
            warnings, warningLines: warningLines(warnings)};
    } finally { if (ownsTemporary) await fs.promises.unlink(temporary).catch(() => {}); }
}
module.exports = {pm4Ps2Project, parseFile, writeFile, detectpm4Ps2, inspectIso, extractImages, exportIso, readG2, readItems, dataset, rebuildResource, validateResource, transformString, hashFile,
    byteLimit, BYTE_LIMITS, HARD_BYTE_LIMIT, LINE_WIDTH, resourceWarnings, warningLines, occurrenceLimits, g2Program, relocateG2, verifyRelocation, textWindowConstants, TEXT_WINDOWS, planExtents};
