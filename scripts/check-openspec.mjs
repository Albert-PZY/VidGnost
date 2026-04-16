#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIREMENT_RE = /^### Requirement:/m;
const SCENARIO_RE = /^#### Scenario:/m;
const TASK_ITEM_RE = /^- \[(?: |x|X)\] /m;
const STATUS_RE = /^Status:\s*`(planned|partial|implemented)`/m;
const IGNORED_CHANGE_DIRS = new Set(["archive", "templates"]);
const README_STATUS_TERMS = ["planned", "partial", "implemented"];
const CONTRADICTORY_COMPLETED_TASK_PATTERNS = [
  /auto-download/i,
  /download progress/i,
  /runtime warning/i,
  /delta, warning/i,
  /Ollama pull/i,
];

const CAPABILITY_EVIDENCE = {
  "video-ingestion": {
    implementation: [
      "apps/api/src/routes/task-mutations.ts",
      "apps/api/src/routes/task-route-support.ts",
      "apps/desktop/src/components/views/new-task-view.tsx",
    ],
    tests: ["apps/api/test/tasks-write.test.ts"],
  },
  "transcription-pipeline": {
    implementation: [
      "apps/api/src/modules/asr/asr-service.ts",
      "apps/api/src/modules/tasks/task-orchestrator.ts",
    ],
    tests: ["apps/api/test/asr-service.test.ts", "apps/api/test/tasks-write.test.ts"],
  },
  "llm-runtime-config": {
    implementation: [
      "apps/api/src/routes/config.ts",
      "apps/api/src/modules/models/ollama-service-manager.ts",
      "apps/api/src/modules/runtime/self-check-service.ts",
    ],
    tests: ["apps/api/test/config.test.ts", "apps/api/test/self-check.test.ts"],
  },
  "llm-summary-mindmap": {
    implementation: ["apps/api/src/modules/summary/summary-service.ts"],
    tests: ["apps/api/test/summary-service.test.ts"],
  },
  "sse-runtime-stream": {
    implementation: [
      "apps/api/src/modules/events/event-bus.ts",
      "apps/api/src/routes/task-events.ts",
      "apps/api/src/routes/vqa.ts",
    ],
    tests: [],
  },
  "history-and-export": {
    implementation: [
      "apps/api/src/routes/task-exports.ts",
      "apps/desktop/src/components/views/history-view.tsx",
      "apps/desktop/src/components/views/task-processing-workbench.tsx",
    ],
    tests: ["apps/api/test/tasks-write.test.ts"],
  },
  "web-workbench-ui": {
    implementation: [
      "apps/desktop/src/components/views/settings-view.tsx",
      "apps/desktop/src/components/views/task-processing-workbench.tsx",
    ],
    tests: ["apps/api/test/frontend-format.test.ts"],
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findActiveChanges(changesDir) {
  if (!(await pathExists(changesDir))) {
    return [];
  }

  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORED_CHANGE_DIRS.has(entry.name))
    .map((entry) => path.join(changesDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function validateSpecFile(filePath, errors) {
  let content = "";
  try {
    content = await readText(filePath);
  } catch (error) {
    errors.push(`${toRepoPath(filePath)}: unreadable (${error instanceof Error ? error.message : String(error)})`);
    return "";
  }

  if (!REQUIREMENT_RE.test(content)) {
    errors.push(`${toRepoPath(filePath)}: missing '### Requirement:' block`);
  }
  if (!SCENARIO_RE.test(content)) {
    errors.push(`${toRepoPath(filePath)}: missing '#### Scenario:' block`);
  }
  return content;
}

function toRepoPath(targetPath) {
  return path.relative(path.join(__dirname, ".."), targetPath).replaceAll("\\", "/");
}

function validateCompletedTasks(tasksPath, tasksContent, errors) {
  const lines = tasksContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^- \[(x|X)\] /.test(line));

  for (const line of lines) {
    if (/partial:/i.test(line)) {
      continue;
    }
    if (CONTRADICTORY_COMPLETED_TASK_PATTERNS.some((pattern) => pattern.test(line))) {
      errors.push(`${toRepoPath(tasksPath)}: completed task looks contradictory with current runtime boundary -> ${line}`);
    }
  }
}

async function validateImplementedEvidence(repoRoot, capability, specContent, errors) {
  const implementedCount = (specContent.match(/^Status:\s*`implemented`/gm) || []).length;
  if (implementedCount === 0) {
    return;
  }

  const evidence = CAPABILITY_EVIDENCE[capability];
  if (!evidence) {
    return;
  }

  const implementationExists = await Promise.all(evidence.implementation.map((filePath) => pathExists(path.join(repoRoot, filePath))));
  const testExists = await Promise.all(evidence.tests.map((filePath) => pathExists(path.join(repoRoot, filePath))));

  if (!implementationExists.some(Boolean)) {
    errors.push(`Capability ${capability} is marked as implemented in spec, but no representative implementation file was found.`);
  }
  if (evidence.tests.length > 0 && !testExists.some(Boolean)) {
    errors.push(`Capability ${capability} is marked as implemented in spec, but no representative test file was found.`);
  }
}

async function validateStatusVocabulary(repoRoot, errors) {
  const openspecReadmePath = path.join(repoRoot, "docs", "openspec", "README.md");
  if (!(await pathExists(openspecReadmePath))) {
    errors.push("docs/openspec/README.md is missing.");
    return;
  }
  const content = await readText(openspecReadmePath);
  for (const term of README_STATUS_TERMS) {
    if (!content.includes(term)) {
      errors.push(`docs/openspec/README.md: missing status vocabulary term '${term}'.`);
    }
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const openspecDir = path.join(repoRoot, "docs", "openspec");
  const changesDir = path.join(openspecDir, "changes");
  const baseSpecsDir = path.join(openspecDir, "specs");

  const errors = [];
  const warnings = [];
  const capabilities = new Set();

  const activeChanges = await findActiveChanges(changesDir);
  if (activeChanges.length === 0) {
    errors.push("No active change found under docs/openspec/changes.");
  }

  await validateStatusVocabulary(repoRoot, errors);

  for (const changeDir of activeChanges) {
    for (const requiredName of [".openspec.yaml", "proposal.md", "design.md", "tasks.md"]) {
      const requiredPath = path.join(changeDir, requiredName);
      if (!(await pathExists(requiredPath))) {
        errors.push(`${toRepoPath(changeDir)}: missing ${requiredName}`);
      }
    }

    const tasksPath = path.join(changeDir, "tasks.md");
    if (await pathExists(tasksPath)) {
      const tasksContent = await readText(tasksPath);
      if (!TASK_ITEM_RE.test(tasksContent)) {
        warnings.push(`${toRepoPath(tasksPath)}: no checklist items detected`);
      }
      validateCompletedTasks(tasksPath, tasksContent, errors);
    }

    const specsDir = path.join(changeDir, "specs");
    if (!(await pathExists(specsDir))) {
      errors.push(`${toRepoPath(changeDir)}: missing specs directory`);
      continue;
    }

    const specEntries = await fs.readdir(specsDir, { withFileTypes: true });
    const capabilityDirs = specEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(specsDir, entry.name))
      .sort((left, right) => left.localeCompare(right));

    if (capabilityDirs.length === 0) {
      errors.push(`${toRepoPath(specsDir)}: no capability directories found`);
      continue;
    }

    for (const capabilityDir of capabilityDirs) {
      const capability = path.basename(capabilityDir);
      capabilities.add(capability);
      const specPath = path.join(capabilityDir, "spec.md");
      if (!(await pathExists(specPath))) {
        errors.push(`${toRepoPath(capabilityDir)}: missing spec.md`);
        continue;
      }
      const content = await validateSpecFile(specPath, errors);
      if (content && STATUS_RE.test(content)) {
        await validateImplementedEvidence(repoRoot, capability, content, errors);
      }
    }
  }

  if (!(await pathExists(baseSpecsDir))) {
    errors.push(`Missing base specs directory: ${toRepoPath(baseSpecsDir)}`);
  } else {
    for (const capability of [...capabilities].sort((left, right) => left.localeCompare(right))) {
      const baseSpecPath = path.join(baseSpecsDir, capability, "spec.md");
      if (!(await pathExists(baseSpecPath))) {
        errors.push(
          `Missing base spec for capability '${capability}': ${toRepoPath(baseSpecPath)}. ` +
            "Promote stable requirements from active change into base specs.",
        );
        continue;
      }
      const content = await validateSpecFile(baseSpecPath, errors);
      if (content && STATUS_RE.test(content)) {
        await validateImplementedEvidence(repoRoot, capability, content, errors);
      }
    }
  }

  if (warnings.length > 0) {
    console.log("OpenSpec warnings:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error("OpenSpec check failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OpenSpec check passed. Active changes: ${activeChanges.length}, capabilities checked: ${capabilities.size}.`,
  );
}

await main();
