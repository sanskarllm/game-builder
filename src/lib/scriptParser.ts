/**
 * Turns a screenplay (INT./EXT. headings, CHARACTER cues) or plain prose into
 * scenes, characters and dialogue. Heuristic and offline by design.
 */
export interface ParsedLine {
  speaker: string;
  text: string;
}

export interface ParsedScene {
  heading: string;
  location: string;
  time: string;
  interior: boolean;
  action: string[];
  dialogue: ParsedLine[];
  characters: string[];
}

export interface ParsedCharacter {
  name: string;
  lines: number;
  mentions: number;
  firstSeen: number;
}

export interface ParsedScript {
  format: 'screenplay' | 'prose';
  title: string;
  scenes: ParsedScene[];
  characters: ParsedCharacter[];
}

const HEADING = /^\s*(?:\.(?!\.)|(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.|EXT\.|INT |EXT )\s*)/i;
const TRANSITION = /(?:\bTO:|^FADE (?:IN|OUT)[.:]?|^CUT TO|^DISSOLVE)\s*$/;
const CUE = /^[A-Z][A-Z0-9 .'\-]{1,30}(?:\s*\(.*\))?$/;

export const LOCATION_WORDS = [
  'forest', 'woods', 'jungle', 'garden', 'park', 'field', 'meadow', 'farm', 'castle', 'palace', 'throne room',
  'tower', 'hall', 'village', 'town', 'market', 'inn', 'tavern', 'city', 'street', 'alley', 'apartment', 'office',
  'cave', 'cavern', 'mine', 'ruins', 'dungeon', 'prison', 'crypt', 'graveyard', 'cemetery', 'temple', 'church',
  'desert', 'mountain', 'mountains', 'peak', 'glacier', 'river', 'lake', 'sea', 'ocean', 'beach', 'island',
  'harbor', 'harbour', 'port', 'ship', 'spaceship', 'starship', 'station', 'planet', 'moon', 'base', 'camp',
  'swamp', 'bridge', 'library', 'house', 'cottage', 'room', 'kitchen', 'school', 'lab', 'laboratory',
  'hospital', 'warehouse', 'factory', 'bar', 'battlefield', 'hills', 'valley', 'canyon', 'hull', 'corridor',
];

const LOCATION_RE = new RegExp(
  `\\b(?:the|a|an|this|that|his|her|their|its)\\s+((?:[a-z]+\\s+)?(?:${LOCATION_WORDS.join('|')}))\\b`,
  'i',
);

const STOP = new Set(
  (
    'The A An And But Or So Then When While As At In On Of To For From With By Into Onto Over Under After Before ' +
    'He She They It I We You His Her Hers Their Them Its Our My Your Me Us Him This That These Those There Here ' +
    'What Who Why How Where Which Yes No Not Now Just Still Even One Two Three Some All Every Each Inside Outside ' +
    'Chapter Part Act Scene Mr Mrs Ms Dr Sir Lady Lord Monday Tuesday Wednesday Thursday Friday Saturday Sunday ' +
    'January February March April May June July August September October November December God Oh Ah Hey Well ' +
    'Suddenly Finally Meanwhile Later Soon Once Today Tonight Tomorrow Yesterday Everyone Someone Nobody Something Nothing'
  ).split(' '),
);

const SPEECH_VERBS = 'said|says|asked|asks|replied|replies|shouted|shouts|whispered|whispers|cried|answered|called|muttered|yelled|snarled|growled|laughed|sighed|added|warned|begged|told';

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=["“A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectFormat(text: string): 'screenplay' | 'prose' {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const headings = lines.filter((l) => HEADING.test(l) && /^(\.|INT|EXT|I\/E)/i.test(l)).length;
  if (headings > 0) return 'screenplay';
  let cues = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (CUE.test(lines[i]) && lines[i + 1] && lines[i].length < 32) cues++;
  }
  return cues >= 3 ? 'screenplay' : 'prose';
}

function detectTime(text: string): string {
  const t = text.toLowerCase();
  if (/\b(night|midnight|moonlight|moonlit)\b/.test(t)) return 'night';
  if (/\b(dawn|sunrise|morning)\b/.test(t)) return 'dawn';
  if (/\b(dusk|sunset|evening|twilight)\b/.test(t)) return 'dusk';
  return 'day';
}

