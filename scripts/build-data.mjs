// Turns data-raw/ snapshots into the small JSON files the game loads (src/data/). Run: npm run data:build
import assert from 'node:assert/strict'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

const raw = async (p) => JSON.parse(await readFile(`data-raw/${p}`, 'utf8'))
const out = async (name, data) => {
  await writeFile(`src/data/${name}`, JSON.stringify(data))
  console.log('wrote', name)
}
await mkdir('src/data', { recursive: true })

const [repoeMods, repoeBases, translations, itemClasses, tradeKo, datModsKo, datBasesKo, meta] = await Promise.all([
  raw('repoe/mods.json'),
  raw('repoe/base_items.json'),
  raw('repoe/stat_translations.json'),
  raw('repoe/item_classes.json'),
  raw('trade/stats.ko.json'),
  raw('dat/tables/Korean/Mods.json'),
  raw('dat/tables/Korean/BaseItemTypes.json'),
  raw('meta.json'),
])

// ---- Bases: non-unique equipment only (no jewels, flasks, grafts, fishing rods)
const CLASSES = [
  'Wand', 'Dagger', 'Rune Dagger', 'Claw', 'One Hand Axe', 'One Hand Sword', 'Thrusting One Hand Sword',
  'One Hand Mace', 'Sceptre', 'Bow', 'Staff', 'Warstaff', 'Two Hand Axe', 'Two Hand Sword', 'Two Hand Mace',
  'Shield', 'Quiver', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Ring', 'Amulet', 'Belt',
]
// Not obtainable as plain white bases: royale/legacy copies, always-corrupted talismans, unique-only bases,
// skill-summoned Energy Blades, Breach Ring, Kalandra's mirrored "Ring".
// ('not_for_sale' only means NPC vendors don't sell it — it covers top-tier, Heist and Atlas bases, so keep those.)
const SKIP_TAGS = ['trade_market_legacy_item', 'talisman', 'demigods']
const SKIP_IDS = /Royale|Demigods|\/Talismans\/|StormBlade|BreachRing|MirrorRing/

const bases = {}
for (const [id, b] of Object.entries(repoeBases)) {
  if (b.release_state !== 'released' || b.domain !== 'item' || !CLASSES.includes(b.item_class)) continue
  if (SKIP_IDS.test(id) || b.tags.some((t) => SKIP_TAGS.includes(t))) continue
  bases[id] = {
    cls: b.item_class,
    tags: b.tags,
    lvl: b.drop_level,
    req: b.requirements,
    props: b.properties,
    imp: b.implicits,
    w: b.inventory_width,
    h: b.inventory_height,
    art: b.visual_identity.dds_file.split('/').pop().replace('.dds', ''), // assets/items/<art>.png
  }
}

// ---- Influence tag per item class, e.g. classes['Ring'].shaper = 'ring_shaper'
const INFLUENCE_BY_TAG_SUFFIX = { shaper: 'shaper', elder: 'elder', crusader: 'crusader', eyrie: 'redeemer', basilisk: 'hunter', adjudicator: 'warlord' }
const classes = Object.fromEntries(CLASSES.map((cls) => [cls, Object.fromEntries(
  (itemClasses[cls]?.influence_tags ?? []).map((t) => [INFLUENCE_BY_TAG_SUFFIX[t.split('_').pop()], t]),
)]))

// ---- Mods: explicit prefixes/suffixes that can roll on those bases (incl. influence tags) + the bases' implicits
const tagUniverse = new Set(Object.values(bases).flatMap((b) => b.tags))
for (const cls of CLASSES) for (const t of itemClasses[cls]?.influence_tags ?? []) tagUniverse.add(t)

