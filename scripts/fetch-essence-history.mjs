// poe.ninja's daily history for every essence (the last HISTORY_DAYS days), so essence prices come from two weeks of
// trades instead of one day's: a thin day can be off by 2-3x (see build-data.mjs). Run by fetch-data.mjs, or alone after
// it to refresh only this: node scripts/fetch-essence-history.mjs [league]
import { readFile, writeFile } from 'node:fs/promises'

const UA = 'ExileCraftSomething data snapshot (https://github.com/RXDiceKey/ExileCraftSomething)'
const HISTORY_DAYS = 14
const league = process.argv[2] ?? JSON.parse(await readFile('data-raw/meta.json', 'utf8')).league
const { items } = JSON.parse(await readFile('data-raw/ninja/Essence.json', 'utf8'))

const out = {} // essence name -> [chaos rate, volume] per day, newest first
for (const it of items) {
  const url = `https://poe.ninja/poe1/api/economy/exchange/current/details?league=${encodeURIComponent(league)}&type=Essence&id=${it.detailsId}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  const pair = res.ok ? (await res.json()).pairs?.find((p) => p.id === 'chaos') : undefined
  if (!pair) console.warn('no history:', it.name, res.status)
  else out[it.name] = pair.history.slice(0, HISTORY_DAYS).map((h) => [h.rate, h.volumePrimaryValue])
  await new Promise((r) => setTimeout(r, 250)) // be gentle with poe.ninja
}
await writeFile('data-raw/ninja/EssenceHistory.json', JSON.stringify(out))
console.log('saved ninja/EssenceHistory.json:', Object.keys(out).length, 'of', items.length, 'essences')
