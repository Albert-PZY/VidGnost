import { create } from 'zustand'

interface PlayerState {
  currentTime: number
  duration: number
  playing: boolean
  rate: number
  videoEl: HTMLVideoElement | null
  setVideoEl: (element: HTMLVideoElement | null) => void
  setDuration: (duration: number) => void
  setCurrentTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  setRate: (rate: number) => void
  seek: (time: number, options?: { autoplay?: boolean }) => void
  toggle: () => void
  nudge: (delta: number) => void
}

/**
 * 播放器状态。时间锚点跳转（引用 chip、章节、转写行）统一走 `seek`，
 * 保证「点哪都能回到原片」只有一个实现。
 */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  playing: false,
  rate: 1,
  videoEl: null,

  setVideoEl: (videoEl) => set({ videoEl }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => {
    const element = get().videoEl
    if (element) {
      element.playbackRate = rate
    }
    set({ rate })
  },

  seek: (time, options) => {
    const element = get().videoEl
    const target = Math.max(0, Math.min(time, get().duration || Number.POSITIVE_INFINITY))
    if (element) {
      element.currentTime = target
      if (options?.autoplay && element.paused) {
        void element.play().catch(() => undefined)
      }
    }
    set({ currentTime: target })
  },

  toggle: () => {
    const element = get().videoEl
    if (!element) return
    if (element.paused) {
      void element.play().catch(() => undefined)
    } else {
      element.pause()
    }
  },

  nudge: (delta) => {
    get().seek(get().currentTime + delta)
  },
}))
