// Faustus voice lines. Only ever called from a click handler (the player's own action).
import faustusJson from './data/faustus.json' with { type: 'json' }

const FAUSTUS = faustusJson as { greeting: string[]; farewell: string[]; intro: { file: string; end: number; en: string; ko: string } }
export const FAUSTUS_INTRO = FAUSTUS.intro

let volume = 0.7
let muted = false
let current: HTMLAudioElement | null = null

export function setAudio(v: number, m: boolean) {
  volume = v
  muted = m
}

// `end`: stop there (seconds), for a line cut short.
function play(file: string, end?: number) {
  if (muted || volume <= 0) return
  if (current && !current.ended && !current.paused) return // don't talk over himself
  const audio = new Audio(`${import.meta.env.BASE_URL}voice/faustus/${file}`)
  current = audio
  audio.volume = volume
  if (end) audio.addEventListener('playing', () => setTimeout(() => audio.pause(), (end - audio.currentTime) * 1000), { once: true })
  void audio.play().catch(() => {}) // autoplay blocked or file missing: stay silent
}

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]
export const faustusGreeting = () => play(pick(FAUSTUS.greeting))
export const faustusFarewell = () => play(pick(FAUSTUS.farewell))
export const faustusIntro = () => play(FAUSTUS.intro.file, FAUSTUS.intro.end)

// Sound effects are intentionally not shipped. Hook points: 'currencyPickup', 'currencyApply', 'itemPickup',
// 'itemDrop', 'button'. To add them, extract PoE's FMOD sound banks (*.bank in the game install folder) with
// e.g. vgmstream, drop the oggs in assets/sfx/, and play them here.
export type Sfx = 'currencyApply' | 'itemPickup' | 'button'
export function sfx(_event: Sfx) {}
