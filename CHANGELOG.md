# Changelog

## 0.6.0 (2026-11-26)

- Dialogue interrupted by a player name or another directly printed string variable now appears as one row. Keep the inline codes (for example `{{daughter}}` and `{{father}}`) when translating. Update Project from Source combines existing fragment translations. Export and Inject restore the game's runtime variable commands.

- Translations can now be longer than the Japanese. Dialogue and item descriptions take up to 180 bytes (longer letters up to twice the Japanese), choices and names 24 (status messages 1.5× the Japanese), item names 18. The toolbar shows each row's limit next to the Japanese length.
- Line breaks are free: a different line count, moved blank lines and lines wider than about 34 characters are warnings in the editor and never block Inject or Export.
- Exports enlarge the text windows so longer English is no longer cut off after about 80 characters.
- A script that outgrows its disc space reuses the space of the developer-menu test scripts. The ISO size is unchanged.
- Em dashes (—) and similar punctuation from editors and AI translation are converted to their Shift-JIS forms instead of being refused. Errors for unsupported characters now name the character.
- Existing projects are upgraded to the new limits when opened. Saves made before re-exporting may not resume correctly.

## 0.5.2 (2026-11-26)

- New projects include an editable Actor Reference with character names, pronouns, and speech guidance for AI translation. The player-named daughter is labeled Daughter.
- Added compact, language-neutral prompts and CP932 refinement checks. Requires Translator++ 8.11.9 or newer.

## 0.5.1 (2026-11-26)

- Fixed missing speaker names on dialogue that continues across page advances and portrait changes, including lines spoken by the player-named daughter.

## 0.5.0 (2026-11-26)

- Added a 12-character English name option in Inject. The surname and given name use half-width letters, and the keyboard parchment has been cleaned up.

## 0.4.1 (2026-11-26)

- Fixed injection and PNG export for projects with empty image translation rows, including sheets edited in Krita.

## 0.4.0 (2026-11-26)

- Load all 1,263 game artwork sheets, including CGs without text, in a new project or from the Tools menu. Edit them in Krita or export and re-import PNGs to create a patched ISO.

## 0.3.1 (2026-11-25)

- Added a character portrait icon for the add-on and its New Project entry.

## 0.3.0 (2026-11-25)

- First release on GitHub. Install it from Translator++ under Options → Add-ons → Install → Community add-ons.