const implicitIds = new Set(Object.values(bases).flatMap((b) => b.imp))
const mods = {}
const toModDef = (m) => ({
    gen: m.generation_type,
    type: m.type,
    grp: m.groups,
    lvl: m.required_level,
    stats: m.stats.map((s) => [s.id, s.min, s.max]),
    // First matching tag wins, so order is kept; tags no in-scope base can have are dropped.
    spawn: m.spawn_weights.filter((s) => s.tag === 'default' || tagUniverse.has(s.tag)).map((s) => [s.tag, s.weight]),
    ...(m.generation_weights.length && { gw: m.generation_weights.map((s) => [s.tag, s.weight]) }),
    ...(m.implicit_tags.length && { tags: m.implicit_tags }),
    ...(m.adds_tags.length && { adds: m.adds_tags }),
    // Bench crafts ('crafted') and fossil-only mods ('delve') must never show up from random rolls.
    ...(m.domain !== 'item' && { dom: m.domain }),
    ...(m.is_essence_only && { essenceOnly: true }),
})
for (const [id, m] of Object.entries(repoeMods)) {
  // Royale-mode mods carry ordinary spawn tags but never roll in the real game.
  const explicit = m.domain === 'item' && (m.generation_type === 'prefix' || m.generation_type === 'suffix') &&
    !/Royale/i.test(id) && m.spawn_weights.some((s) => s.weight > 0 && tagUniverse.has(s.tag))
  // Vaal Orb corruption implicits
  const corrupted = m.domain === 'item' && m.generation_type === 'corrupted' && m.spawn_weights.some((s) => s.weight > 0 && tagUniverse.has(s.tag))
  if (explicit || corrupted || implicitIds.has(id)) mods[id] = toModDef(m)
}

