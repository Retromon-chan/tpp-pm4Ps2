# Princess Maker 4 (PS2 & PC)

A [Translator++](https://dreamsavior.net/docs/translator/) add-on for translating and modding both the Japanese PlayStation 2 (`SLPM_659.36`) and Windows PC (2005) releases of *Princess Maker 4*.

> **Note:** This repository provides the parser and build tools, not a pre-made English patch. You will need your own clean Japanese PS2 ISO (`SLPM_659.36`) or Japanese PC release.

![Princess Maker 4 title screen with the English main menu][cover]

## Why

I’ve found that the AI-assisted MCP tools and skills in [Translator++](https://dreamsavior.net/docs/translator/) make retro game translation much faster and more affordable. I built this add-on so I could translate *Princess Maker 4* myself, write natural English without fighting Japanese byte limits, and leave the door open for other languages and artwork mods.

The add-on handles PS2 disc structures, G2 bytecode relocation, PC GCEX archives, SPD/TIM2 texture sheets, and native name-entry tables automatically—so anyone who wants to localize the game or mod its graphics can focus on writing and art instead of binary patching.

## Sample

<!-- To enable GitHub's native inline video player, open README.md in the GitHub web editor and drag showcase/english-sample.mp4 (8.8 MB) here -->
[![Watch the English gameplay sample (MP4, 8:46)][video-thumb]][video]

[Watch / Download the English gameplay sample (MP4, 8:46)][video]

![Patricia speaking natural English in her bedroom with full English UI and stats][dialogue]

### 12-character English names (“Patricia Hywell”)

Enable the optional PS2 English keyboard on export to replace the kana screens with **ABC / abc**, digits, and punctuation. Its 12-character mode supports up to **12 half-width characters each** for both surname and given name—so you can use the daughter’s official name, **Patricia Hywell**, and see it carried into the status panel, save slots, and dialogue.

| Status screen (`Patricia Hywell`) | 12-character English name entry |
| --- | --- |
| ![English status screen displaying Patricia Hywell and localized stat labels][status] | ![Name-entry screen with Patricia Hywell entered on the 12-character English keyboard][name-entry] |

### Relaxed text budgets & automatic multi-page messages

You don’t have to cram or abbreviate English to fit the original Japanese byte length. The writer relocates the G2 script bytecode, updates every internal offset, and enlarges the PS2 text and item-list buffers automatically—allowing up to **360 bytes per dialogue row** (~3 pages of English) while keeping the ISO size unchanged.

*Princess Maker 4* displays **3 lines per dialogue box**. Whenever a translation runs longer than 3 lines, export automatically creates a new page with the same speaker preserved—the player simply presses a button to continue reading.

| Page 1 (3 lines fill the box) | Page 2 (auto-created continuation) |
| --- | --- |
| ![Leron speaking on page 1 with three full lines and the continue heart prompt][multipage-1] | ![Leron continuing seamlessly on page 2 with the same speaker plate and portrait][multipage-2] |

### Supports both PS2 and PC releases

One add-on covers both the PlayStation 2 disc and the 2005 Japanese Windows release, using the same script relocation, relaxed byte budgets, automatic multi-page splitting, and `{{daughter}}` / `{{father}}` runtime name placeholders.

| Feature | PS2 (`SLPM_659.36`) | PC (2005 Japanese) |
| --- | --- | --- |
| Story, choices, items & relaxed byte budgets | Yes | Yes |
| Automatic multi-page dialogue (> 3 lines) | Yes | Yes |
| Enlarged text windows & 5-row shop item buffer | Automatic | Not needed (pixel box) |
| Save / memory-card / system prompts (`SLPM_659.36`) | Yes | — |
| 12-character English name-entry keyboard | Optional (Inject) | — |
| Graphical UI & all 1,263 CG/sprite sheets | Yes (PNG / Krita) | — |
| Safe non-destructive output | Separate `.translated.iso` | Rebuilds `script` (keeps `script.orig_backup`) |

## Inside Translator++

### Graphical UI & interface sheets

New PS2 projects automatically extract **80 editable interface sheets** (menus, buttons, album screens, status labels) with optional OCR. Edit baked-in UI text directly in **Image Translator**, paint whole sheets in **Krita**, or export and re-import lossless PNGs.

![Album interface buttons translated in Translator++ Image Translator][ui-textures]

### Event CGs & game artwork for modding

Enable **Include all game artwork (including CGs)**—or add them later from the **Tools** menu—to extract all **1,263 SPD/TIM2 sprite sheets** from the disc, including event and ending CGs, backgrounds, character sprites, and portraits. Edited PNGs are repacked directly into the exported ISO.

![Event CG LEV37 open inside Translator++ alongside the extracted artwork browser][cg-browser]

### Speaker context & AI prompts

New projects come pre-populated with an editable **Actor Reference** (names, pronouns, and speech guidance, including **Daughter**) and game-specific prompts under **Translator → Prompts** so Translator++’s AI translators and MCP workflow keep character voices consistent.

## Quick start

### 1. Install
Requires Translator++ **8.11.9 or later** ([Download Translator++](https://dreamsavior.net/download)).

* **Translator++ 8.11.25+:** Open **Options → Add-ons → Install → Community add-ons**, install **Princess Maker 4 (PS2 / PC) Parser**, and restart.
* **Manual install:** Follow the steps in the [Pismax add-on catalog](https://github.com/pismax/tpp-addons#install).

### 2. Create a project
Prepare a clean Japanese PS2 ISO (`SLPM_659.36`) or a clean Japanese PC release folder.

1. Select **New Project → Princess Maker 4 (PS2 / PC)**.
2. Choose your `.iso` (PS2) or `PM4.exe` / game folder (PC).
3. On PS2, 80 interface sheets are included by default; enable **Include all game artwork (including CGs)** if you also want all 1,263 sprite/CG sheets for editing or modding.
4. Pick your target language using the standard Translator++ controls.

### 3. Export and play
* **PS2:** Use **Export → Folder**, **ZIP**, or **Inject** to build a separate `<original>.translated.iso` (the original ISO is never modified). In **Inject**, optionally enable the **English name-entry keyboard** and **Allow 12 half-width characters per name field**.
* **PC:** Use **Inject** on the game folder to rebuild `script` (automatically backing up the original as `script.orig_backup`), or **Export → Folder** to output a `script` file you can copy in manually.

## Translation & modding reference

Detailed per-resource rules, byte limits, PC notes, and image workflows are documented in the **[Translation & Modding Guide](USAGE.md)**:

* **Text Constraints & Pagination:** Byte-limit table, G2 script relocation, automatic 3-line page turns, `{{daughter}}` / `{{father}}` placeholders, and CP932 punctuation handling.
* **PC Release Details:** GCEX `script` rebuilding, `script.orig_backup` safety checks, locale notes, and PS2 vs. PC differences.
* **English Keyboard:** Standard 6-character vs. 12-character half-width input modes and affected SPD sheets.
* **Artwork & PNG Modding:** Image Translator, Krita editing, lossless PNG export/re-import, and ISO repacking rules.
* **Development & Tests:** Module layout and automated verification suite.

---

*Independent community add-on. Not affiliated with Dreamsavior, GAINAX, or GeneX.*

[cover]: showcase/cover.png
[video]: showcase/english-sample.mp4
[video-thumb]: showcase/video-thumb.png
[dialogue]: showcase/dialogue.png
[status]: showcase/status.png
[name-entry]: showcase/name-entry.jpg
[multipage-1]: showcase/multipage-1.png
[multipage-2]: showcase/multipage-2.png
[ui-textures]: showcase/ui-textures.jpg
[cg-browser]: showcase/cg-browser.jpg
