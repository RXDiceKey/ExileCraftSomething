// Local persistence. Storage can be blocked or wiped (private mode, cleared site data), so every access is
// guarded and the game still runs without it; file export/import is the reliable backup.
import type { Lang } from './game/describe.ts'
import type { GameState } from './game/game.ts'

const KEY = { save: 'craftingisfun.save', best: 'craftingisfun.best', settings: 'craftingisfun.settings' }

export interface Settings { lang?: Lang; volume: number; muted: boolean; search: string; seenIntro?: boolean }
const DEFAULT_SETTINGS: Settings = { volume: 0.7, muted: false, search: '' }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: keep playing in memory
  }
}

export const isGameState = (x: unknown): x is GameState =>
  typeof x === 'object' && x !== null && (x as GameState).v === 1 && Array.isArray((x as GameState).stash)

export const loadGame = () => {
  const s = read<unknown>(KEY.save)
  return isGameState(s) ? s : null
}
export const saveGame = (s: GameState | null) => write(KEY.save, s)
export const loadBest = () => read<number>(KEY.best) ?? 0
export const saveBest = (n: number) => write(KEY.best, n)
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEY.settings) })
export const saveSettings = (s: Settings) => write(KEY.settings, s)

export function exportFile(s: GameState) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `craftingisfun-day${s.day}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importFile(file: File): Promise<GameState | null> {
  try {
    const s: unknown = JSON.parse(await file.text())
    return isGameState(s) ? s : null
  } catch {
    return null
  }
}