// ---- Mods that only come from crafting: bench crafts, essences, fossils
const currencyRows = (await readFile('assets/currency/currency_icons.csv', 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)
  .map((line) => { const [cat, ko, en, file] = line.split(','); return { cat, ko, en, file } })
const currencyByEn = new Map(currencyRows.map((r) => [r.en, r]))
const inScope = (classes) => classes.filter((c) => CLASSES.includes(c))
const benchOptions = (await raw('repoe/crafting_bench_options.json')).filter((o) =>
  o.actions.add_explicit_mod && inScope(o.item_classes).length && repoeMods[o.actions.add_explicit_mod]?.domain === 'crafted')
const essences = Object.entries(await raw('repoe/essences.json')).filter(([id]) => currencyByEn.get(repoeBases[id]?.name)?.cat === '에센스')
const fossils = Object.entries(await raw('repoe/fossils.json')).filter(([, f]) => currencyByEn.get(f.name)?.cat === '화석')
for (const id of [
  ...benchOptions.map((o) => o.actions.add_explicit_mod),
  ...essences.flatMap(([, e]) => Object.entries(e.mods).filter(([c]) => CLASSES.includes(c)).map(([, id]) => id)),
  ...fossils.flatMap(([, f]) => f.added_mods),
  // Beastcrafted Aspect skills (level 20)
  ...['Cat', 'Bird', 'Spider', 'Crab'].map((a) => `Grants${a}AspectCrafted`),
]) if (!mods[id] && repoeMods[id]) mods[id] = toModDef(repoeMods[id])

// ---- Veiled mods: the plain "Veiled" / "of the Veil" placeholders (Veiled Chaos/Exalted Orbs) and every mod unveiling
// can turn them into (domain 'unveiled'). Both carry `dom`, so they never roll randomly.
for (const id of ['VeiledPrefix', 'VeiledSuffix']) mods[id] = toModDef(repoeMods[id])
for (const [id, m] of Object.entries(repoeMods)) {
  if (m.domain === 'unveiled' && (m.generation_type === 'prefix' || m.generation_type === 'suffix')
    && m.spawn_weights.some((s) => s.weight > 0 && tagUniverse.has(s.tag))) mods[id] = toModDef(m)
}

// ---- Elevated influence mods (Orb of Dominance upgrades a tier-1 influence mod into one). They never roll (weight 0);
// `elev` names the influence mod family (type) they upgrade. Matched by id ("…Uber3" -> "…UberMaven"), else by first
// stat, else by mod group, always on the same slot+influence tag; ties go to the family sharing more words with the id.
// The ~19 left unmatched upgrade legacy mods that can't roll any more (spawn weight 0), so nothing can reach them.
const INF_TAG = /_(shaper|elder|crusader|eyrie|basilisk|adjudicator)$/
const influencedMods = Object.entries(mods).filter(([, m]) => !m.dom && (m.gen === 'prefix' || m.gen === 'suffix')
  && m.spawn.some(([, w]) => w > 0) && m.spawn.filter(([, w]) => w > 0).every(([t]) => INF_TAG.test(t)))
for (const [eid, e] of Object.entries(repoeMods)) {
  // "Elevated Shaper's" prefixes, "of the Elevated Elder" suffixes
  if (e.domain !== 'item' || !/Maven/.test(eid) || !/Elevated/.test(e.name ?? '') || !['prefix', 'suffix'].includes(e.generation_type)) continue
  const tags = e.spawn_weights.map((s) => s.tag).filter((t) => t !== 'default' && tagUniverse.has(t))
  const same = (m) => m.gen === e.generation_type && m.spawn.some(([t, w]) => w > 0 && tags.includes(t))
  const stem = eid.replace(/_+$/, '').replace(/Maven(V2)?_*$/, '')
  let found = influencedMods.filter(([id, m]) => same(m) && new RegExp(`^${stem}\\d*_*$`).test(id))
  if (!found.length) found = influencedMods.filter(([, m]) => same(m) && m.stats[0][0] === e.stats[0].id)
  if (!found.length) found = influencedMods.filter(([, m]) => same(m) && m.grp.some((g) => e.groups.includes(g)))
  let fams = [...new Set(found.map(([, m]) => m.type))]
  if (fams.length > 1) {
    const words = (eid.match(/[A-Z][a-z]+/g) ?? []).filter((w) => w.length > 4)
    const score = (f) => words.filter((w) => f.includes(w)).length
    const top = Math.max(...fams.map(score))
    fams = fams.filter((f) => score(f) === top)
  }
  if (fams.length === 1) mods[eid] = { ...toModDef(e), elev: fams[0] }
}

// ---- Eldritch implicits for the four armour slots: Embers add Searing Exarch ones, Ichors Eater of Worlds ones.
// `et` = tier 1-6 (Lesser..Perfect), the id's trailing number; Embers/Ichors give 1-4, Orbs of Conflict reach 5-6.
// Weight-0 tiers stay in: Orbs of Conflict move along the whole ladder.
const ELDRITCH_SLOTS = new Set(['helmet', 'gloves', 'boots', 'body_armour'])
for (const [id, m] of Object.entries(repoeMods)) {
  if (m.domain !== 'item' || !/^(searing_exarch|eater_of_worlds)_implicit$/.test(m.generation_type)) continue
  if (!m.spawn_weights.some((s) => ELDRITCH_SLOTS.has(s.tag))) continue
  mods[id] = { ...toModDef(m), et: +id.match(/(\d+)_*$/)[1] }
}

// Korean lines from the game's stat_descriptions.txt (UTF-16, every language): "description" blocks list the stat ids,
// then variants per language. Placeholders "{0:+d}" become "{0}" (the English format adds the sign); "[Spell|주문]"
// link markup keeps its text.
const koDescriptions = new Map()
{
  const text = (await readFile('data-raw/dat/files/metadata@statdescriptions@stat_descriptions.txt')).toString('utf16le')
  for (const block of text.split(/\r?\ndescription[^\n]*\r?\n/).slice(1)) {
    const lines = block.split(/\r?\n/)
    const k = lines.findIndex((l) => l.trim() === 'lang "Korean"')
    if (k < 0) continue
    const ids = lines[0].trim().split(/\s+/).slice(1).join(' ')
    const n = +lines[k + 1].trim()
    koDescriptions.set(ids, lines.slice(k + 2, k + 2 + n).map((l) => (l.match(/"(.*)"/)?.[1] ?? '')
      .replace(/\{(\d+)(:[^}]*)?\}/g, '{$1}').replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')))
  }
}

// ---- Stat text: language-independent part (conditions/formats/handlers) + per-language strings
const usedStats = new Set(Object.values(mods).flatMap((m) => m.stats.map((s) => s[0])))
const koTrade = new Map(tradeKo.result.flatMap((g) => g.entries.map((e) => [e.id, e.text])))
const TRADE_PREF = ['explicit', 'implicit', 'crafted', 'fractured', 'enchant']

const stats = []
const statsEn = []
const statsKo = []
for (const t of translations) {
  if (!t.ids.some((id) => usedStats.has(id))) continue
  const variants = t.English
  stats.push({ ids: t.ids, v: variants.map((v) => ({ c: v.condition, f: v.format, h: v.index_handlers })) })
  statsEn.push(variants.map((v) => v.string))

  // Korean comes from the trade site: one text per trade stat, '#' as placeholders.
  // ponytail: one Korean string per entry, so e.g. a "reduced" variant renders as a negative "increased";
  // parse the Korean blocks of Metadata/StatDescriptions/stat_descriptions.txt if that ever matters.
  const trade = [...(t.trade_stats ?? [])].sort(
    (a, b) => TRADE_PREF.indexOf(a.id.split('.')[0]) - TRADE_PREF.indexOf(b.id.split('.')[0]),
  ).find((ts) => koTrade.has(ts.id))
  if (!trade) {
    // Not on the trade site: the game's own Korean lines, one per variant like English.
    const ko = koDescriptions.get(t.ids.join(' '))
    statsKo.push(ko?.length === variants.length ? ko : null)
    continue
  }
  const asTrade = (v) => v.string.replace(/\{(\d+)\}/g, (_, i) => v.format[i])
  const vi = Math.max(0, variants.findIndex((v) => asTrade(v).trim() === trade.text.trim()))
  const order = [...variants[vi].string.matchAll(/\{(\d+)\}/g)].map((m) => +m[1])
  let k = 0
  // The trade site tags local stats with "(특정)" (English "(Local)"); the item itself doesn't show it.
  const s = koTrade.get(trade.id).replace(/\s*\(특정\)/g, '').replace(/(\+?)#/g, (_, plus) => {
    const idx = order[k++] ?? 0
    return (plus && variants[vi].format[idx]?.startsWith('+') ? '' : plus) + `{${idx}}`
  })
  statsKo.push({ v: vi, s })
}

// ---- Names (affix names like "Archmage's" / "대마법사의", base names)
const byId = (rows) => new Map(rows.map((r) => [r.Id, r.Name]))
const modNameKo = byId(datModsKo)
const classNames = { en: byId(await raw('dat/tables/English/ItemClasses.json')), ko: byId(await raw('dat/tables/Korean/ItemClasses.json')) }
const baseNameKo = byId(datBasesKo)
const names = (lang) => ({
  mods: Object.fromEntries(Object.keys(mods).map((id) => [id, lang === 'ko' ? modNameKo.get(id) ?? '' : repoeMods[id].name])
    .filter(([, n]) => n)),
  bases: Object.fromEntries(Object.keys(bases).map((id) => [id, lang === 'ko' ? baseNameKo.get(id) ?? repoeBases[id].name : repoeBases[id].name])),
  classes: Object.fromEntries(CLASSES.map((c) => [c, classNames[lang].get(c) ?? c])),
  game: Object.fromEntries(Object.entries(GAME_STRINGS).map(([k, id]) => [k, clientStrings[lang].get(id)])),
  harvest: harvestText[lang],
  bestiary: bestiaryText[lang],
})
// Beastcraft wording by the game's recipe id ("Add a Prefix, Remove a Random Suffix" / "접두어 추가, 무작위 접미어 제거").
const bestiaryText = Object.fromEntries(await Promise.all(['en', 'ko'].map(async (l) => [l, Object.fromEntries(
  (await raw(`dat/tables/${l === 'en' ? 'English' : 'Korean'}/BestiaryRecipes.json`))
    .filter((r) => /^EinharMasterCraft(\d+|MemoryLine1)$/.test(r.Id))
    .map((r) => [r.Id, r.Description]))])))
// Harvest craft wording by the game's craft id; "<white>{Reforge}" colour markup keeps its text.
const harvestText = Object.fromEntries(await Promise.all(['en', 'ko'].map(async (l) => [l, Object.fromEntries(
  (await raw(`dat/tables/${l === 'en' ? 'English' : 'Korean'}/HarvestCraftOptions.json`))
    .filter((r) => /^(Reforge|Change|Augment|RerollInfluenceType|BossInfluence)/.test(r.Id))
    .map((r) => [r.Id, r.Text.replace(/<[^>]+>\{([^}]*)\}/g, '$1').replace(/\s*\n\s*/g, ' ')]))])))
