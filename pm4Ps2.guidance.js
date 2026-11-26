"use strict";

const REFERENCE = "Actor Reference";
const LEGACY_DAUGHTER = "Daughter (custom name)";
const gamePrompt = "Fantasy life sim with family, school, work, and court scenes. Use Actor Reference for names, pronouns, and register. Keep choices and effects unambiguous, follow the project glossary, and reveal relationships only when the scene does. Localize expressive dialogue glyphs ㌍ and ㍍ by emotion.";
const enginePrompt = "G2 and item text use fixed CP932 slots. Each line break uses two stored bytes. Keep printf widths and order (e.g. %2d), and fit repeated text to its smallest slot. The game supplies speaker plates and player-chosen names separately. Shorten wording within the row; keep its original pages.";

// Project-local spellings and voice directions based on the PS2 script. Gender
// stays unknown where a speaker label or the available context is ambiguous.
const actors = [
    ["Daughter", "Daughter", "f", "Player-named; warm and lively at home, more formal or guarded when the scene calls for it."],
    ["Father (custom name)", "Father", "m", "Player-named adoptive father; brief, direct, and caring with his daughter."],
    ["キューブ", "Cube", "m", "Courteous butler; composed and deferential, with dry asides and occasional hesitation."],
    ["クリスチーナ", "Christina", "f", "Polished and expressive; aristocratic courtesy with competitive bite."],
    ["リーゼ", "Lise", "f", "Blunt, spirited, and competitive; challenge and praise alike are direct."],
    ["マリー", "Marie", "f", "Gentle, enthusiastic, and easily flustered; occasional stammer."],
    ["カレン", "Karen", "f", "Mischievous and playful; preserve meaningful silences."],
    ["シャルル", "Charles", "m", "Polished and friendly; courteous in public, warmer in private."],
    ["ヴァロア", "Varoa", "m", "Guarded and terse; dry understatement, with warmth emerging in private."],
    ["リー", "Lee", "m", "Friendly, easygoing, and candid; lively when excited."],
    ["クライス", "Kreis", "m", "Unhurried, observant, and dry; speaks with quiet confidence."],
    ["テレサ", "Teresa", "f", "Polished shopkeeper; welcoming and attentive, with precise descriptions."],
    ["シラク", "Chirac", "m", "Upbeat restaurant owner; direct, practical, and proud of his craft."],
    ["グレージュ", "Greige", "m", "Measured and courteous; gives calm, practical guidance."],
    ["アール", "Arl", "m", "Relaxed shopkeeper; plainspoken, brisk, and inviting."],
    ["サーナティア", "Sarnatia", "f", "Warm and expressive; welcoming, with gentle praise."],
    ["トリタム", "Toritam", "m", "Genial and informal; hearty greetings and practical instructions."],
    ["レロン", "Leron", "m", "Animated art teacher; effusive praise and expressive flourishes."],
    ["ケットシー", "Cait Sith", "m", "Personable merchant; polite, chatty, and curious."],
    ["魔王", "Demon King", "m", "Grave and authoritative; short, measured statements."],
    ["ウォーボルフ", "Warwolf", "m", "Stern sword instructor; plain, disciplined, and direct."],
    ["バエナバコタ", "Baenabakota", "m", "Booming, hearty, and shrewd; comfortable with blunt banter."],
    ["ファットマン", "Fatman", "m", "Practical proprietor; calm, workmanlike explanations and direct advice."],
    ["ナルサス", "Narsus", "m", "Older doctor; reassuring, dry, and given to plain admonitions."],
    ["パメラ", "Pamela", "f", "Talkative and determined; enthusiastic about rumors and royalty."],
    ["レイブ", "Rave", "m", "Friendly proprietor; casual, straightforward, and grateful."],
    ["国王", "King", "m", "Measured royal register; authority with occasional warmth."],
    ["ニエル", "Niel", "f", "Gentle and welcoming; clear encouragement and soft praise."],
    ["パンドン", "Pandon", "f", "Brisk market boss; tough, colloquial, and encouraging through challenges."],
    ["テツ", "Tetsu", "m", "Cheeky young informant; quick, teasing, and commercially minded."],
    ["ガーランド", "Garland", "m", "Intimidating and sardonic; spare, pointed remarks."],
    ["スナチネ", "Sunachine", "m", "Disciplined teacher; formal, economical instructions."],
    ["大臣", "Minister", "m", "Formal and exacting; measured judgments about behavior and etiquette."],
    ["レイ", "Rei", "f", "Vivacious and familiar; expressive reactions and cheerful chatter."],
    ["ハムル", "Hamuru", "m", "Gentle farm supervisor; patient, conversational, and practical."],
    ["司教", "Bishop", "m", "Courteous and ceremonial; uses measured religious language."],
    ["カイ", "Kai", "f", "Self-assured magic instructor; composed, clear, and encouraging."],
    ["占い師", "Fortune Teller", "u", "Familiar and theatrical; a seasoned storyteller with wry humor."],
    ["ドリアドル", "Doriadol", "u", "Courteous and restrained; short, measured responses."],
    ["ヴィーナ", "Vina", "f", "Warm, familiar, and expressive; plainspoken affection."],
    ["オールドマン", "Old Man", "m", "Genial elder; cautionary advice and nostalgic storytelling."],
    ["エマ", "Emma", "f", "Warm caregiver; friendly, patient, and clear with children."],
    ["グレイトン", "Grayton", "m", "Courtly retainer; ceremonious, gracious, and sometimes effusive."],
    ["王妃", "Queen Consort", "f", "Elegant in public; frank, warm, and impatient with ceremony in private."],
    ["執政官", "Regent", "m", "Formal official; observant, measured, and approachable in private."],
    ["エヴァ", "Eva", "f", "Welcoming and orderly; calmly explains duties."],
    ["伯爵", "Count", "m", "Upper-class and self-important; deliberate, with a dry edge."],
    ["ダラタン", "Daratan", "u", "Sales patter; energetic, repetitive, and slightly eccentric."],
    ["ギリアム", "Gilliam", "m", "Conversational and teasing; gives advice with dry humor."],
    ["門番", "Gatekeeper", "u", "Matter-of-fact; kindly to the daughter, firm about access."],
    ["ヴァーチュ", "Virtue", "u", "Grave and blunt; guarded when speaking about humans and war."],
    ["ウォルフ", "Wolf", "m", "Gruff foreman; clipped, colloquial, and focused on practical ability."],
    ["グロンソン", "Gronson", "u", "Very short phrases and pauses; literal and earnest."],
    ["セリーナ", "Selina", "f", "Polite but directive; precise about expectations as a parent."],
    ["謎の女性", "Mysterious Woman", "f", "Gentle and reserved; leave her identity implicit until the scene reveals it."],
    ["クマ", "Bear", "u", "Childlike, affectionate, and reassuring."],
    ["ステラ", "Stella", "f", "Formal and exacting; clear standards and precise directions."],
    ["ヨーダ", "Yoda", "u", "Familiar and observant; straightforward explanations."],
    ["隊長", "Captain", "u", "Commanding and brusque; sputters when flustered."],
    ["魔族Ａ", "Demon A", "u", "Coarse and taunting; drawn-out jeers."],
    ["ミーナ", "Mina", "f", "Haughty and polished; cutting politeness and class-conscious taunts."],
    ["クレア", "Claire", "u", "Playful competitor; casual encouragement with a competitive edge."],
    ["ランジェ", "Range", "u", "Cool and confident; measured challenges and pointed warnings."],
    ["シェリナ", "Sherina", "u", "Sporting and energetic; straightforward challenges, no condescension."],
    ["？？？", "???", "u", "Voice varies by scene; preserve the hidden identity."],
    ["司会者", "Announcer", "u", "Ceremonial public address; energetic festival introductions."],
    ["町人", "Townsperson", "u", "Everyday speech; register varies with the scene."],
    ["チンピラＡ", "Thug A", "u", "Mocking, coarse, and menacing."],
    ["なれなれしい男", "Overfamiliar Man", "m", "Pushy, flippant flirting."],
    ["男の子Ａ", "Boy A", "m", "Cocky, informal playground talk."],
    ["白馬の青年", "Young Man on a White Horse", "m", "Apologetic and courteous; polished register."],
    ["男の子Ｂ", "Boy B", "m", "Pugnacious and colloquial; short challenges."],
    ["かわいい女の子", "Cute Girl", "f", "Affected politeness; self-assured and dismissive."],
    ["魔族Ｂ", "Demon B", "u", "Coarse and threatening; emphatic challenges."],
    ["チンピラＢ", "Thug B", "u", "Rough and pushy; use clipped, colloquial taunts."],
    ["ドラゴン", "Dragon", "u", "Friendly, candid, and animated; warm humor."],
    ["ナンパ男", "Flirt", "m", "Glib, forward, and overfamiliar."],
    ["市民Ａ", "Citizen A", "u", "Angry, blunt crowd speech and shouted demands."],
    ["男の客", "Male Customer", "m", "Casual shopper; asks practical questions."],
    ["町の人", "Local", "u", "Casual street talk and excited gossip."],
    ["ウェイトレス", "Waitress", "f", "Polite service register; flustered and apologetic under pressure."],
    ["兵士", "Soldier", "u", "Brisk and forceful; clipped commands."],
    ["女の子Ａ", "Girl A", "f", "Blunt and snide; casual playground insults."],
    ["子供たち", "Children", "p", "Excited group reactions."],
    ["無愛想な青年", "Aloof Young Man", "m", "Terse and guarded; preserve silence and sparse replies."],
    ["貴族Ａ", "Noble A", "u", "Status-conscious, indignant, and condescending."],
    ["メイド", "Maid", "f", "Polite service speech; deferential when flustered."],
    ["商人１", "Merchant 1", "u", "Ornate and deferential sales patter."],
    ["女王", "Queen", "f", "Dignified public speech; more personal with family."],
    ["宮廷人Ａ", "Courtier A", "u", "Low-voiced, skeptical gossip."],
    ["屋台の親父", "Stallkeeper", "m", "Hearty and friendly; brisk street-sales patter."],
    ["市民Ｃ", "Citizen C", "u", "Angry crowd speech; short, aggressive outbursts."],
    ["強気な女の子", "Assertive Girl", "f", "Bold, familiar, and commanding."],
    ["観客たち", "Audience", "p", "Collective cheers and calls."],
    ["貴族Ｂ", "Noble B", "u", "Haughty and indignant; talks down to others."],
    ["お客Ｂ", "Patron B", "m", "Eager and informal, with respectful requests."],
    ["チンピラ", "Thug", "u", "Coarse, mocking, and threatening."],
    ["伝令", "Messenger", "u", "Urgent military reports; short, precise statements."],
    ["子供Ａ", "Child A", "u", "Eager and affectionate; simple, playful requests."],
    ["子供Ｂ", "Child B", "u", "Eager and playful; blurts out wants and protests."],
    ["客", "Customer", "u", "Informal speech; register varies with the scene."],
    ["客Ａ", "Customer A", "u", "Emotional gambling talk; frustrated exclamations."],
    ["客Ｂ", "Customer B", "m", "Boastful, informal gambling talk."],
    ["宮廷人Ｂ", "Courtier B", "u", "Cautious gossip; warns others to speak carefully."],
    ["男の子たち", "Boys", "p", "Rowdy group banter."],
    ["観客１", "Spectator 1", "u", "Loud, enthusiastic cheering."],
    ["青年", "Young Man", "m", "Courteous and composed."],
    ["オーク", "Orc", "u", "Upbeat, informal, and slightly eccentric."],
    ["お客Ａ", "Patron A", "u", "Respectful, excited, and grateful."],
    ["お客Ｃ", "Patron C", "u", "Eager and polite."],
    ["みんな", "Everyone", "p", "Speak as a group; brief collective reactions."],
    ["メイドＡ", "Maid A", "f", "Brisk service announcements."],
    ["メイドＢ", "Maid B", "f", "Polite and matter-of-fact about work."],
    ["メイドＣ", "Maid C", "f", "Polite but flustered; hesitant under pressure."],
    ["メイドたち", "Maids", "p", "Collective, cheerful service replies."],
    ["リーゼの母", "Lise's Mother", "f", "Personal and subdued; keep pauses."],
    ["参列客", "Guest", "u", "Warm ceremonial congratulations."],
    ["参列客男", "Male Guest", "m", "Warm, informal congratulations."],
    ["大臣の部下", "Minister's Aide", "u", "Brief and formal report."],
    ["女の子の声", "Girl's Voice", "f", "Bold and energetic offstage call."],
    ["子供", "Child", "u", "Excited and playful."],
    ["市民Ｂ", "Citizen B", "u", "Polite, earnest request."],
    ["店員", "Clerk", "u", "Casual, brisk customer service."],
    ["怪しい人", "Suspicious Person", "u", "Guarded; preserve silence and anonymity."],
    ["民衆", "Crowd", "p", "Collective countdowns and calls."],
    ["町の人Ａ", "Local A", "u", "Casual, enthusiastic cheers."],
    ["町の人Ｂ", "Local B", "u", "Blunt, excited street talk."],
    ["観客２", "Spectator 2", "u", "Boisterous festival talk."],
    ["観客３", "Spectator 3", "u", "Brief, exuberant cheering."],
    ["貴族たち", "Nobles", "p", "Collective reactions; follow the scene's status and tone."],
    ["魔族", "Demon", "u", "Follow the scene; keep the speaker unidentified."],
    ["魔族たち", "Demons", "p", "Collective roars and battle cries."]
];