function extractTitle(lines: string[]): { title: string; rest: string[] } {
  const idx = lines.findIndex((l) => l.trim());
  if (idx === -1) return { title: 'Untitled Story', rest: lines };
  const first = lines[idx].trim();
  const fountain = first.match(/^title:\s*(.+)$/i);
  if (fountain) return { title: fountain[1].trim(), rest: lines.slice(idx + 1) };
  if (first.length <= 60 && !/[.!?,"“]$/.test(first) && !HEADING.test(first) && lines.length > idx + 1) {
    return { title: first.replace(/^#+\s*/, ''), rest: lines.slice(idx + 1) };
  }
  return { title: 'Untitled Story', rest: lines };
}

function newScene(heading: string, location: string, time: string, interior: boolean): ParsedScene {
  return { heading, location, time, interior, action: [], dialogue: [], characters: [] };
}

function parseScreenplay(lines: string[]): { scenes: ParsedScene[]; speakers: string[] } {
  const scenes: ParsedScene[] = [];
  const speakers: string[] = [];
  let cur: ParsedScene | null = null;
  const ensure = (): ParsedScene => {
    if (!cur) {
      cur = newScene('Opening', 'Opening', 'day', false);
      scenes.push(cur);
    }
    return cur;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (HEADING.test(t) && /^(\.|INT|EXT|I\/E)/i.test(t)) {
      const body = t.replace(HEADING, '').trim();
      const [place, ...timeParts] = body.split(/\s+[-–—]\s+/);
      const time = timeParts.join(' ') || 'day';
      cur = newScene(t, titleCase(place || 'Unknown'), detectTime(time), /^\.?\s*INT/i.test(t) && !/EXT/i.test(t));
      scenes.push(cur);
      continue;
    }
    if (TRANSITION.test(t)) continue;
    const next = lines[i + 1]?.trim();
    if (CUE.test(t) && next && t.length < 40 && /[A-Z]{2}/.test(t)) {
      const speaker = titleCase(t.replace(/\(.*\)/, '').trim());
      const said: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i].trim();
        if (!/^\(.*\)$/.test(l)) said.push(l);
        i++;
      }
      ensure().dialogue.push({ speaker, text: said.join(' ') });
      if (!speakers.includes(speaker)) speakers.push(speaker);
      continue;
    }
    ensure().action.push(t);
  }
  return { scenes, speakers };
}

/** Find proper-noun characters in prose, skipping places and common words. */
interface Candidate {
  mentions: number;
  mid: number;
}

/** True when the word at `index` begins a sentence (so capitalisation proves nothing). */
function atSentenceStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[ \t"“”'‘’]/.test(text[i])) i--;
  return i < 0 || /[.!?\n]/.test(text[i]);
}

function findProseCharacters(text: string): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  const re = /\b([A-Z][a-z]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[1];
    if (STOP.has(word)) continue;
    const e = out.get(word) ?? { mentions: 0, mid: 0 };
    e.mentions++;
    if (!atSentenceStart(text, m.index)) e.mid++;
    out.set(word, e);
  }
  const locAlt = LOCATION_WORDS.join('|');
  for (const word of [...out.keys()]) {
    const isPlace = new RegExp(`\\b(?:${locAlt})\\s+of\\s+${word}\\b|\\b${word}\\s+(?:${locAlt})\\b`, 'i').test(text);
    const isCommonWord = new RegExp(`\\b${word.toLowerCase()}\\b`).test(text);
    if (isPlace || isCommonWord) out.delete(word);
  }
  return out;
}

