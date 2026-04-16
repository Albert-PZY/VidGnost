#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE_PREFIXES = ["apps/", "packages/", "scripts/", ".githooks/"];
const IMPLEMENTATION_PREFIXES = ["apps/", "packages/"];
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
const IGNORED_CHANGE_DIRS = new Set(["archive", "template", "templates"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const CAPABILITY_RULES = [
  {
    capability: "transcription-pipeline",
    codePrefixes: [
      "apps/api/src/modules/asr/",
      "apps/api/src/modules/tasks/task-orchestrator.ts",
      "apps/api/test/asr-service.test.ts",
      "apps/api/test/tasks-write.test.ts",
    ],
  },
  {
    capability: "llm-runtime-config",
    codePrefixes: [
      "apps/api/src/modules/llm/",
      "apps/api/src/modules/runtime/",
      "apps/api/src/modules/models/",
      "apps/api/src/routes/config.ts",
      "apps/api/src/server/build-app.ts",
      "apps/api/test/config.test.ts",
      "apps/api/test/self-check.test.ts",
      "apps/api/test/ollama-service-manager.test.ts",
      "packages/contracts/src/config.ts",
      "packages/contracts/src/self-check.ts",
      "apps/desktop/src/components/views/settings-view.tsx",
    ],
  },
  {
    capability: "video-ingestion",
    codePrefixes: [
      "apps/api/src/routes/task-mutations.ts",
      "apps/api/src/routes/task-route-support.ts",
      "apps/desktop/src/components/views/new-task-view.tsx",
      "apps/desktop/src/lib/video-format.ts",
    ],
  },
  {
    capability: "llm-summary-mindmap",
    codePrefixes: [
      "apps/api/src/modules/summary/",
      "apps/api/test/summary-service.test.ts",
    ],
  },
  {
    capability: "sse-runtime-stream",
    codePrefixes: [
      "apps/api/src/modules/events/",
      "apps/api/src/routes/task-events.ts",
      "apps/api/src/routes/vqa.ts",
    ],
  },
  {
    capability: "web-workbench-ui",
    codePrefixes: [
      "apps/desktop/src/components/views/",
      "apps/desktop/src/components/ui/",
      "apps/desktop/src/lib/",
      "apps/api/test/frontend-format.test.ts",
      "apps/api/src/modules/vqa/",
    ],
  },
  {
    capability: "history-and-export",
    codePrefixes: [
      "apps/api/src/routes/task-exports.ts",
      "apps/desktop/src/components/views/history-view.tsx",
      "apps/desktop/src/components/views/task-processing-workbench.tsx",
    ],
  },
];

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

function listWorkingTreePaths() {
  const stdout = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD", "--"], {
    encoding: "utf8",
  });
  return stdout
    .split("\0")
    .map((item) => normalizePath(item.trim()))
    .filter(Boolean);
}

function getDiff(targetPath, options = {}) {
  const { diffMode = "staged", diffRange } = options;
  const args = ["diff", "--unified=0"];

  if (diffRange) {
    args.push(diffRange);
  } else if (diffMode === "staged") {
    args.push("--cached");
  } else if (diffMode === "worktree") {
    args.push("HEAD");
  }

  args.push("--", targetPath);
  return execFileSync("git", args, {
    encoding: "utf8",
  });
}