// UI words the game itself uses, from ClientStrings (eldritch implicit labels and presence conditions).
const clientStrings = Object.fromEntries(await Promise.all(['en', 'ko'].map(async (l) => [l,
  new Map((await raw(`dat/tables/${l === 'en' ? 'English' : 'Korean'}/ClientStrings.json`)).map((r) => [r.Id, r.Text]))])))
const GAME_STRINGS = {
  presenceUnique: 'InfluenceStatConditionPresenceUniqueMonster', // "While a Unique Enemy is in your Presence, {0}"
  presencePinnacle: 'InfluenceStatConditionPresenceCelestialBoss',
  exarchImplicit: 'ModDescriptionLineCleansingFireImplicit', // "Searing Exarch Implicit Modifier ({0})"
  eaterImplicit: 'ModDescriptionLineGreatTangleImplicit',
  exarchItem: 'ItemPopupSearingExarchItem', eaterItem: 'ItemPopupEaterofWorldsItem',
  veiledPrefix: 'ItemDisplayVeiledPrefix', veiledSuffix: 'ItemDisplayVeiledSuffix', // "장막 접두어"
  unveil: 'UnveilingWindowUnveilButton', // "장막 해제"
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`eldritchTier${n}`, `EldritchCurrencyTier${n}`])), // Lesser..Perfect
}

