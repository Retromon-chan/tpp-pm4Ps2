# Case map: Princess Maker 4 PS2

Which part of this add-on to read for each kind of change. Read only the
section you need.

| Problem | Targeted source/reference |
|---|---|
| Outer ISO, embedded CVM/ISO extents, streamed export | [Format plan](../plan/README.md), Disc structure; `pm4Ps2.module.js` |
| G2CD0460 transform, instruction widths, jumps, fixed slots | Format plan, G2CD0460 / Rewriting sections; module `WORD_OPS`, `SINGLE_OPS`, `validateResource` |
| Speaker flow, custom daughter/father names | Format plan, Speaker metadata; module name-state/control-flow analysis |
| SPD/TIM2 tiles, alpha and PNG re-import | Format plan, SPD/TIM2 section; `pm4Ps2.images.js`, `pm4Ps2.image-ui.js` |
| ABC/abc native keyboard and coupled label edits | Format plan, Optional keyboard; `pm4Ps2.keyboard.js` and `pm4Ps2.keyboard.test.js` |
| Actual host options, selectors, Update | `pm4Ps2.js`, image UI module and [README](../README.md) |

Use heading/symbol searches and bounded reads. PM4's plan is long because it
contains several independent features; a G2 text fix does not require loading
the image, keyboard and emulator sections together.

Here fixed-size writing preserves bytecode offsets and image extents. The keyboard uses
existing two-byte full-width Latin key slots and changes tables plus two sprite
sheets; it is not a scenario ASCII font replacement.

Evidence: native image round trips and re-extraction were checked; the user
confirmed translated dialogue and English name entry/display in PCSX2. The plan
records which keyboard boundaries/save-reload and broader artwork playback have
not been individually reported. Preserve that distinction in new claims.

Run only the affected module/image/keyboard suite, then the host checks that
the change requires, using [AGENTS.md](../AGENTS.md).
