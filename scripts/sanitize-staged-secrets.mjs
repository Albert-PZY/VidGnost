#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const AUTO_SANITIZE_PATHS = new Set(["storage/model_config.json"]);
const PLACEHOLDER_VALUES = new Set([
  "",
  "test-key",
  "your-api-key",
  "YOUR_API_KEY",
  "sk-your-api-key",
  "${OPENAI_API_KEY}",
  "${API_KEY}",
  "REDACTED",
  "<redacted>",
  "***",
]);
const SECRET_PATTERNS = [
  ["OpenAI key", /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Bearer token", /Bearer\s+[A-Za-z0-9._-]{20,}/i],
];
const API_KEY_PATTERN = /(["']?api[_-]?key["']?\s*[:=]\s*["'])([^"'\r\n]*)(["'])/gim;

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: options.encoding ?? "utf8",
    input: options.input,
  });
}

function getStagedPaths() {
  const output = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  return output
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
}

function getStagedText(filePath) {
  return runGit(["show", `:${filePath}`]);
}

function getIndexMode(filePath) {
  const line = runGit(["ls-files", "-s", "--", filePath]).trim().split(/\r?\n/, 1)[0];
  return line.split(/\s+/, 4)[0];
}

function updateIndexText(filePath, content) {
  const blobId = runGit(["hash-object", "-w", "--stdin"], { input: content }).trim();
  const mode = getIndexMode(filePath);
  runGit(["update-index", "--cacheinfo", `${mode},${blobId},${filePath}`]);
}

function normalizePlaceholder(value) {
  return value.trim().replace(/^["']+|["']+$/g, "");
}

function isPlaceholder(value) {
  const normalized = normalizePlaceholder(value);
  if (PLACEHOLDER_VALUES.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("${") && normalized.endsWith("}")) {
    return true;
  }
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("your-") || lowered.startsWith("example-")) {
    return true;
  }
  if (normalized && /^[*xX\-_]+$/.test(normalized)) {
    return true;
  }
  return false;
}

function looksLikeSecretValue(value) {
  const normalized = normalizePlaceholder(value);
  if (isPlaceholder(normalized)) {
    return false;
  }
  if (normalized.length < 12) {
    return false;
  }
  if (/^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA)/.test(normalized)) {
    return true;
  }
  if (/[A-Za-z]/.test(normalized) && /\d/.test(normalized)) {
    return true;
  }
  return normalized.length >= 20 && !normalized.includes(" ");
}

function sanitizeApiKeys(text) {
  let changed = false;
  const sanitized = text.replace(API_KEY_PATTERN, (match, prefix, value, suffix) => {
    if (!value || isPlaceholder(value)) {
      return match;
    }
    changed = true;
    return `${prefix}test-key${suffix}`;
  });
  return { sanitized, changed };
}

function findSecretHits(text) {
  const hits = [];
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      hits.push(label);
    }
  }

  for (const match of text.matchAll(API_KEY_PATTERN)) {
    if (looksLikeSecretValue(match[2] ?? "")) {
      hits.push("API key assignment");
      break;
    }
  }
  return hits;
}

function main() {
  let stagedPaths = [];
  try {
    stagedPaths = getStagedPaths();
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const offending = [];

  for (const filePath of stagedPaths) {
    let text = "";
    try {
      text = getStagedText(filePath);
    } catch {
      continue;
    }

    if (AUTO_SANITIZE_PATHS.has(filePath)) {
      const { sanitized, changed } = sanitizeApiKeys(text);
      if (changed) {
        updateIndexText(filePath, sanitized);
        text = sanitized;
        process.stdout.write(`[pre-commit] sanitized staged secrets in ${filePath}\n`);
      }
    }

    const hits = findSecretHits(text);
    if (hits.length > 0) {
      offending.push([filePath, hits]);
    }
  }

  if (offending.length === 0) {
    return;
  }

  process.stderr.write("检测到未脱敏的敏感信息，已阻止本次提交：\n");
  for (const [filePath, hits] of offending) {
    process.stderr.write(`- ${filePath}: ${hits.join(", ")}\n`);
  }
  process.stderr.write("请先移除敏感信息或使用占位值后重新提交。\n");
  process.exitCode = 1;
}

main();
