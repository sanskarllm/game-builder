import { parseScript, splitSentences, type ParsedScript } from './scriptParser';
import { slugify, uid } from './random';

export type Environment =
  | 'forest' | 'castle' | 'village' | 'city' | 'cave' | 'dungeon' | 'desert' | 'snow' | 'sea' | 'space' | 'interior' | 'field';

export type ObjectiveType = 'defeat' | 'collect' | 'talk' | 'explore';
export type Role = 'player' | 'ally' | 'enemy' | 'neutral';

export interface BlueprintCharacter {
  id: string;
  name: string;
  role: Role;
  color: string;
  lines: number;
  mentions: number;
}

export interface EnemySpawn {
  name: string;
  count: number;
  characterId?: string;
}

export interface BlueprintLevel {
  id: string;
  index: number;
  name: string;
  environment: Environment;
  time: string;
  narration: string[];
  npcs: string[];
  enemies: EnemySpawn[];
  items: string[];
  objective: { type: ObjectiveType; description: string };
  dialogue: { speakerId: string | null; speaker: string; text: string }[];
  mechanics: string[];
}

export interface StoryBlueprint {
  id: string;
  title: string;
  genre: string;
  format: ParsedScript['format'];
  logline: string;
  characters: BlueprintCharacter[];
  levels: BlueprintLevel[];
  items: string[];
  mechanics: string[];
  createdAt: number;
}

const ENV_KEYWORDS: [Environment, RegExp][] = [
  ['space', /\b(space|orbital|orbit|planet|spaceship|starship|moon|galaxy|asteroid|hull|airlock)\b/],
  ['dungeon', /\b(dungeon|prison|crypt|graveyard|cemetery|tomb|catacomb)\b/],
  ['cave', /\b(cave|cavern|mine|ruins|underground|tunnel)\b/],
  ['castle', /\b(castle|palace|throne|tower|fortress|keep|hall)\b/],
  ['forest', /\b(forest|woods|jungle|garden|park|grove|swamp)\b/],
  ['desert', /\b(desert|dune|dunes|sand|canyon|wasteland)\b/],
  ['snow', /\b(snow|ice|icy|glacier|mountain|mountains|peak|frozen|tundra)\b/],
  ['sea', /\b(sea|ocean|beach|island|harbou?r|port|lake|river|boat|ship|shore)\b/],
  ['village', /\b(village|farm|town|market|inn|tavern|hamlet)\b/],
  ['city', /\b(city|street|alley|downtown|rooftop|station|subway|highway)\b/],
  ['interior', /\b(room|house|kitchen|library|lab|laboratory|school|hospital|office|apartment|bar|warehouse|factory|corridor|cottage)\b/],
  ['field', /\b(field|meadow|hills|valley|plains|battlefield|camp)\b/],
];

const GENRES: [string, RegExp][] = [
  ['Sci-Fi', /\b(space|planet|robot|laser|station|ship|alien|android|galaxy|orbital|drone|signal|ai)\b/g],
  ['Fantasy', /\b(dragon|sword|magic|wizard|king|queen|castle|elf|goblin|spell|crystal|kingdom|knight|lantern)\b/g],
  ['Horror', /\b(blood|scream|ghost|haunted|corpse|zombie|terror|demon|shadow|dead)\b/g],
  ['Mystery', /\b(detective|murder|clue|suspect|case|evidence|crime|investigate)\b/g],
  ['Action', /\b(gun|explosion|chase|mission|agent|soldier|bomb|fight|war)\b/g],
  ['Romance', /\b(love|kiss|heart|wedding|date|romance)\b/g],
];

