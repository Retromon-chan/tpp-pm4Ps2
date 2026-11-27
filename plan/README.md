# Measured format: Princess Maker 4 PS2 / SLPM_659.36 and the Japanese PC release

Source inspected: Japanese PS2 ISO, 1,379,336,192 bytes. Research supplied by the
user: `pm4-english-patch/TRANSLATING IT YOURSELF.txt` and readable Python sources.
These describe the PC release. Only the G2 string transform and CP932 text
encoding carry over; PS2 resource discovery and VM parsing were measured anew.

## Disc structure

- Outer ISO9660, 2048-byte sectors; `SYSTEM.CNF` boots `SLPM_659.36;1`.
- `DATA.BIN`: LBA 332, length 1,354,997,760, starts `CVMH`.
- The unencrypted embedded ISO9660 starts at `DATA.BIN + 0x1800`. Its PVD is
  at embedded sector 16. Directory entries provide resource offsets and lengths.
- No complete ISO or CVM is held in memory. Directory reads are bounded and
  resource buffers are small. Export hashes a streamed copy of the original,
  writes only the changed resources (see "Disc space for longer text"),
  rereads those ranges and the rewritten directory, then publishes
  through an exclusive hard link. Outputs require a filesystem supporting hard
  links (such as NTFS). Existing outputs are never overwritten.

| Resource | Absolute ISO offset | Bytes | Distinct rows | Occurrences |
| --- | ---: | ---: | ---: | ---: |
| ROOM.G2 | 806836224 | 2163247 | 10455 | 14976 |
| PRIME4.G2 | 806756352 | 67978 | 25 | 30 |
| ITEM_NAM.TXT | 806750208 | 979 | 88 | 89 |
| ITEM_MSG.TXT | 806746112 | 3215 | 89 | 89 |

Offsets are observations, never hardcoded patch destinations. Directory parsing
checks both endian copies, range limits, nesting, and unsupported multi-extent
or interleaved files. Only this serial and the unencrypted CVM layout are accepted.

## Executable UI text

The original outer `SLPM_659.36` ELF has a return-to-title prompt at file
offset `0x18c140`, a birthday format at `0x18c160`, and 29 CP932 memory-card
prompts from `0x18c560` to `0x18d1f0`. Both birthday fields pass the same
format to the formatter from code at `0x1eca30` and `0x1ecb1c`.

Import these strings only when the ELF matches the retail SHA-256 used by the
keyboard patch. Keep each string at its original offset and within its original
byte length plus terminator. The three decimal conversions must stay in
year/month/day order. Dialogues keep their original maximum line count and use
literal LF. The fixed-size ELF patch can be combined with either English keyboard
mode. A project saved before these rows were supported can still export from
its original manifest.

## G2CD0460

Header layout, as read by the ELF loader at 0x17FB40 (not inferred from the files):

- Eight-byte magic, marker `0x1b`, u32 statement limit at +9, u32 symbol count at +13.
- At +17: symbols `[u32 code offset][u32 length][scrambled CP932 name]`. In
  ROOM.G2, all 3,122 entries are function entries on instruction boundaries.
- Then `[u32 label count][label count × u32 code offset]`. In ROOM.G2 there are
  10,447 labels, and `labels[N]` is the position of the instruction `14 N`.
- The loader skips to the next `1b`. The retail scripts then begin with
  `1b 20 01000000 20 02000000`, which the parser requires.
- Code offsets are relative to the byte immediately after that `1b`.
- `01`, `02` and `0f`: u32 byte length, then scrambled text.

Versions up to 0.5.2 read this header one field off: an "opaque u32 at +17",
then `[length][name][code]`. That made every symbol's offset look like the
next symbol's. It also turned PRIME4's label count (72) into a "stale
`sell_item` symbol at 72", and the label count into an extra table entry.
Extraction worked either way; relocation needs the real layout. The
correction changes none of the 15,004 retail speaker labels.
- `stored[i] = (plain[i] + i + byteLength) & 255`.
- Literal `\n` means an in-game line break. Item files use actual CRLF between
  entries, a blank first/header line, and 89 item lines.