// ---- Gold prices: poe.ninja chaos value x 100 for every currency we have an icon for
const GOLD_PER_CHAOS = 100
const chaos = new Map([['Chaos Orb', 1]])
for (const type of ['Currency', 'Essence', 'Fossil', 'Resonator', 'Oil']) {
  const d = await raw(`ninja/${type}.json`)
  const nameOf = new Map(d.items.map((i) => [i.id, i.name]))
  for (const l of d.lines) if (nameOf.has(l.id)) chaos.set(nameOf.get(l.id), l.primaryValue)
}
// Essence tiers poe.ninja doesn't list are priced off the nearest listed tier of the same essence (x3 per tier).
const ESSENCE_TIERS = ['Whispering', 'Muttering', 'Weeping', 'Wailing', 'Screaming', 'Shrieking', 'Deafening']
const essenceTier = (n) => ESSENCE_TIERS.findIndex((t) => n.startsWith(t + ' '))
for (const r of currencyRows.filter((r) => r.cat === '에센스' && !chaos.has(r.en) && essenceTier(r.en) >= 0)) {
  const family = r.en.slice(r.en.indexOf(' ') + 1)
  const known = ESSENCE_TIERS.map((t, i) => [i, chaos.get(`${t} ${family}`)]).filter(([, c]) => c !== undefined)
  if (!known.length) continue
  const [i, c] = known.reduce((a, b) => (Math.abs(b[0] - essenceTier(r.en)) < Math.abs(a[0] - essenceTier(r.en)) ? b : a))
  chaos.set(r.en, c * 3 ** (essenceTier(r.en) - i))
}
// Alchemical resonators aren't traded much; same price as the Chaotic one of the same size.
for (const r of currencyRows.filter((r) => r.en.endsWith('Alchemical Resonator'))) {
  const chaotic = chaos.get(r.en.replace('Alchemical', 'Chaotic'))
  if (!chaos.has(r.en) && chaotic !== undefined) chaos.set(r.en, chaotic)
}
const prices = {}
const unpriced = []
for (const { en } of currencyRows) {
  if (chaos.has(en)) prices[en] = Math.max(1, Math.round(chaos.get(en) * GOLD_PER_CHAOS))
  else unpriced.push(en)
}
// Currencies with no icon in assets/currency: priced and named from game data, shown as text.
const EXTRA_CURRENCIES = { 'Crystallised Rancour': 'Metadata/Items/Currency/HarvestSeedFaridun' } // 3.28+ lifeforce
for (const en of Object.keys(EXTRA_CURRENCIES)) {
  if (chaos.has(en)) prices[en] = Math.max(1, Math.round(chaos.get(en) * GOLD_PER_CHAOS))
  else unpriced.push(en)
}
// Beastcrafting beasts (the named ones each equipment recipe needs; filler "any rare beast" slots aren't priced)
const BEASTS = [
  'Wild Bristle Matron', 'Farric Wolf Alpha', 'Farric Lynx Alpha', 'Craicic Maw', 'Farric Goliath', 'Craicic Watcher',
  'Fenumal Queen', 'Fenumal Devourer', 'Fenumal Scrabbler', 'Saqawine Blood Viper', 'Craicic Croaker',
  'Saqawal, First of the Sky', 'Farrul, First of the Plains', 'Craiceann, First of the Deep', 'Fenumus, First of the Night',
]
const beastChaos = new Map((await raw('ninja/Beast.json')).lines.map((l) => [l.name, l.chaosValue]))
const monsterKo = byId(await raw('dat/tables/Korean/MonsterVarieties.json'))
const monsterEnToId = new Map((await raw('dat/tables/English/MonsterVarieties.json')).map((r) => [r.Name, r.Id]))
for (const b of BEASTS) {
  if (beastChaos.has(b)) prices[b] = Math.round(beastChaos.get(b) * GOLD_PER_CHAOS)
  else unpriced.push(b)
}

