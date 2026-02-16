type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

type AudioUnlockListener = (unlocked: boolean) => void
type QueuedAudioPlay = {
  audio: HTMLAudioElement
  resolve: (played: boolean) => void
}

const GESTURE_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'pointerdown',
  'touchstart',
  'click',
  'keydown',
]

let sharedAudioContext: AudioContext | null = null
let listenersAttached = false
let globalAudioUnlocked = false
const unlockListeners = new Set<AudioUnlockListener>()
const queuedAudioPlays: QueuedAudioPlay[] = []

const playAudioNow = async (audio: HTMLAudioElement): Promise<boolean> => {
  try {
    const playback = audio.play()
    if (playback && typeof playback.then === 'function') {
      await playback
    }
    return true
  } catch {
    return false
  }
}

const queueAudioPlayback = (audio: HTMLAudioElement): Promise<boolean> =>
  new Promise((resolve) => {
    queuedAudioPlays.push({ audio, resolve })
  })

const flushQueuedAudioPlays = () => {
  if (!globalAudioUnlocked) return
  if (queuedAudioPlays.length === 0) return
  const pending = queuedAudioPlays.splice(0, queuedAudioPlays.length)
  pending.forEach(({ audio, resolve }) => {
    void (async () => {
      await resumeGlobalAudioContext()
      const played = await playAudioNow(audio)
      resolve(played)
    })()
  })
}

const notifyUnlockListeners = () => {
  unlockListeners.forEach((listener) => {
    listener(globalAudioUnlocked)
  })
}

const setGlobalAudioUnlocked = (next: boolean) => {
  if (globalAudioUnlocked === next) return
  globalAudioUnlocked = next
  notifyUnlockListeners()
  if (next) {
    flushQueuedAudioPlays()
  }
}

const getAudioContextConstructor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null
  const typedWindow = window as WebkitAudioWindow
  return typedWindow.AudioContext ?? typedWindow.webkitAudioContext ?? null
}

export const isAudioUnlocked = (): boolean => globalAudioUnlocked

export const subscribeAudioUnlock = (listener: AudioUnlockListener): (() => void) => {
  unlockListeners.add(listener)
  listener(globalAudioUnlocked)
  return () => {
    unlockListeners.delete(listener)
  }
}

export const getGlobalAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  if (sharedAudioContext) return sharedAudioContext
  const ContextCtor = getAudioContextConstructor()
  if (!ContextCtor) {
    setGlobalAudioUnlocked(true)
    return null
  }
  try {
    sharedAudioContext = new ContextCtor()
  } catch {
    sharedAudioContext = null
  }
  return sharedAudioContext
}

const detachUnlockListeners = () => {
  if (typeof window === 'undefined') return
  if (!listenersAttached) return
  GESTURE_EVENTS.forEach((eventName) => {
    window.removeEventListener(eventName, handleGestureUnlock)
  })
  listenersAttached = false
}

export const resumeGlobalAudioContext = async (): Promise<boolean> => {
  const context = getGlobalAudioContext()
  if (!context) {
    setGlobalAudioUnlocked(true)
    detachUnlockListeners()
    return true
  }
  if (context.state === 'running') {
    setGlobalAudioUnlocked(true)
    detachUnlockListeners()
    return true
  }
  try {
    await context.resume()
  } catch {
    return false
  }
  const stateAfterResume = context.state as AudioContextState
  const running = stateAfterResume === 'running'
  if (running) {
    setGlobalAudioUnlocked(true)
    detachUnlockListeners()
  }
  return running
}

export const unlockAudioFromUserGesture = async (): Promise<boolean> => {
  const contextResumed = await resumeGlobalAudioContext()
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.resume()
      window.speechSynthesis.getVoices()
    } catch {
      // Ignore speech engine probe failures.
    }
  }
  return contextResumed
}

const handleGestureUnlock = () => {
  void unlockAudioFromUserGesture()
}

export const initGlobalAudioUnlock = (): void => {
  if (typeof window === 'undefined') return
  if (listenersAttached || globalAudioUnlocked) return
  listenersAttached = true
  GESTURE_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, handleGestureUnlock)
  })
  void unlockAudioFromUserGesture()
}

export const playAudioElementSafely = async (audio: HTMLAudioElement): Promise<boolean> => {
  if (!globalAudioUnlocked) {
    void resumeGlobalAudioContext()
    return queueAudioPlayback(audio)
  }

  const resumed = await resumeGlobalAudioContext()
  if (!resumed || !globalAudioUnlocked) {
    return queueAudioPlayback(audio)
  }

  const played = await playAudioNow(audio)
  if (!played && !globalAudioUnlocked) {
    return queueAudioPlayback(audio)
  }
  return played
}
