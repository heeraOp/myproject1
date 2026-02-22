// Centralized Audio Manager
// Responsibilities:
// - unlock audio on first user gesture
// - prevent overlapping audio by reusing a single audio element
// - handle play() promise rejections
// - provide playSound(url), playElement(audio), stopCurrent(), isUnlocked()

type MaybeAudio = HTMLAudioElement | null
type WindowWithLegacyAudioContext = Window & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

let currentAudio: MaybeAudio = null
let audioUnlocked = false
let hintElement: HTMLElement | null = null
let gestureAttached = false

const GESTURE_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'pointerdown',
  'touchstart',
  'click',
  'keydown',
]

const createHint = () => {
  if (typeof document === 'undefined') return
  if (hintElement) return
  const el = document.createElement('div')
  el.className = 'audio-unlock-hint'
  el.textContent = 'Click anywhere to enable sound'
  const style = el.style
  style.position = 'fixed'
  style.left = '12px'
  style.bottom = '12px'
  style.zIndex = '2000'
  style.background = 'rgba(0,0,0,0.6)'
  style.color = '#fff'
  style.padding = '8px 12px'
  style.borderRadius = '8px'
  style.fontSize = '13px'
  style.cursor = 'pointer'
  style.userSelect = 'none'
  el.onclick = () => {
    void unlockAudio()
  }
  hintElement = el
  document.body.appendChild(el)
}

const removeHint = () => {
  if (!hintElement) return
  hintElement.remove()
  hintElement = null
}

const unlockAudio = async (): Promise<boolean> => {
  if (audioUnlocked) return true
  try {
    // Try to resume WebAudio if available
    const audioWindow = window as WindowWithLegacyAudioContext
    const AudioCtx = audioWindow.AudioContext || audioWindow.webkitAudioContext
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx()
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }
        // create a tiny silent buffer and play to unlock
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(ctx.destination)
        src.start(0)
        // stop immediately
        src.stop(0)
      } catch {
        // ignore
      }
    }

    // As a fallback, create an Audio element and play a blank short data URI
    try {
      const silent = new Audio('data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAA==')
      // attempt to play; some browsers may still block but it's fine
      await silent.play().catch(() => {})
      silent.pause()
      silent.src = ''
    } catch {
      // ignore
    }

    audioUnlocked = true
    removeHint()
    detachGestureListeners()
    return true
  } catch {
    return false
  }
}

const handleGesture = () => {
  void unlockAudio()
}

const attachGestureListeners = () => {
  if (gestureAttached || typeof window === 'undefined') return
  gestureAttached = true
  GESTURE_EVENTS.forEach((ev) => window.addEventListener(ev, handleGesture, { passive: true }))
  createHint()
}

const detachGestureListeners = () => {
  if (!gestureAttached || typeof window === 'undefined') return
  gestureAttached = false
  GESTURE_EVENTS.forEach((ev) => window.removeEventListener(ev, handleGesture))
}

const stopCurrent = () => {
  if (!currentAudio) return
  try {
    currentAudio.pause()
    currentAudio.currentTime = 0
  } catch {
    // ignore
  }
  currentAudio = null
}

const playElement = async (audio: HTMLAudioElement): Promise<boolean> => {
  // prevent overlap
  try {
    if (!audio) return false
    if (!audioUnlocked) {
      // ensure we attempt to unlock but queue behavior left to caller
      attachGestureListeners()
      await unlockAudio().catch(() => {})
      if (!audioUnlocked) return false
    }

    // stop and replace current
    if (currentAudio && currentAudio !== audio) {
      try {
        currentAudio.pause()
        currentAudio.currentTime = 0
      } catch {
        // ignore
      }
    }
    currentAudio = audio
    audio.preload = 'auto'
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.then === 'function') {
      return playPromise.then(() => true).catch((err) => {
        console.warn('Audio blocked or failed to play:', err)
        return false
      })
    }
    return true
  } catch (err) {
    console.warn('playElement error', err)
    return false
  }
}

const playSound = async (url: string): Promise<boolean> => {
  try {
    if (!audioUnlocked) {
      attachGestureListeners()
      await unlockAudio().catch(() => {})
      if (!audioUnlocked) return false
    }

    if (!currentAudio) {
      currentAudio = new Audio()
      currentAudio.preload = 'auto'
    } else {
      try {
        currentAudio.pause()
        currentAudio.currentTime = 0
      } catch {
        // ignore
      }
    }
    currentAudio.src = url
    // ensure load is attempted
    try {
      currentAudio.load()
    } catch {
      // ignore
    }
    const p = currentAudio.play()
    if (p && typeof p.then === 'function') {
      return p.then(() => true).catch((err) => {
        console.warn('Audio blocked or failed to play:', err)
        return false
      })
    }
    return true
  } catch (err) {
    console.warn('playSound error', err)
    return false
  }
}

const isUnlocked = () => audioUnlocked

const isPlaying = () => !!currentAudio && !currentAudio.paused

const destroy = () => {
  stopCurrent()
  detachGestureListeners()
  removeHint()
}

export const AudioManager = {
  playSound,
  playElement,
  stopCurrent,
  attachGestureListeners,
  unlockAudio,
  isUnlocked,
  isPlaying,
  destroy,
}

export default AudioManager