const COMBAT = /\b(fight|fought|fights|attack|attacked|attacks|battle|battled|kill|killed|defeat|defeated|ambush|ambushed|duel|war|strike|struck|slay|slew|shoot|shot|clash)\b/i;
const FIND = /\b(find|found|search|searched|look(?:ed)? for|retrieve|retrieved|collect|collected|grab|grabbed|take|took|pick(?:ed)? up|discover|discovered|recover|recovered|steal|loot)\b/i;
const STEALTH = /\b(sneak|sneaked|snuck|hide|hid|hidden|shadows|quietly|unseen|guards?)\b/i;
const PUZZLE = /\b(puzzle|riddle|lock|locked|code|lever|door|seal|mechanism|solve)\b/i;
const CHASE = /\b(chase|chased|run|ran|flee|fled|escape|escaped|pursue)\b/i;

const ITEM_NOUNS = [
  'key', 'keycard', 'map', 'sword', 'letter', 'book', 'gem', 'crystal', 'amulet', 'ring', 'potion', 'scroll', 'crown',
  'treasure', 'coin', 'artifact', 'orb', 'relic', 'note', 'phone', 'file', 'data', 'fuel', 'medicine', 'lantern',
  'torch', 'shield', 'staff', 'wand', 'egg', 'flower', 'herb', 'stone', 'diary', 'chip', 'battery', 'badge',
];

/** plural or singular enemy noun → display name */
const ENEMY_NOUNS: Record<string, string> = {
  wolf: 'Wolf', wolves: 'Wolf', goblin: 'Goblin', goblins: 'Goblin', orc: 'Orc', orcs: 'Orc', troll: 'Troll', trolls: 'Troll',
  dragon: 'Dragon', dragons: 'Dragon', demon: 'Demon', demons: 'Demon', zombie: 'Zombie', zombies: 'Zombie',
  skeleton: 'Skeleton', skeletons: 'Skeleton', ghost: 'Ghost', ghosts: 'Ghost', monster: 'Monster', monsters: 'Monster',
  beast: 'Beast', beasts: 'Beast', bandit: 'Bandit', bandits: 'Bandit', pirate: 'Pirate', pirates: 'Pirate',
  guard: 'Guard', guards: 'Guard', soldier: 'Soldier', soldiers: 'Soldier', drone: 'Drone', drones: 'Drone',
  robot: 'Robot', robots: 'Robot', spider: 'Spider', spiders: 'Spider', rat: 'Rat', rats: 'Rat', bat: 'Bat', bats: 'Bat',
  thug: 'Thug', thugs: 'Thug', alien: 'Alien', aliens: 'Alien', cultist: 'Cultist', cultists: 'Cultist', witch: 'Witch',
};

const GENERIC_ENEMY: Record<Environment, string> = {
  forest: 'Wolf', castle: 'Guard', village: 'Bandit', city: 'Thug', cave: 'Bat', dungeon: 'Skeleton', desert: 'Scorpion',
  snow: 'Ice Wraith', sea: 'Pirate', space: 'Drone', interior: 'Intruder', field: 'Bandit',
};

const PALETTE = ['#4f8cff', '#f2994a', '#27ae60', '#bb6bd9', '#eb5757', '#2dd4bf', '#f2c94c', '#9b51e0', '#56ccf2', '#ff7eb6'];

function detectEnvironment(location: string, text: string, interior: boolean): Environment {
  const loc = location.toLowerCase();
  for (const [env, re] of ENV_KEYWORDS) if (re.test(loc)) return env;
  if (interior) return 'interior';
  const t = text.toLowerCase();
  for (const [env, re] of ENV_KEYWORDS) if (re.test(t)) return env;
  return 'field';
}

function detectGenre(text: string): string {
  const t = text.toLowerCase();
  let best = 'Adventure';
  let bestScore = 1;
  for (const [genre, re] of GENRES) {
    const score = (t.match(re) ?? []).length;
    if (score > bestScore) {
      best = genre;
      bestScore = score;
    }
  }
  return best;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isHostile(name: string, text: string): boolean {
  if (ENEMY_NOUNS[name.toLowerCase()]) return true;
  const n = escape(name);
  return new RegExp(
    `\\b(?:attack(?:ed|s)?|fought|fight(?:s)?|battl(?:e|ed)|kill(?:ed|s)?|defeat(?:ed|s)?|slay|slew|against|escape(?:d)? from|flee(?:s)? from|fled from)\\s+(?:the\\s+)?${n}\\b` +
      `|\\b(?:evil|wicked|cruel|dark lord)\\s+${n}\\b|\\b${n},?\\s+the\\s+(?:villain|tyrant|traitor|monster)\\b|\\b${n}\\s+(?:betrayed|threatened|ambushed)\\b`,
    'i',
  ).test(text);
}

function listItems(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const item of ITEM_NOUNS) if (new RegExp(`\\b${item}s?\\b`).test(t) && !out.includes(item)) out.push(item);
  return out;
}