// ---- Crafting tables (bench, essences, fossils) + currency names/icons
const goldOf = (currencyId) => prices[repoeBases[currencyId]?.name]
const unpricedBench = new Set()
const crafting = {
  bench: benchOptions.map((o) => ({
    mod: o.actions.add_explicit_mod,
    classes: inScope(o.item_classes),
    cost: Object.entries(o.cost).reduce((sum, [cid, n]) => {
      if (goldOf(cid) === undefined) unpricedBench.add(repoeBases[cid]?.name ?? cid)
      return sum + n * (goldOf(cid) ?? GOLD_PER_CHAOS)
    }, 0),
  })),
  essences: Object.fromEntries(essences.map(([id, e]) => [repoeBases[id].name, {
    level: e.level,
    ilvlMax: e.item_level_restriction ?? null,
    mods: Object.fromEntries(Object.entries(e.mods).filter(([c]) => CLASSES.includes(c))),
  }])),
  fossils: Object.fromEntries(fossils.map(([, f]) => [f.name, {
    pos: f.positive_mod_weights.map((w) => [w.tag, w.weight]),
    neg: f.negative_mod_weights.map((w) => [w.tag, w.weight]),
    added: f.added_mods,
    forbidden: f.forbidden_tags,
    allowed: f.allowed_tags,
    lucky: f.rolls_lucky,
  }])),
  // English name -> { ko, icon file under assets/currency, category } for every currency we have an icon for
  currencies: Object.fromEntries([
    ...currencyRows.map((r) => [r.en, { ko: r.ko, icon: r.file, cat: r.cat }]),
    ...BEASTS.map((b) => [b, { ko: monsterKo.get(monsterEnToId.get(b)) ?? b, icon: '', cat: '야수' }]),
    ...Object.entries(EXTRA_CURRENCIES).map(([en, id]) => [en, { ko: baseNameKo.get(id) ?? en, icon: '', cat: '생기' }]),
  ]),
}
if (unpricedBench.size) console.log('bench costs with unpriced currency (1 chaos each):', [...unpricedBench].join(', '))