function parseProse(lines: string[]): { scenes: ParsedScene[]; speakers: string[]; candidates: Set<string> } {
  const text = lines.join('\n');
  let paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === 1) {
    const sentences = splitSentences(paragraphs[0]);
    paragraphs = [];
    for (let i = 0; i < sentences.length; i += 4) paragraphs.push(sentences.slice(i, i + 4).join(' '));
  }

  const found = findProseCharacters(text);
  const candidates = new Set([...found.keys()]);
  const strong = new Set([...found.entries()].filter(([, e]) => e.mentions >= 3 || (e.mentions >= 2 && e.mid >= 1)).map(([k]) => k));
  const speakers: string[] = [];
  const scenes: ParsedScene[] = [];
  let cur: ParsedScene | null = null;
  let paraCount = 0;

  const pickName = (phrase: string | undefined): string | undefined => {
    if (!phrase) return undefined;
    const ws = phrase.trim().split(/\s+/).reverse();
    return ws.find((w) => strong.has(w)) ?? ws.find((w) => candidates.has(w)) ?? ws[0];
  };
  const attribution = new RegExp(`(?:^|,|\\s)\\s*(?:${SPEECH_VERBS})\\s+(?:[A-Z][a-z]+\\s?){1,2}[.,]?|(?:[A-Z][a-z]+\\s){1,2}(?:${SPEECH_VERBS})[.,]?`, 'g');

  for (const para of paragraphs) {
    const isBreak = /^(?:\*{3,}|-{3,}|#{3,}|~{3,})$/.test(para);
    const chapter = para.length < 80 && /^(?:chapter|part|act|scene|book)\b/i.test(para);
    if (isBreak || chapter) {
      cur = null;
      paraCount = 0;
      if (chapter) {
        cur = newScene(para, '', 'day', false);
        scenes.push(cur);
      }
      continue;
    }

    const narration = para.replace(/["“][^"”]*["”]/g, ' ').replace(/\s+/g, ' ').trim();
    const locMatch = narration.match(LOCATION_RE);
    const location = locMatch ? titleCase(locMatch[1]) : '';

    const locationChanged = location && cur && cur.location && location.toLowerCase() !== cur.location.toLowerCase();
    if (!cur || locationChanged || paraCount >= 4) {
      cur = newScene(location || cur?.location || 'Opening', location || cur?.location || 'Opening', cur?.time ?? 'day', false);
      scenes.push(cur);
      paraCount = 0;
    } else if (!cur.location && location) {
      cur.location = location;
    }
    paraCount++;
    const time = detectTime(narration);
    if (time !== 'day') cur.time = time;

    const quoteRe = /["“]([^"”]+)["”]/g;
    let q: RegExpExecArray | null;
    const firstNamed = (narration.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).find((w) => strong.has(w));
    let lastSpeaker: string | undefined;
    while ((q = quoteRe.exec(para))) {
      const after = para.slice(q.index + q[0].length, q.index + q[0].length + 50);
      const before = para.slice(Math.max(0, q.index - 50), q.index);
      const a1 = after.match(new RegExp(`^\\s*,?\\s*(?:${SPEECH_VERBS})\\s+((?:[A-Z][a-z]+\\s?){1,2})`));
      const a2 = after.match(new RegExp(`^\\s*,?\\s*((?:[A-Z][a-z]+\\s?){1,2})\\s+(?:${SPEECH_VERBS})\\b`));
      const b1 = before.match(new RegExp(`((?:[A-Z][a-z]+\\s?){1,2})\\s+(?:${SPEECH_VERBS})\\s*[,:]?\\s*$`));
      const speaker = pickName(a1?.[1]) ?? pickName(a2?.[1]) ?? pickName(b1?.[1]) ?? lastSpeaker ?? firstNamed ?? 'Narrator';
      lastSpeaker = speaker;
      cur.dialogue.push({ speaker, text: q[1].trim() });
      if (speaker !== 'Narrator' && !speakers.includes(speaker)) speakers.push(speaker);
    }
    const actionText = narration.replace(attribution, ' ').replace(/\s+([.,!?])/g, '$1');
    cur.action.push(...splitSentences(actionText).filter((s) => s.split(/\s+/).length >= 3));
  }

  for (const s of scenes) if (!s.location) s.location = s.heading;
  return { scenes, speakers, candidates: strong };
}

export function parseScript(text: string): ParsedScript {
  const { title, rest } = extractTitle(text.split(/\r?\n/));
  const format = detectFormat(rest.join('\n'));
  const body = rest.join('\n');

  let scenes: ParsedScene[];
  let names: string[];
  if (format === 'screenplay') {
    const r = parseScreenplay(rest);
    scenes = r.scenes;
    names = r.speakers;
  } else {
    const r = parseProse(rest);
    scenes = r.scenes;
    names = [...new Set([...r.speakers, ...r.candidates])];
  }

  const characters: ParsedCharacter[] = names.map((name) => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, format === 'screenplay' ? 'gi' : 'g');
    const mentions = (body.match(re) ?? []).length;
    const firstSeen = body.search(re);
    const lines = scenes.reduce((n, s) => n + s.dialogue.filter((d) => d.speaker === name).length, 0);
    return { name, lines, mentions, firstSeen: firstSeen === -1 ? Infinity : firstSeen };
  });

  for (const scene of scenes) {
    const sceneText = [...scene.action, ...scene.dialogue.map((d) => d.text)].join(' ');
    const present = new Set(scene.dialogue.map((d) => d.speaker).filter((s) => s !== 'Narrator'));
    for (const c of characters) {
      const re = new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, format === 'screenplay' ? 'i' : '');
      if (re.test(scene.action.join(' '))) present.add(c.name);
    }
    scene.characters = [...present];
    if (format === 'prose' && scene.time === 'day') scene.time = detectTime(sceneText);
  }

  return { format, title, scenes: scenes.filter((s) => s.action.length || s.dialogue.length), characters };
}