function enemyNouns(text: string): EnemySpawn[] {
  const out: EnemySpawn[] = [];
  for (const m of text.toLowerCase().matchAll(/\b([a-z]+)\b/g)) {
    const name = ENEMY_NOUNS[m[1]];
    if (!name || out.some((e) => e.name === name)) continue;
    out.push({ name, count: m[1].endsWith('s') && m[1] !== 'witch' ? 3 : 1 });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildBlueprint(parsed: ParsedScript): StoryBlueprint {
  const allText = parsed.scenes.map((s) => [...s.action, ...s.dialogue.map((d) => d.text)].join(' ')).join(' ');
  const narrationText = parsed.scenes.map((s) => s.action.join(' ')).join(' ');

  const characters: BlueprintCharacter[] = parsed.characters.map((c, i) => ({
    id: slugify(c.name),
    name: c.name,
    role: isHostile(c.name, narrationText) ? 'enemy' : 'neutral',
    color: PALETTE[i % PALETTE.length],
    lines: c.lines,
    mentions: c.mentions,
  }));

  // The protagonist is the one the narration follows most (dialogue tags are stripped from action).
  const narrationMentions = (name: string) =>
    (narrationText.match(new RegExp(`\\b${escape(name)}\\b`, parsed.format === 'screenplay' ? 'gi' : 'g')) ?? []).length;
  const candidates = characters
    .map((c, i) => ({ c, i, score: narrationMentions(c.name) + c.lines * (parsed.format === 'screenplay' ? 2 : 0.5) }))
    .filter(({ c }) => c.role !== 'enemy')
    .sort((a, b) => b.score - a.score || parsed.characters[a.i].firstSeen - parsed.characters[b.i].firstSeen);
  const player = candidates[0]?.c;
  if (player) player.role = 'player';
  for (const c of characters) if (c.role === 'neutral' && c.lines > 0) c.role = 'ally';

  const byName = new Map(characters.map((c) => [c.name, c]));
  const usedNames = new Map<string, number>();
  const allItems: string[] = [];
  const allMechanics = new Set<string>(['exploration']);

  const levels: BlueprintLevel[] = parsed.scenes.map((scene, index) => {
    const action = scene.action.join(' ');
    const full = [action, ...scene.dialogue.map((d) => d.text)].join(' ');
    const environment = detectEnvironment(scene.location, action, scene.interior);
    const present = scene.characters.map((n) => byName.get(n)).filter((c): c is BlueprintCharacter => !!c);
    const npcs = present.filter((c) => c.role !== 'player' && c.role !== 'enemy');
    const enemyChars = present.filter((c) => c.role === 'enemy');

    const mechanics = new Set<string>(['exploration']);
    let enemies: EnemySpawn[] = enemyChars.map((c) => ({ name: c.name, count: 1, characterId: c.id }));
    const combat = COMBAT.test(action) || enemyChars.length > 0;
    if (combat && !enemies.length) {
      enemies = enemyNouns(action);
      if (!enemies.length) enemies = [{ name: GENERIC_ENEMY[environment], count: 3 }];
    }
    if (enemies.length) mechanics.add('combat');

    const items = FIND.test(full) ? listItems(full) : [];
    const dialogueWithNpcs = scene.dialogue.some((d) => npcs.some((n) => n.name === d.speaker));
    if (scene.dialogue.length) mechanics.add('dialogue');
    if (STEALTH.test(action)) mechanics.add('stealth');
    if (PUZZLE.test(full)) mechanics.add('puzzle');
    if (CHASE.test(action)) mechanics.add('chase');
    if (items.length) mechanics.add('collection');

    const place = scene.location.replace(/^(The|A|An)\s+/i, '');
    let objective: BlueprintLevel['objective'];
    if (enemies.length) {
      const names = enemies.map((e) => (e.count > 1 ? `${e.count} ${e.name}s` : e.name));
      objective = { type: 'defeat', description: `Defeat ${names.join(' and ')}` };
    } else if (items.length) {
      objective = { type: 'collect', description: `Find the ${items.join(', ')}` };
    } else if (dialogueWithNpcs) {
      const talkTo = npcs.filter((n) => scene.dialogue.some((d) => d.speaker === n.name)).map((n) => n.name);
      objective = { type: 'talk', description: `Talk to ${talkTo.join(' and ')}` };
    } else {
      objective = { type: 'explore', description: `Explore the ${place} and reach the exit` };
    }

    const seen = usedNames.get(place) ?? 0;
    usedNames.set(place, seen + 1);
    const name = seen === 0 ? place : `Return to ${place}`;

    items.forEach((it) => !allItems.includes(it) && allItems.push(it));
    mechanics.forEach((m) => allMechanics.add(m));

    return {
      id: `${index + 1}-${slugify(scene.location)}`,
      index,
      name,
      environment,
      time: scene.time,
      narration: scene.action.slice(0, 3).map((s) => (s.length > 180 ? `${s.slice(0, 177)}…` : s)),
      npcs: npcs.map((c) => c.id),
      enemies,
      items,
      objective,
      dialogue: scene.dialogue.map((d) => ({ speakerId: byName.get(d.speaker)?.id ?? null, speaker: d.speaker, text: d.text })),
      mechanics: [...mechanics],
    };
  });

  const firstAction = parsed.scenes.find((s) => s.action.length)?.action.join(' ') ?? allText;
  const logline = splitSentences(firstAction).slice(0, 2).join(' ');

  return {
    id: uid('story'),
    title: parsed.title,
    genre: detectGenre(allText),
    format: parsed.format,
    logline: logline.length > 240 ? `${logline.slice(0, 237)}…` : logline,
    characters,
    levels,
    items: allItems,
    mechanics: [...allMechanics].map(cap),
    createdAt: Date.now(),
  };
}

export function storyToGame(text: string): StoryBlueprint {
  return buildBlueprint(parseScript(text));
}

export const SAMPLE_STORY = `The Lantern of Emberfall

Mara grew up in the village of Emberfall, where the lanterns never went out. One night the great lantern died, and darkness crept over the hills.

"We need the Ember Crystal," said Elder Tomas. "It was stolen by the goblins and hidden in the old cave."

Mara took her grandfather's sword and walked into the dark forest. Wolves howled between the trees, and she had to fight them off before she could reach the cave.

Inside the cave, she found a goblin chieftain named Grik guarding the crystal. "Turn back, little light," Grik snarled. Mara attacked Grik and defeated him after a long battle.

She carried the crystal back to the village. Tomas placed it inside the great lantern, and Emberfall was bright again. "You saved us all," Tomas said.`;

export const SAMPLE_SCREENPLAY = `Title: Signal Lost

INT. ORBITAL STATION - NIGHT

Alarms blare. Red lights sweep the empty corridor. NOVA, a young engineer, floats toward the control room.

NOVA
Station, this is Nova. Does anyone copy?

AI-7 (V.O.)
Hull breach in sector four. You must find the keycard to seal the doors.

EXT. STATION HULL - NIGHT

Nova crawls across the hull. Rogue drones attack from the dark.

NOVA
Not today.

INT. CONTROL ROOM - NIGHT

Nova reaches the console. Commander REYES waits by the window.

REYES
You made it. Send the signal home.

NOVA
Sending it now. Let's go home.`;