Instruction operand widths are recorded in the module's WORD_OPS, SINGLE_OPS,
STRING_OPS and SKIP_OP. They follow the interpreter's dispatch chain at
0x1791A0 in the ELF. All four scripts parse from start to exact EOF, with
sequential `20`/`21` statement IDs ending at the header statement limit minus
one. Every label and symbol lands on an instruction boundary. Unknown opcodes,
invalid counts, bounds, and broken targets are rejected instead of falling back
to scanning bytes.

These operands hold code offsets (ABSOLUTE_OPS):
- `07` JMP, `08` JZ, `09` JNZ, `0a` CALL: absolute; 0xFFFFFFFF means end.
- `13` PUSHADDR: absolute. It runs the same handler as `03` (0x17D900) but
  always carries a function entry address. All 199 in ROOM.G2 (5 in PRIME4.G2)
  register choice-menu handlers: `13 hc_set0; 02 "<choice>"; 05 0x118F`. No
  `03` constant is used as an address.
- `0c` SKIP `[u32][u32 relative]`: not used on this disc, handled anyway.

ROOM.G2 has 26,449 string operands total (10,637 opcode 01 and 15,812 opcode 02).
Only nonempty dialogue and Japanese-bearing short strings are exposed.

Test/development scripts: TEST.G2 (2,167,728 bytes, 26,790 string operands),
DEVTEST.G2 (2,149,105 bytes, 26,371 string operands). They are optional.

## Rewriting and limitations

Every replacement is CP932 encoded and checked against its limit (`byteLimit`,
below). In G2 scripts the new text is written at its exact length, and the
bytecode is relocated:
- symbol and label tables,
- the operands of `07`–`0a` and `13`,
- the relative operand of `0c`.

`verifyRelocation` then re-decodes the output. It requires the same
instructions, operands, symbol names and table sizes, and every target must
map to the corresponding instruction. Item lines are rejoined with their CRLF
structure.

Cross-check on the retail ROOM.G2: with the same five translations, this
writer and an independent Python implementation (not shipped) produce
byte-identical files. That implementation's verifier also accepts this
writer's output.

Limits per occurrence (`byteLimit`, stored as parameter `maxBytes`, shown in the toolbar):

| Kind | Rule | Reason |
| --- | --- | --- |
| dialogue (`01`) | ≤3 source lines: max(JP, 360) | about three pages; each page must fit the slot pool (see below) |
| item description | ≤3 source lines: max(JP, 180) | item window, not paged |
| dialogue with more lines (letters, endings) | max(JP, min(960, max(2×JP, 360))) | ~1 KB text buffer at window+0x64, strcpy/strcat at 0x16E5A0 |
| short string (`02`) | max(JP, 24, ⌈1.5×JP⌉) | choices (Japanese ≤9 characters) stay at 24; longer status/result strings get ordinary expansion |
| item name | max(JP, 18) | item list slot pool, shared by 5 rows |

These are warnings. Export errors are CP932 failures, changed `%`/`{{…}}`
codes, and a page over `HARD_BYTE_LIMIT` (960, the message buffer).

