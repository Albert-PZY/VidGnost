#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIREMENT_RE = /^### Requirement:/m;
const SCENARIO_RE = /^#### Scenario:/m;
const TASK_ITEM_RE = /^- \[(?: |x|X)\] /m;
const IGNORED_CHANGE_DIRS = new Set(["archive", "templates"]);

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
    return;
  }

  if (!REQUIREMENT_RE.test(content)) {
    errors.push(`${toRepoPath(filePath)}: missing '### Requirement:' block`);
  }
  if (!SCENARIO_RE.test(content)) {
    errors.push(`${toRepoPath(filePath)}: missing '#### Scenario:' block`);
  }
}

function toRepoPath(targetPath) {
  return path.relative(path.join(__dirname, ".."), targetPath).replaceAll("\\", "/");
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
      await validateSpecFile(specPath, errors);
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
      await validateSpecFile(baseSpecPath, errors);
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
