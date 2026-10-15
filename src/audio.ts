// Faustus voice lines. Only ever called from a click handler (the player's own action).
import faustusJson from './data/faustus.json' with { type: 'json' }

const FAUSTUS = faustusJson as { greeting: string[]; farewell: string[]; intro: { file: string; en: string; ko: string } }
export const FAUSTUS_INTRO = FAUSTUS.intro

let volume = 0.7
let muted = false
let current: HTMLAudioElement | null = null

export function setAudio(v: number, m: boolean) {
  volume = v
  muted = m
}

function play(file: string) {
  if (muted || volume <= 0) return
  if (current && !current.ended && !current.paused) return // don't talk over himself
  current = new Audio(`${import.meta.env.BASE_URL}voice/faustus/${file}`)
  current.volume = volume
  void current.play().catch(() => {}) // autoplay blocked or file missing: stay silent
}

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]
export const faustusGreeting = () => play(pick(FAUSTUS.greeting))
export const faustusFarewell = () => play(pick(FAUSTUS.farewell))
export const faustusIntro = () => play(FAUSTUS.intro.file)

// Sound effects are intentionally not shipped. Hook points: 'currencyPickup', 'currencyApply', 'itemPickup',
// 'itemDrop', 'button'. To add them, extract PoE's FMOD sound banks (*.bank in the game install folder) with
// e.g. vgmstream, drop the oggs in assets/sfx/, and play them here.
export type Sfx = 'currencyApply' | 'itemPickup' | 'button'
export function sfx(_event: Sfx) {}
