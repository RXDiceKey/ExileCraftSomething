// Downloads raw data snapshots into data-raw/ (gitignored). Run: npm run data:fetch
// Then process them with: npm run data:build
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const RAW = resolve('data-raw')
const UA = 'CraftingIsFun data snapshot (https://github.com/RXDiceKey/CraftingIsFun)'

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return as === 'json' ? res.json() : res.text()
}

async function save(path, data) {
  const full = resolve(RAW, path)
  await mkdir(resolve(full, '..'), { recursive: true })
  await writeFile(full, typeof data === 'string' ? data : JSON.stringify(data))
  console.log('saved', path)
}

// 1. RePoE: mods, bases, stat text (English + trade stat ids)
for (const f of ['mods', 'base_items', 'stat_translations', 'item_classes', 'crafting_bench_options', 'essences', 'fossils']) {
  await save(`repoe/${f}.json`, await get(`https://repoe-fork.github.io/${f}.min.json`))
}

// 2. Korean stat text from the official Korean trade site
await save('trade/stats.ko.json', await get('https://poe.kakaogames.com/api/trade/data/stats'))

// 3. Affix names and base names (English + Korean) straight from the game's patch server
const patch = (await get('https://raw.githubusercontent.com/poe-tool-dev/latest-patch-version/main/latest.txt', 'text')).trim()
// Faustus voice: greetings (opening his window), farewells (sale done), his "fence" line (first visit, has subtitles)
const letters = (n) => [...'abcdefghijklmnopqrstuvwxyz'].slice(0, n)
const FAUSTUS = 'audio/dialogue/npc/faustus/'
await save('dat/config.json', {
  patch,
  translations: ['English', 'Korean'],
  tables: [
    { name: 'Mods', columns: ['Id', 'Name'] },
    { name: 'BaseItemTypes', columns: ['Id', 'Name'] },
    { name: 'NPCTextAudio', columns: ['Id', 'Text', 'Mono_AudioFile'] },
    { name: 'ItemClasses', columns: ['Id', 'Name'] },
    { name: 'Ascendancy', columns: ['Id', 'Name'] },
    { name: 'ClientStrings', columns: ['Id', 'Text'] }, // UI wording, to use the game's own terms
    { name: 'MonsterVarieties', columns: ['Id', 'Name'] }, // beast names for beastcrafting
    { name: 'HarvestCraftOptions', columns: ['Id', 'Text'] }, // harvest craft wording
    { name: 'BestiaryRecipes', columns: ['Id', 'Description', 'Notes'] }, // beastcraft wording
  ],
  files: [
    ...letters(13).map((l) => `${FAUSTUS}faustus_greeting_${l}.ogg`),
    ...letters(14).map((l) => `${FAUSTUS}faustus_farewell_${l}.ogg`),
    `${FAUSTUS}faustus_03.ogg`,
    // Every language's stat text: Korean for the few stats the trade site doesn't list
    'metadata/statdescriptions/stat_descriptions.txt',
  ],
})
execFileSync(process.execPath, [resolve('node_modules/pathofexile-dat/dist/cli/run.js')], {
  cwd: resolve(RAW, 'dat'),
  stdio: 'inherit',
})

// 4. Currency prices (chaos) from poe.ninja's public economy API, current challenge league
const leagues = await get('https://poe.ninja/poe1/api/economy/leagues')
const league = leagues.find((l) => !/standard|hardcore/i.test(l.name)).name
for (const type of ['Currency', 'Essence', 'Fossil', 'Resonator', 'Oil']) {
  const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`
  await save(`ninja/${type}.json`, await get(url))
}
// Base types by item level (82-86) and influence, for shop prices
await save('ninja/BaseType.json', await get(
  `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=BaseType`,
))
// Bestiary beasts, for beastcrafting costs
await save('ninja/Beast.json', await get(
  `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=Beast`,
))

await save('meta.json', { fetchedAt: new Date().toISOString(), patch, league })