Line breaks are plain `\n` text to the engine, so export never rejects a line
count. The text layout loop at 0x14D270 handles only `\r`, `\t` and `\n`
(x back to the margin, y += 24 px × scale) and has no width check: **the game
never wraps**. Each `\n` line is one screen row, and a line that is too wide
runs past the box (the user's 57-character test line). In Translator++, the
validation rules `lineCount`, `blankLines` and `lineWidth` (dialogue
`maxCharsPerLine` 34) are warnings, and the AI prompt asks for breaks at
about 34 characters. The 99th percentile of Japanese lines is 34 bytes (17
full-width characters); the real pixel width has not been measured.

### Pages

Native `0x1105` (handler 0x1663A0) waits for a button, then clears the box;
`0x1104` (0x1663D0) waits without clearing, so the next `MSG` is appended
(0x16E5A0 copies after a clear and appends otherwise). The script writes
`STMT n; ARGS; SYSCALL 0x1105` after a message. In ROOM.G2 all ~9,550 boxes
closed by `0x1105` hold one message (or inline group) of at most 3 lines;
`0x1104` chains (narration, closed by `0x1002`) reach 9 lines.

`resourceChanges` pages a dialogue occurrence when its translation has more
lines than max(3, Japanese lines) and the next wait after its last `MSG` is
not `0x1104`. `paginate` marks a page turn (`\f`) after every such number of
lines, dropping blank lines at the top of a page and keeping trailing breaks
on the last page. Each page turn becomes `ARGS; SYSCALL 0x1105` and the next
page a new `MSG`: inserted after the original `MSG` (or before it, when a
page starts right after an inline `{{name}}`), or next to the inline print
for literal text that had no `MSG` of its own. No `STMT` is added, so the
statement count, save statement ids and the speaker are unchanged.
`relocateG2` accepts lists of these encoded instructions before or after an
original instruction; jumps to that instruction land on the code inserted
before it. `verifyRelocation` checks every inserted instruction byte for byte
(only `MSG`, `ARGS` and `SYSCALL 0x1105` are allowed).

Projects saved by 0.5.2 or earlier budget by `byteLength`. On load,
`applyProjectDefaults` refreshes the generated `maxBytes`, `textKind`, width
constraint and note using the same rule (the parameters then match a fresh
import). `relaxLineRules` downgrades a blocking `lineCount`/`blankLines`
policy to warnings once per project, flagged by `pm4LineRulesRelaxed`. The
stored engine prompt is replaced only while it is still an unedited old default.

### Text window capacity

Native `0x1011` is SetRect(x, y, characters, 0), handler 0x16C1D0. It stores
characters × 5 at window+0x28. The renderer created at 0x16E3F0 gets that
many 32-byte slots (0x14C888: `n*32 + 0x3a0`) and a `(n*256 + 0x600)*2`-byte
draw buffer. Text past the pool is silently not drawn.

`Platform_Start` in both PRIME4.G2 and ROOM.G2 creates the windows:
- the dialogue window `(192,350,50,0)` (the `03 50` at code offset 63),
- six small windows `(…, 9, 0)` at code offsets 210, 923, 1054, 1335, 1466 and 1597,
- the full-screen letter window `(32,24,640,480)`.

In PCSX2 the user saw an English line stop after about 80 characters with 50,
and display in full with 120. Whenever any text resource changes, export
rewrites these constants in both scripts (`TEXT_WINDOWS`, matched by their
exact arguments): dialogue 50 → 120, small windows 9 → 16. The small windows'
purpose is inferred, not observed. Set `expandTextWindows: false` to skip it.

The 5-row shop and inventory item list (`ItemList`, vtable `0x290240`) renders
item names through its own `TextLayer` (`this+0x4c`) initialized in
`ItemList::Init` (`0x156930`) via `TextLayer::Init` (`0x156c50`, vtable
`0x2902b0+0x2c`) with `addiu a2, zero, 50` (`0x24060032`) at `0x1569c8` (file
offset `0x56a48` in `SLPM_659.36`). `TextLayer::Init` allocates `a2 × 4`
render slots and `((a2 × 1024) + 0x600) × 2` bytes of double-buffered font
packet DMA space, so 50 gives 200 slots and 105,472 bytes. In game (Clothier
shop, user screenshot) this overflowed (`0x14d688` `"Font Packet Buffer Over
flow !!!!!"`) after 41 visible ASCII characters across the five rows, cropping
the fifth row's name to `"M"`. Whenever `ITEM_NAM.TXT` is patched and
`expandTextWindows !== false`, `exportIso` patches the verified retail ELF at
`0x56a48` to `addiu a2, zero, 150` (`0x24060096`), giving 600 slots and a
310,272-byte buffer (matching the expanded dialogue window). This composes with
native UI text edits and both English keyboard modes, and also discovers
`SLPM_659.36` on demand for older manifests that omit it. On 2026-11-27 the
user confirmed in PCSX2 that all five Clothier shop rows—including the fifth
row `"Martial Outfit"`—now render in full. (The same screenshot also confirmed
that the bottom description box fits ~34–35 half-width characters per line.)

### Disc space for longer text

DATA.BIN has no free sectors: VOICE.AFS ends at the CVM volume's last
sector. A resource that still fits its own sectors is rewritten in place, and
its directory size is updated. Otherwise `planExtents` merges touching extents
from two sources:
- the resource's own old extent,
- the developer scripts TEST.G2 and DEVTEST.G2. PRIME4 loads `script\test.g2`
  and `script\devtest.g2` only from its developer menu. They are excluded if
  the export changes them.

It then places resources first-fit, largest first. ROOM.G2 (sector 393628) is
followed directly by TEST.G2, so it can reach 2,116 sectors (4,333,568 bytes)
in place. Reclaimed entries keep their sector but get size 0, so the
developer menu's loader rejects them. Freed sectors are zeroed. After writing,
the embedded directory is re-read and must match the plan exactly.

Retail stress export through `exportIso`:
- Every one of 9,977 distinct dialogue rows became 30 ASCII characters per
  non-blank line, with codes kept.
- ROOM.G2 grew from 2,163,247 to 2,343,027 bytes, and TEST.G2 was reclaimed.
- The independent Python implementation extracted the result: it is the same program
  with 10,621 strings changed. DEVTEST.G2 and all 1,279 other files are
  byte-identical, and the ISO size is unchanged.

Saves store the raw script position plus up to 16 verification bytes, and the
last statement id (thread save at 0x17B4D0). Saves made on another build of
the text may not resume at the same point.

Empty/missing targets preserve original bytes. Text-only, exact-context, and
ParserBase-style group lookup use the same contexts on import and export.
Duplicates retain all locations and parameters, with the minimum applicable
budget shown in the grid toolbar.

## Speaker metadata

The retail script uses native command `0x2100` to control the name plate:
`(1, literal string)` sets a name, `(0)` clears it, and `(1, string variable)`
uses a runtime name. ROOM.G2 has 3,851 literal-name calls, 185 clears, and 2,551
runtime-variable calls (2,547 use variable 2; four use variable 3).
PRIME4.G2 initializes variable 2 with パトリシア and variable 3 with ヘイス via
native `0x1801`; dialogue using variable 2 addresses Papa, while variable 3
describes adopting the daughter and receiving Cube's reports. These are the
daughter/father custom-name slots. Row info displays their roles as
`Daughter` and `Father (custom name)`, retaining the numeric slot
in `speakerVariable`. The chosen name itself cannot be recovered from the ISO.
The Cube tutorial sets `キューブ` in statement 1482,
then plays voice `7022` via `0x1620` and displays the status explanation in
statement 1483. This matches the user's running-game screenshot.

The parser tracks the active name across page advances (`0x1105`), sprite
show/hide (`0x1501`/`0x1502`), voice (`0x1620`), and string operations used to
build sprite paths (`0x1801`, `0x1803`–`0x1805`, `0x1809`). In the retail
ROOM.G2, one `0x2100` sets the daughter's name in statement 33516. The dialogue
in statements 33517, 33520, 33523, 33526, and 33529 shares that name across
page advances and calls to the portrait routines at code offsets `0xf02` and
`0x7bd`. Those routines return without changing the name plate.

The name analysis follows `0x07` directly to its target and merges both paths
for `0x08` and `0x09`. It preserves the caller's name across a direct `0x0a`
script call when every reachable operation in the callee and its nested
calls is name-preserving. It seeds function entries as unknown. Explicit
name commands, unverified operations inside callees, and disagreeing branch
paths can leave the speaker unresolved.

Each dialogue occurrence carries `speakerKind` (`literal`, `runtime`, `none`, or
`unknown`) and `speakerSource: pm4-name-command`. Existing per-occurrence contexts
and row deduplication are unchanged, so a repeated row may have several speakers.
The normal Translator++ row-info display and Actor Reference lookup handle them.

The original full ISO checksum is saved in the project. Export verifies it while
copying, in addition to reparsing/hashing every supported resource. A different
or changed source fails before publication. Validation failures remove only the
private partial output, never the original or an existing finished export.

Synthetic tests cover structured extraction, speakers, duplicates/context/group
lookup, no-op byte identity, translated edits, placeholders, newline preservation,
CP932/size errors, malformed VM/ISO, whole-ISO unrelated-byte preservation,
exclusive destinations, source checksum mismatches, and partial-file cleanup.
Translation preflight aggregates every invalid row across all selected resources,
deduplicating repeated occurrences of the same error while retaining contexts.
Errors carry structured `issues` and display one-based grid row numbers and byte
reductions. `validateResource()` runs the same checks without writing output.
No emulator or hardware playback result is claimed.

## SPD/TIM2 image extraction and re-import

The 80 curated interface candidates match W_*, TMENU*, ENTRY*, SCHD01–23,
HAR01–14, ALBUM1–3, MAP01/MAP02A/MAP02B, EXPLA, and LOGO1–3. This includes
some non-lettered/decorative sheets; it avoids character/face and ordinary scene
art. The full artwork import discovers all 1,263 `.SPD` files in the embedded
ISO root. These include event and ending CGs, backgrounds, character sheets,
portraits and thumbnails. All 1,263 on the inspected disc use the layout below.

- SPD header: `SPD\0`, u32 total size, u32 section count, reserved u32. At +16,
  sections are 16-byte records: u32 ID, size, offset, reserved. Section 1 holds
  TIM2; sections 2/3 hold sprite/frame data and stay byte-identical.
- TIM2 revision 4, alignment 0, count at +6. This game uses the normally reserved
  +8/+10 fields for total sheet width/height. Pictures have standard 48-byte
  headers (layout reference: [OpenKh TIM2 documentation](https://openkh.dev/common/tm2.html)).
- Tiles are at most 256×256, stored **column first, then down each column**.
  Edge tile dimensions exactly match the remaining sheet width/height.
- Supported pictures are ImageType 3, GS PSMCT32, no CLUT, one mipmap level,
  linear RGBA bytes. No swizzle/indexed conversion is attempted or guessed.
- Stored alpha is 0–128. PNG expansion is round(a×255/128), and insertion is
  round(a×128/255), giving an exact inverse for every original stored alpha.
- Only picture payload bytes are rewritten. SPD/TIM2 headers, sprite positions,
  texture registers, frame definitions and every resource/ISO length stay fixed.

The PNG bridge encodes lossless 8-bit RGBA and reads non-interlaced 8-bit RGBA,
RGB, indexed and grayscale PNGs, with all five PNG row filters and CRC checks.
Unsupported depths/interlacing or changed dimensions fail before ISO creation.

New projects can opt into all artwork, with optional OCR on the interface subset.
The Tools menu adds all artwork without OCR. The project keeps the selected
scope for updates, and export verifies the manifest using that scope. Existing
interface-only projects keep that scope until all artwork is added.
Decoded originals are staged at `images/pm4/*.png`, with `type: image` entries
and `pm4Image` resource provenance. Even empty OCR results remain editable.
External PNG imports become versioned Krita/replacement layers; the Original
layer is hidden to avoid double compositing the sprite's translucent edges.
Only translated text boxes paint over sheets. Untranslated OCR boxes are not
masked. These PM4-specific renderer/Krita hooks leave other engines unchanged.

Inject uses Image Translator's `imageTranslatorFiles` map while it temporarily
hides image entries, rebuilds the sheets inside the ISO, and sets
`imageTranslatorHandled` to suppress loose-image output. Folder/ZIP exports use
the same path. Unedited sheets are never rendered or re-encoded during export.
Updates retain boxes, translations, styles and paint/inpaint layer files when
the source sheet hash matches. Unknown or changed sources require review.

Real validation: 80 original sheets passed exact PNG round trips. A status-sheet
VIT test was exported, re-imported, saved/reopened, injected through the normal
application wrapper, and extracted from the resulting ISO. Its native bytes
equal the expected replacement. The other 79 image resources, sprite metadata,
unrelated disc bytes, and original ISO were unchanged. The working project's
temporary VIT test layer was restored afterward. Image gameplay verification is
left to the user; only the earlier text patch has their playback confirmation.

Full artwork validation on the retail disc decoded and rebuilt all 1,263
sheets byte-for-byte. A one-pixel edit to `EV01.SPD` was re-extracted from
the patched ISO and matched the edited PNG. Only three bytes changed across
the whole ISO, all inside that pixel's native payload.

## Optional PS2 English name-entry keyboard

The original outer `SLPM_659.36` ELF is 1,643,332 bytes at LBA 661952,
SHA256 `c673ed7fedf9e1532279c86728a11da8ac7422c1f864e5ddbd6256dcf620c4b3`.
Its hiragana/katakana key tables begin at file offsets `0x18bf00`/`0x18bfc0`.
Each has six top-to-bottom rows, 15 CP932 two-byte keys per row, a two-byte zero
terminator, and a 32-byte row stride. Row-pointer arrays at `0x13bfc0`/`0x13bfd8`
point to these tables. The original full kana table signatures must be unique;
missing/ambiguous signatures, already-patched input, and non-MIPS ELF fail.

The ELF character map contains full-width Latin upper/lowercase letters and
digits. The patch uses those two-byte CP932 characters, retaining the game's
fixed character-slot representation and name limit. ASCII bytes with padding
zeros and PC-edition keyboard offsets are not used. Only the two 192-byte table
regions change; executable instructions and pointers stay intact.

Both 640×448 `ENTRY2A.SPD`/`ENTRY2B.SPD` sheets are patched too. Keys are centered
at `(68+36*column, 168+36*row)`; the four bottom buttons are ABC, abc, Back, OK.
Dark lettering is removed using the neighboring parchment. Restoring the four
original button regions first removes flat strips baked into older caption edits.
The add-on's transparent overlays contain only newly rendered Latin typography.
No retail artwork or executable content is shipped. The original sprite layout,
dimensions and alpha encoding are retained. Existing image edits outside key
and button masks survive; masks deliberately replace edits inside those areas.

Inject's JSONForm boolean `custom.pm4EnglishKeyboard` uses `flipSwitch` and is
false on each opening. The core also accepts explicit boolean `englishKeyboard`
for portable callers. Enabling it validates/discovers all three resources and
applies the pictures and tables together after normal text/image patches.
Disabling it leaves those resources on the normal export path. Older saved
projects need no migration; keyboard source resources are discovered on demand.

Synthetic tests cover native mapping, padding/terminators, guarded input,
unchanged executable bytes and image pixels outside masks, opt-in serialization,
and whole-ISO off/on round trips. Real Inject UI testing confirms default-off,
boolean submission, a separate output ISO and default-off on reopening. The
retail output's three keyboard resources equal the expected patches; unrelated
disc bytes and the source ISO hash are unchanged. Four CommonJS modules load
after NW.js compilation, including both overlay assets.

The resulting retail disc boots in the user's installed PCSX2 v2.8.2 and reaches
the title screen. This used an isolated data directory and copies of the user's
existing BIOS, without changing their normal emulator setup or saves. On
2026-11-01 the user confirmed successful English character-name entry. Their
gameplay screenshot shows mixed-case English names rendered in the status panel
and dialogue speaker plate. Name entry, confirmation and subsequent in-game
rendering are therefore user-verified. Save/reload persistence, every punctuation
and digit key, Back, and the maximum-length boundary have not been individually
reported as gameplay-tested; these are remaining regression checks, with no known
implementation defect or required keyboard work outstanding.

### Optional 12-character English names

The long-name Inject switch also enables the English keyboard. It requires the
retail ELF hash above. Both key tables keep their two-byte stride and terminators.
An active key supplies one ASCII byte, while blank slots keep their native marker.
Both input handlers enforce the same 12-byte limit as before. The append, delete,
cached length and automatic focus paths now use that byte count. Only the checked
words in `LONG_NAME_INSTRUCTIONS` and the two key tables are changed in the ELF.
The preview uses the native ASCII font, a smaller size and no six-slot underlines.
`ENTRY5.SPD` replaces the surname and given-name prompts within the first 72 rows
of its 456×496 atlas. Other prompts and sprite records stay intact.

On 2026-11-26 an isolated PCSX2 test of the retail build accepted 12 characters
in each field and rendered both names together. The subsequent smaller preview
and parchment cleanup address the clipping and background observed in that run.


### Inline runtime string printing

On SLPM_659.36 a direct string print is statement 21, reset 06, load string
variable 42 (u32 slot), native 05 (0x100A). In ROOM.G2 the dialogue operands
at 0x7143c and 0x71463 surround a print of slot 2. Slot 3 is the father's
name. Other directly printed slots retain their decimal numbers in the editor.
Only adjacent dialogue and prints with one control-flow entry are joined.
Computed arguments and calls without adjacent dialogue remain ordinary VM code.
The writer preserves the calls and can insert a dialogue operand at either end
of a print when required by translated word order. Relocation verification
checks each added operand and all original control-flow targets.


Across all four retail scripts the direct-print scan found slots 2, 3, 4, 9,
10, 11, 12 and 17. In ROOM.G2 the adjacent dialogue groups use slots 2, 3, 4
and 17. Slot 17 appears in messages about using items and changing clothes,
so the editor keeps its numeric identifier rather than assuming a person.

## Japanese PC release (2005)

Source inspected: the game folder of the Japanese PC release (`PM4.exe`,
`script` 1,270,064 bytes, SHA-256 `bf719f0d…db09e`, `data`, `gd`). The
community English patch's `TRANSLATING IT YOURSELF.txt` describes the archive;
the points below were re-measured on that folder.

- `script`, `data` and `gd` are GCEX archives: `"GCEX"`, u64 index offset at
  +8, entry data from +0x10 back to back, then a `GCE3` index (u32 flags at
  +4, u32 index size at +8, crc32 of the index with +0x14 zeroed at +0x14,
  u32 count at +0x18, 32-byte records with u64 unpacked size at +0x10 and u64
  stored size at +0x18, then `[u16 length][name]`). Entry offsets are the
  running total of stored sizes. The index ends the file.
- Index flag 0x10 (`script`): each entry is a chain of `GCE0` (stored) or
  `GCE1` (LZP) blocks that adds up exactly to the unpacked size; one block
  unpacks to at most 0x40020 bytes. Flag 0 (`data`): entries are raw.
  `GCE1` is `[u32 unpacked][u32 0][u32 literal bytes][u32 literal bytes]
  [u32 control bytes]`, then the literals and an MSB-first control stream of
  gamma codes: a literal-run length, then a match length minus one. A match
  has no offset; it starts where the last two output bytes were last seen.
  `pm4Ps2.gcex.js` unpacks all 16 retail entries identically to the English
  patch's decoder, and the test fixture encoder reproduces a retail 256 KiB
  block's exact compressed size.
- `script` holds `album.txt`, `item_msg.txt`, `item_nam.txt`, `pm4img.txt`,
  `prime4.g2`, `prime4.g2m` and `room.g2` (2,492,052 bytes). Only the four text
  resources are imported. The exporter stores changed entries as GCE0 blocks
  of 0x40000 bytes (the English patch installs its archive the same way),
  copies every other entry byte for byte, and recomputes the index crc.
- The G2 scripts are the same G2CD0460 format, cipher and instruction set:
  the PS2 parser decodes them with no unknown bytes, statement and jump checks
  pass, and relocation verifies. Differences: a line break inside a string is
  a 0x0A byte, not `\n` text (8,726 messages, no `\n` text at all), so the
  writer keeps line feeds for scripts that use them. Item lists use `\n` text
  on both releases.
- ROOM.G2 on PC has 11,671 messages and 11,231 distinct rows (PS2: 10,455);
  9,873 of the PS2's 9,978 distinct messages are identical after normalizing
  line breaks. Page waits follow the PS2 pattern: 10,729 `0x1105`, 328
  `0x1104`, and 10,464 messages directly followed by `STMT; ARGS; 0x1105`.
  505 direct string prints (`0x100A`) give 420 inline rows.
- `Platform_Start` calls `0x1011` with pixel rectangles, e.g. dialogue
  `(198, 380, 440, 70)`, not the PS2's `(x, y, characters, 0)`. No
  `TEXT_WINDOWS` rectangle matches, so no capacity patch is applied on PC.
  Whether long English needs a different PC limit has not been tested.
- The script starts by binding five glyphs to pictures in `data`: `㍍`
  `s_heart.bmp`, `㌍` `s_q.bmp` ("!?"), `㌦` `s_a.bmp` (あ゛), `㌫`
  `s_n.bmp` (ん゛), `㌣` `s_v.bmp` (う゛); 22×22 BMPs.
- The English patch reports that the stock executable creates its fonts with
  charset 0, so two-byte characters lose their first byte unless the system
  locale is Japanese, and that `PM4.exe` is SafeDisc-protected. The add-on
  changes only `script`.

Export resolves the project's original by checksum from `script.orig_backup`
or `script`, writes through a temporary file and a rename, keeps an original
`script` as `script.orig_backup` before replacing it, and never replaces a
non-original `script` in a folder containing an `.exe` or `gd` without that
backup. Not yet confirmed in the PC game: playback of relocated and paged
scripts, and the 2.5 MB uncompressed `script` with a larger `room.g2`.