// ---- Base prices (gold) by item level, from poe.ninja base type listings: { [baseId]: { [ilvl]: gold } }.
// Influenced bases aren't sold in the shop (players add influence themselves), so only plain listings count.
const SHOP_ILVLS = [82, 83, 84, 85, 86]
// poe.ninja's sample count; troll prices sit on 1-2 samples (e.g. 140k chaos Great White Claw), real pricey bases don't
// (Simplex Amulet 7-12, Cogwork Ring 100+).
const MIN_SAMPLES = 5
const FALLBACK_CHAOS = { heist: 10, other: 1 } // ponytail: flat guesses for unlisted bases, tune in P7
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const listed = new Map() // base name -> Map(ilvl -> chaos)
for (const l of (await raw('ninja/BaseType.json')).lines) {
  if (l.variant && l.variant !== 'None') continue
  if ((l.count ?? 0) < MIN_SAMPLES || !SHOP_ILVLS.includes(l.levelRequired)) continue
  if (!listed.has(l.name)) listed.set(l.name, new Map())
  listed.get(l.name).set(l.levelRequired, l.chaosValue)
}
const basePrices = {}
for (const [id, b] of Object.entries(bases)) {
  const byIlvl = listed.get(repoeBases[id].name)
  const fallback = b.tags.includes('experimental_base') ? FALLBACK_CHAOS.heist : FALLBACK_CHAOS.other
  const med = byIlvl ? median([...byIlvl.values()]) : fallback // ilvls with no confident price take the base's median
  basePrices[id] = Object.fromEntries(SHOP_ILVLS.map((ilvl) =>
    [ilvl, Math.max(1, Math.round((byIlvl?.get(ilvl) ?? med) * GOLD_PER_CHAOS))]))
}

// ---- Item art from PoE's image CDN -> assets/items/ (only missing files are downloaded)
const ART_DIR = 'assets/items'
await mkdir(ART_DIR, { recursive: true })
const haveArt = new Set(await readdir(ART_DIR))
const needArt = [...new Set(Object.keys(bases).map((id) => repoeBases[id].visual_identity.dds_file))]
  .filter((dds) => !haveArt.has(`${dds.split('/').pop().replace('.dds', '')}.png`))
for (let i = 0; i < needArt.length; i += 4) { // a few at a time, to be gentle with the CDN
  await Promise.all(needArt.slice(i, i + 4).map(async (dds) => {
    const res = await fetch(`https://web.poecdn.com/image/${dds.replace('.dds', '.png')}`, {
      headers: { 'User-Agent': 'ExileCraftSomething data build (https://github.com/RXDiceKey/ExileCraftSomething)' },
    })
    if (!res.ok) return console.warn('no art', res.status, dds)
    await writeFile(`${ART_DIR}/${dds.split('/').pop().replace('.dds', '.png')}`, Buffer.from(await res.arrayBuffer()))
  }))
}
if (needArt.length) console.log(`downloaded ${needArt.length} item images`)

// ---- Faustus voice lines -> assets/voice/faustus/ (served as-is)
const VOICE_DIR = 'assets/voice/faustus'
await mkdir(VOICE_DIR, { recursive: true })
const voiceFiles = (await readdir('data-raw/dat/files')).filter((f) => f.startsWith('audio@dialogue@npc@faustus@'))
for (const f of voiceFiles) await copyFile(`data-raw/dat/files/${f}`, `${VOICE_DIR}/${f.split('@').pop()}`)
const voiceNames = voiceFiles.map((f) => f.split('@').pop())
// No first-meeting speech (user): greetings when his window opens, farewells after a sale.
const faustus = {
  greeting: voiceNames.filter((n) => n.includes('greeting')),
  farewell: voiceNames.filter((n) => n.includes('farewell')),
}

await out('meta.json', meta)
await out('faustus.json', faustus)
await out('basePrices.json', basePrices)
await out('crafting.json', crafting)
await out('bases.json', bases)
await out('classes.json', classes)
await out('mods.json', mods)
await out('stats.json', stats)
await out('text.en.json', { ...names('en'), stats: statsEn })
await out('text.ko.json', { ...names('ko'), stats: statsKo })
await out('prices.json', prices)

