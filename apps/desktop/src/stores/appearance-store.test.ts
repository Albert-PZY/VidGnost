import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEPS,
  normalizeFontSize,
  normalizeThemeMode,
  readStoredFontSize,
  readStoredMode,
  resolveTheme,
  scaleForFontSize,
} from './appearance-store'

describe('FONT_SIZE_STEPS', () => {
  it('offers every pixel value from 12 to 26', () => {
    expect(FONT_SIZE_STEPS[0]).toBe(FONT_SIZE_MIN)
    expect(FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]).toBe(FONT_SIZE_MAX)
    expect(FONT_SIZE_STEPS).toHaveLength(15)
    expect(FONT_SIZE_STEPS.every((step, index) => index === 0 || step === FONT_SIZE_STEPS[index - 1] + 1)).toBe(true)
  })

  it('defaults to 14px, where the scale is 1', () => {
    expect(DEFAULT_FONT_SIZE).toBe(14)
    expect(scaleForFontSize(DEFAULT_FONT_SIZE)).toBe(1)
  })
})

describe('scaleForFontSize', () => {
  it('maps the chosen pixel value onto the root scale', () => {
    // 正文是 0.875rem、根字号是 16px，因此 14px 时比例为 1，正文正好等于选定值。
    expect(scaleForFontSize(12)).toBeCloseTo(12 / 14)
    expect(scaleForFontSize(18)).toBeCloseTo(18 / 14)
    expect(scaleForFontSize(26)).toBeCloseTo(26 / 14)
  })
})

describe('normalizeFontSize', () => {
  it('keeps values inside the offered range', () => {
    expect(normalizeFontSize('12')).toBe(12)
    expect(normalizeFontSize('18')).toBe(18)
    expect(normalizeFontSize(26)).toBe(26)
  })

  it('clamps out-of-range values instead of rendering them', () => {
    expect(normalizeFontSize('4')).toBe(FONT_SIZE_MIN)
    expect(normalizeFontSize('400')).toBe(FONT_SIZE_MAX)
    expect(normalizeFontSize(-8)).toBe(FONT_SIZE_MIN)
  })

  it('takes the integer part of a stored value with extra characters', () => {
    // 正常路径只会写入整数；这里覆盖手工改坏存储的情况，取整数部分而不是丢回默认值。
    expect(normalizeFontSize('15.6')).toBe(15)
    expect(normalizeFontSize('18px')).toBe(18)
  })

  it('falls back to the default when the stored value is unusable', () => {
    expect(normalizeFontSize(null)).toBe(DEFAULT_FONT_SIZE)
    expect(normalizeFontSize(undefined)).toBe(DEFAULT_FONT_SIZE)
    expect(normalizeFontSize('')).toBe(DEFAULT_FONT_SIZE)
    expect(normalizeFontSize('huge')).toBe(DEFAULT_FONT_SIZE)
  })
})

describe('normalizeThemeMode', () => {
  it('keeps the three known modes and defaults to system', () => {
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('system')).toBe('system')
    expect(normalizeThemeMode(null)).toBe('system')
    expect(normalizeThemeMode('solarized')).toBe('system')
  })
})

describe('readers without a DOM', () => {
  it('return the defaults so the store can be imported outside the renderer', () => {
    expect(readStoredFontSize()).toBe(DEFAULT_FONT_SIZE)
    expect(readStoredMode()).toBe('system')
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })
})