function listActiveChanges() {
  const changesDir = path.join(REPO_ROOT, "docs", "openspec", "changes");
  if (!fs.existsSync(changesDir)) {
    return [];
  }

  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_CHANGE_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function resolveChangedPaths(cliPaths) {
  if (cliPaths.length > 0) {
    return {
      changedPaths: cliPaths,
      diffMode: "staged",
      usedFallback: false,
    };
  }

  const stagedPaths = listStagedPaths();
  if (stagedPaths.length > 0) {
    return {
      changedPaths: stagedPaths,
      diffMode: "staged",
      usedFallback: false,
    };
  }

  return {
    changedPaths: listWorkingTreePaths(),
    diffMode: "worktree",
    usedFallback: true,
  };
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

function isImplementationOrTestPath(targetPath) {
  if (IGNORED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
    return false;
  }
  if (!IMPLEMENTATION_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
    return false;
  }
  return !DOC_ONLY_SUFFIXES.has(path.posix.extname(targetPath).toLowerCase());
}

function collectTriggeredCapabilities(codePaths) {
  return CAPABILITY_RULES
    .filter((rule) => codePaths.some((filePath) => rule.codePrefixes.some((prefix) => filePath.startsWith(prefix))))
    .map((rule) => rule.capability);
}

function hasTouchedCapabilitySpec(specPaths, capability, activeChanges) {
  const basePrefix = `${SPEC_PREFIX}specs/${capability}/`;
  return {
    baseTouched: specPaths.some((filePath) => filePath.startsWith(basePrefix)),
    changeTouched: activeChanges.some((changeId) =>
      specPaths.some((filePath) => filePath.startsWith(`${SPEC_PREFIX}changes/${changeId}/specs/${capability}/`)),
    ),
  };
}

function getPromotedTaskLines(activeChanges, options = {}) {
  return activeChanges.flatMap((changeId) => {
    const tasksPath = `${SPEC_PREFIX}changes/${changeId}/tasks.md`;
    try {
      const diff = getDiff(tasksPath, options);
      return diff
        .split(/\r?\n/)
        .filter((line) => /^\+\s*- \[(x|X)\] /.test(line))
        .map((line) => line.replace(/^\+\s*/, "").trim());
    } catch {
      return [];
    }
  });
}

function main() {
  const activeChanges = listActiveChanges();
  const cliPaths = process.argv.slice(2).map(normalizePath).filter(Boolean);
  const diffRange = process.env.SPEC_SYNC_DIFF_RANGE?.trim() || "";

  let changedPaths = [];
  let diffMode = "staged";
  let usedFallback = false;
  try {
    ({ changedPaths, diffMode, usedFallback } = resolveChangedPaths(cliPaths));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const uniquePaths = [...new Set(changedPaths)];
  const codePaths = uniquePaths.filter(isCodePath).sort((left, right) => left.localeCompare(right));
  const specPaths = uniquePaths.filter(isSpecPath);
  const implementationPaths = uniquePaths.filter(isImplementationOrTestPath);
  const promotedTaskLines = getPromotedTaskLines(activeChanges, {
    diffMode,
    diffRange: diffRange || undefined,
  });
  const errors = [];

  const triggeredCapabilities = collectTriggeredCapabilities(codePaths);
  for (const capability of triggeredCapabilities) {
    const touch = hasTouchedCapabilitySpec(specPaths, capability, activeChanges);
    if (!touch.baseTouched || !touch.changeTouched) {
      const activeChangeTargets =
        activeChanges.length > 0
          ? activeChanges.map((changeId) => `${SPEC_PREFIX}changes/${changeId}/specs/${capability}/`).join(" 或 ")
          : `${SPEC_PREFIX}changes/<active-change>/specs/${capability}/`;
      errors.push(
        `检测到能力模块 ${capability} 的代码变更，但未同时触达 base/change 两侧 spec 目录：` +
          `${SPEC_PREFIX}specs/${capability}/ 与 ${activeChangeTargets}`,
      );
    }
  }

  if (codePaths.length > 0 && triggeredCapabilities.length === 0 && specPaths.length === 0) {
    errors.push("检测到项目代码变更，但当前提交未包含任何 OpenSpec 同步更新。");
  }

  if (promotedTaskLines.length > 0 && implementationPaths.length === 0) {
    errors.push("检测到 tasks.md 把任务标记为完成，但当前提交未包含实现或测试文件变更。");
  }

  if (errors.length > 0) {
    process.stderr.write("Spec sync check failed:\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    if (codePaths.length > 0) {
      process.stderr.write("触发检查的代码路径：\n");
      for (const filePath of codePaths) {
        process.stderr.write(`- ${filePath}\n`);
      }
    }
    if (promotedTaskLines.length > 0) {
      process.stderr.write("本次提交新增的完成任务项：\n");
      for (const line of promotedTaskLines) {
        process.stderr.write(`- ${line}\n`);
      }
    }
    process.exitCode = 1;
    return;
  }

  if (usedFallback && uniquePaths.length > 0) {
    process.stdout.write("Spec sync check used working tree fallback because no staged paths were found.\n");
  }
}

main();