const genders = {f: "female (she/her)", m: "male (he/him)", u: "unknown", p: "group (they/them)"};

function applyActorReference(project) {
    const existing = project.files[REFERENCE] || project.references?.[REFERENCE];
    if (existing) {
        const row = existing.data?.find(cells => cells?.[0] === LEGACY_DAUGHTER);
        if (!row || existing.data.some(cells => cells?.[0] === "Daughter")) return false;
        row[0] = "Daughter";
        existing.indexIsBuilt = false;
        existing.indexIds = {};
        existing.cacheResetOnChange = {};
        project.files[REFERENCE] = existing;
        (project.references ||= {})[REFERENCE] = existing;
        return true;
    }
    const file = {
        type: "reference", translationConstraintType: "reference", originalFormat: "PM4 PS2 Actor Reference",
        dirname: "*", basename: REFERENCE, filename: REFERENCE, path: REFERENCE, relPath: REFERENCE, extension: "",
        actorTranslationColumn: 1, actorInfoColumn: 2,
        data: actors.map(([name, translation, gender, speech]) => [
            name, translation === name ? "" : translation, "Gender: " + genders[gender] + ". Speech: " + speech
        ]),
        context: [], parameters: [], tags: [], indexIds: {}, indexIsBuilt: false,
        note: "Name spellings and speech guidance are editable. Unknown genders are left open for scene context."
    };
    project.files[REFERENCE] = file;
    (project.references ||= {})[REFERENCE] = file;
    return true;
}

