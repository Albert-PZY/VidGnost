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
  /platform subtitle/i,
  /bilibili login/i,
  /cookie/i,
];

const CAPABILITY_EVIDENCE = {
  "video-ingestion": {
    implementation: [
      "apps/api/src/media/media-service.ts",
      "apps/api/src/routes/tasks.ts",
      "apps/api/src/routes/media.ts",
      "apps/desktop/src/components/library/new-task-dialog.tsx",
    ],
    tests: ["apps/api/test/media.test.ts"],
  },
  "transcription-pipeline": {
    implementation: [
      "apps/api/src/asr/transcription-service.ts",
      "apps/api/src/providers/dashscope.ts",
      "apps/api/src/providers/local-whisper.ts",
    ],
    tests: ["apps/api/test/transcription-service.test.ts"],
  },
  "insight-generation": {
    implementation: [
      "apps/api/src/insight/segmenter.ts",
      "apps/api/src/insight/outline-service.ts",
      "apps/api/src/insight/summary-service.ts",
      "apps/api/src/insight/mindmap-service.ts",
      "apps/api/src/insight/knowledge-service.ts",
    ],
    tests: ["apps/api/test/segmenter.test.ts"],
  },
  "visual-enrichment": {
    implementation: [
      "apps/api/src/media/frame-service.ts",
      "apps/api/src/media/perceptual-hash.ts",
      "apps/api/src/insight/enrich-service.ts",
    ],
    tests: ["apps/api/test/media.test.ts"],
  },
  "knowledge-retrieval": {
    implementation: [
      "apps/api/src/retrieval/chunking.ts",
      "apps/api/src/retrieval/bm25.ts",
      "apps/api/src/retrieval/index-service.ts",
      "apps/api/src/retrieval/contextualizer.ts",
      "apps/api/src/retrieval/qa-service.ts",
    ],
    tests: ["apps/api/test/retrieval.test.ts", "apps/api/test/bm25.test.ts", "apps/api/test/chunking.test.ts"],
  },
  "model-routing": {
    implementation: [
      "apps/api/src/providers/gateway.ts",
      "apps/api/src/providers/settings-store.ts",
      "apps/api/src/providers/catalog.ts",
      "apps/api/src/providers/health.ts",
      "apps/api/src/routes/config.ts",
    ],
    tests: ["apps/api/test/providers.test.ts"],
  },
  "pipeline-runtime": {
    implementation: [
      "apps/api/src/pipeline/task-runner.ts",
      "apps/api/src/pipeline/task-manager.ts",
      "apps/api/src/pipeline/event-bus.ts",
      "apps/api/src/routes/events.ts",
    ],
    tests: ["apps/api/test/pipeline.test.ts"],
  },
  "library-and-export": {
    implementation: [
      "apps/api/src/store/task-store.ts",
      "apps/api/src/routes/export.ts",
      "apps/desktop/src/components/views/library-view.tsx",
    ],
    tests: ["apps/api/test/task-store.test.ts"],
  },
  "desktop-studio-ui": {
    implementation: [
      "apps/desktop/src/components/views/studio-view.tsx",
      "apps/desktop/src/components/views/library-view.tsx",
      "apps/desktop/src/components/shell/command-palette.tsx",
      "apps/desktop/src/stores/player-store.ts",
    ],
    tests: ["apps/desktop/src/lib/format.test.ts"],
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
