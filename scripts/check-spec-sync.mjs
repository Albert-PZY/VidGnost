#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

const CODE_PREFIXES = ["apps/", "packages/", "scripts/", ".githooks/"];
const IGNORED_PREFIXES = ["storage/", "apps/desktop/dist/", "apps/api/dist/"];
const ROOT_CODE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "start-all.ps1",
  "start-all.sh",
]);
const DOC_ONLY_SUFFIXES = new Set([".md", ".txt"]);
const SPEC_PREFIX = "docs/openspec/";

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function listStagedPaths() {
  const stdout = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    encoding: "utf8",
  });
  return stdout
    .split("\0")
    .map((item) => normalizePath(item.trim()))
    .filter(Boolean);
}

function isSpecPath(targetPath) {
  return targetPath.startsWith(SPEC_PREFIX);
}

function isCodePath(targetPath) {
  if (IGNORED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
    return false;
  }
  if (ROOT_CODE_FILES.has(targetPath)) {
    return true;
  }
  if (!CODE_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
    return false;
  }
  return !DOC_ONLY_SUFFIXES.has(path.posix.extname(targetPath).toLowerCase());
}

function main() {
  let changedPaths = process.argv.slice(2).map(normalizePath).filter(Boolean);
  if (changedPaths.length === 0) {
    try {
      changedPaths = listStagedPaths();
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }

  const codePaths = [...new Set(changedPaths.filter(isCodePath))].sort((left, right) => left.localeCompare(right));
  if (codePaths.length === 0) {
    return;
  }

  const specPaths = [...new Set(changedPaths.filter(isSpecPath))];
  if (specPaths.length > 0) {
    return;
  }

  process.stderr.write("检测到项目代码变更，但当前提交未包含 OpenSpec 同步更新，已阻止本次提交/校验。\n");
  process.stderr.write("以下代码路径触发了 spec 同步约束：\n");
  for (const filePath of codePaths) {
    process.stderr.write(`- ${filePath}\n`);
  }
  process.stderr.write("请至少同步更新以下目录中的受影响 spec：\n");
  process.stderr.write(`- ${SPEC_PREFIX}changes/build-lightweight-v2/specs/\n`);
  process.stderr.write(`- ${SPEC_PREFIX}specs/\n`);
  process.stderr.write("如果实现细节已被现有 spec 完整覆盖，请在本次交付中补充对应 OpenSpec 文档以体现已完成的核对。\n");
  process.exitCode = 1;
}

main();