function applyProjectDefaults(project) {
    if (project?.gameEngine !== "pm4Ps2") return false;
    project.options ||= {};
    let changed = applyActorReference(project);
    if (!project.options.translationConstraints) {
        project.options.translationConstraints = {
            enabled: true, preserveLineCount: false,
            types: {
                reference: {enabled: false},
                gameText: {
                    encoding: "cp932", preserveLineCount: true,
                    byteBudget: {mode: "parameter", parameter: "byteLength", encoding: "cp932"},
                    replacements: {"\r\n": "\\n", "\r": "\\n", "\n": "\\n"},
                    controlPattern: String.raw`%[-+0 #]*\d*(?:\.\d+)?[diuoxXfFeEgGcs%]|\\[^n]`
                }
            }
        };
        changed = true;
    }
    for (const [id, file] of Object.entries(project.files)) {
        if (/\.(?:G2|TXT)$/i.test(id) && !file.translationConstraintType && project.options.translationConstraints.types?.gameText) {
            file.translationConstraintType = "gameText";
            changed = true;
        }
        if (!/\.G2$/i.test(id)) continue;
        for (const occurrences of file.parameters || []) for (const info of occurrences || []) {
            if (info?.speakerSource !== "pm4-name-command" || info.speakerVariable !== 2 || info.rowInfoText !== LEGACY_DAUGHTER) continue;
            info.rowInfoText = "Daughter";
            changed = true;
        }
    }
    return changed;
}

const validationRules = {lineCount: "block", blankLines: "block", maxBytes: "block", syntaxTokens: "block", strayBackslash: "block", expansion: "off"};
module.exports = {gamePrompt, enginePrompt, validationRules, applyProjectDefaults};