// ---- Report + self-check
// Entries with no English text (e.g. dummy_stat_display_nothing) show nothing in-game either. Korean comes from the trade
// site, else the game's stat_descriptions.txt; anything still missing would fall back to English.
const hasKo = (i) => statsKo[i] || statsEn[i].every((s) => !s)
const missingKo = Object.keys(mods).filter((id) =>
  // Stats with no translation entry at all show no line in-game (presence flags, veiled placeholders, focus grants).
  !mods[id].stats.every(([sid]) => !stats.some((s) => s.ids.includes(sid)) || stats.some((s, i) => s.ids.includes(sid) && hasKo(i))))
const missingKoExplicit = missingKo.filter((id) => mods[id].spawn.some(([, w]) => w > 0) && ['prefix', 'suffix'].includes(mods[id].gen))
console.log(`bases ${Object.keys(bases).length}, mods ${Object.keys(mods).length}, stat entries ${stats.length}`)
console.log(`mods missing Korean text (English fallback): ${missingKo.length}`)
console.log(`priced currencies ${Object.keys(prices).length}, unpriced ${unpriced.length}: ${unpriced.join(', ')}`)

for (const cls of CLASSES) assert.ok(Object.values(bases).some((b) => b.cls === cls), `no bases for ${cls}`)
for (const cls of CLASSES) assert.equal(Object.keys(classes[cls]).length, 6, `influence tags for ${cls}`)
assert.equal(classes['Body Armour'].hunter, 'body_armour_basilisk')
assert.equal(names('ko').classes.Boots, '장화')
assert.equal(names('ko').game.presenceUnique, '고유 적이 접근해 있는 동안, {0}')
assert.equal(names('ko').game.eldritchTier3, '우수한')
assert.equal(names('ko').mods.SpellDamageAndManaOnWeapon6, '대마법사의')
assert.equal(names('ko').bases['Metadata/Items/Rings/Ring12'], '쌍보석 반지')
const life = stats.findIndex((s) => s.ids.length === 1 && s.ids[0] === 'base_maximum_life')
assert.equal(statsEn[life][0], '{0} to maximum Life')
assert.equal(statsKo[life].s, '생명력 최대치 {0}') // trade text "생명력 최대치 +#", '+' comes from the format
assert.equal(missingKoExplicit.length, 0, 'every prefix/suffix needs Korean text')
assert.equal(prices['Chaos Orb'], 100)
assert.ok(prices['Divine Orb'] > prices['Chaos Orb'] * 50)
const simplex = 'Metadata/Items/Amulets/AmuletE2' // "평목" — one of the priciest bases
assert.ok(bases[simplex] && bases['Metadata/Items/Armours/Helmets/HelmetInt14'], 'Heist / top-tier bases kept')
assert.ok(basePrices[simplex][85] > 1000 * prices['Chaos Orb'], 'Simplex Amulet should cost 1000+ chaos')
const missingArt = Object.values(bases).filter((b) => !haveArt.has(`${b.art}.png`) && !needArt.some((d) => d.includes(`/${b.art}.dds`)))
assert.equal(missingArt.length, 0, 'every base has art')
const elevated = Object.values(mods).filter((m) => m.elev)
assert.ok(elevated.length >= 95, `elevated mods ${elevated.length}`)
assert.equal(mods.IncreasedBurningDamageSupportedUberMaven.elev, 'BurningDamageSupported')
assert.match(mods.ImmuneToChilledGroundUberMaven.elev, /Chilled/)
assert.ok(elevated.every((m) => m.spawn.every(([, w]) => w === 0)), 'elevated mods never roll')
const eldritch = Object.entries(mods).filter(([, m]) => m.et)
assert.ok(eldritch.length > 3000, `eldritch implicits ${eldritch.length}`)
assert.ok(eldritch.every(([, m]) => m.et >= 1 && m.et <= 6), 'eldritch tiers 1-6')
assert.equal(mods.IncreasedAttackSpeedEldritchImplicit3.et, 3)
assert.ok(!missingKo.includes('IncreasedAttackSpeedEldritchImplicit3'), 'eldritch implicit Korean text')
console.log('self-check ok')
