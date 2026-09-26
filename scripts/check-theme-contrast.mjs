#!/usr/bin/env node
/**
 * 主题对比度校验。
 *
 * 设计令牌定义在 `apps/desktop/src/app/globals.css` 的 `:root`（浅色）与 `.dark`（深色）两段。
 * 该脚本把 oklch 令牌换算成 sRGB，按 WCAG 2.x 计算对比度，并校验语义配对是否达标。
 * 只校验文本与关键控件配对；纯装饰性描边不纳入，避免把结构色当成文字色使用。
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS_PATH = path.join(__dirname, "..", "apps", "desktop", "src", "app", "globals.css")

/** [前景, 背景, 最低对比度, 用途] */
const PAIRS = [
  ["foreground", "background", 4.5, "正文 / 画布"],
  ["text-strong", "background", 4.5, "强调文本 / 画布"],
  ["text-muted", "background", 4.5, "次要文本 / 画布"],
  ["text-subtle", "background", 4.5, "弱化文本 / 画布"],
  ["foreground", "card", 4.5, "正文 / 卡片"],
  ["text-muted", "card", 4.5, "次要文本 / 卡片"],
  ["text-subtle", "card", 4.5, "弱化文本 / 卡片"],
  ["foreground", "elevated", 4.5, "正文 / 浮起表面"],
  ["foreground", "secondary", 4.5, "正文 / 次级按钮"],
  ["text-muted", "secondary", 4.5, "次要文本 / 次级按钮"],
  ["primary-foreground", "primary", 4.5, "主按钮文字"],
  ["destructive-foreground", "destructive", 4.5, "危险按钮文字"],
  ["primary", "background", 3, "主色图标 / 画布"],
  ["destructive", "background", 4.5, "错误文本 / 画布"],
  ["success", "background", 3, "成功状态 / 画布"],
  ["warning", "background", 4.5, "警告文本 / 画布"],
  ["timestamp", "timestamp-surface", 4.5, "时间锚点 chip"],
  ["timestamp", "card", 3, "时间码 / 卡片"],
  ["timestamp", "secondary", 4.5, "时间码 / 次级按钮底"],
  ["text-subtle", "secondary", 4.5, "弱化文本 / 次级按钮底"],
  ["accent-foreground", "accent", 4.5, "强调前景 / 强调底色"],
]

function parseOklch(value) {
  const match = String(value).match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
  if (!match) {
    return null
  }
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) }
}

function oklchToLinearRgb({ l, c, h }) {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b

  const lCube = lPrime ** 3
  const mCube = mPrime ** 3
  const sCube = sPrime ** 3

  return {
    r: 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    g: -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    b: -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function relativeLuminance(linear) {
  const r = clamp01(linear.r)
  const g = clamp01(linear.g)
  const b = clamp01(linear.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const light = Math.max(a, b)
  const dark = Math.min(a, b)
  return (light + 0.05) / (dark + 0.05)
}

function luminanceOf(value) {
  const parsed = parseOklch(value)
  return parsed ? relativeLuminance(oklchToLinearRgb(parsed)) : null
}

function extractTokenBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const block = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(css)
  if (!block) {
    return null
  }
  const tokens = {}
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/^\s*--([a-z0-9-]+)\s*:\s*(.+?);\s*$/i)
    if (match) {
      tokens[match[1]] = match[2].trim()
    }
  }
  return tokens
}

/** 允许令牌继承：`:root` 提供浅色基线，`.dark` 覆盖部分角色。 */
function resolveTokens(base, override) {
  return { ...base, ...override }
}

async function main() {
  const css = await fs.readFile(CSS_PATH, "utf8")
  const lightTokens = extractTokenBlock(css, ":root")
  const darkTokens = extractTokenBlock(css, ".dark")

  if (!lightTokens || !darkTokens) {
    console.error("Theme contrast check failed: could not read :root / .dark token blocks from globals.css")
    process.exitCode = 1
    return
  }

  const errors = []
  const report = []

  for (const [themeName, tokens] of [
    ["light", resolveTokens(lightTokens, {})],
    ["dark", resolveTokens(lightTokens, darkTokens)],
  ]) {
    for (const [fgName, bgName, minimum, usage] of PAIRS) {
      const fgValue = tokens[fgName]
      const bgValue = tokens[bgName]
      if (!fgValue || !bgValue) {
        errors.push(`[${themeName}] missing token: ${!fgValue ? fgName : bgName}`)
        continue
      }
      const fgLuminance = luminanceOf(fgValue)
      const bgLuminance = luminanceOf(bgValue)
      if (fgLuminance === null || bgLuminance === null) {
        errors.push(`[${themeName}] ${fgName}/${bgName}: unsupported color format (${fgValue} / ${bgValue})`)
        continue
      }
      const ratio = contrastRatio(fgLuminance, bgLuminance)
      const ok = ratio >= minimum
      report.push({ themeName, pair: `${fgName} on ${bgName}`, ratio: Number(ratio.toFixed(2)), minimum, ok, usage })
      if (!ok) {
        errors.push(
          `[${themeName}] ${fgName} on ${bgName} = ${ratio.toFixed(2)}:1, below ${minimum}:1 (${usage})`,
        )
      }
    }
  }

  const width = Math.max(...report.map((row) => row.pair.length))
  for (const row of report) {
    const mark = row.ok ? "ok  " : "FAIL"
    console.log(`${mark} ${row.themeName.padEnd(5)} ${row.pair.padEnd(width)} ${String(row.ratio).padStart(6)} : 1  (min ${row.minimum})`)
  }

  if (errors.length > 0) {
    console.error("\nTheme contrast check failed:")
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`\nTheme contrast check passed. ${report.length} pairs verified across light and dark.`)
}

await main()
