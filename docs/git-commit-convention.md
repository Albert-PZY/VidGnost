# Git Commit Convention (Conventional Commits 1.0.0)

Scope: this convention applies to all commits in this repository, including code, scripts, docs, and spec updates.

References:
- https://www.conventionalcommits.org/en/v1.0.0/
- https://www.conventionalcommits.org/zh-hans/v1.0.0/

## 1. Commit Message Structure

The commit title must follow:

```text
<type>[optional scope][!]: <description>
```

Optional body and footer format:

```text
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Notes:
- `type`: required.
- `scope`: optional, recommended for module ownership.
- `!`: optional, indicates a breaking change.
- `description`: required, short and specific.
- `body`: optional, for context and implementation details.
- `footer`: optional, for issue references or `BREAKING CHANGE:`.

## 2. Repository Rules

- Use exact punctuation: `type(scope): description`.
- Keep `type` and `scope` in lowercase.
- Use concise imperative phrasing in `description`.
- Keep title length within ~72 characters when possible.
- One commit should represent one logical change.
- When a task touches multiple independent concerns, split it into multiple commits by concern/module.
- Avoid mixed "all-in-one" commits that bundle unrelated backend/frontend/docs/script changes together.
- Follow branch-based workflow: create/select a dedicated branch for each requirement before committing.
- If a commit changes implementation for a spec-governed capability, include the matching OpenSpec / README sync in the same delivery rather than backfilling it later.
- Do not mark a capability task as completed in `tasks.md` unless the same delivery also contains the corresponding implementation or test evidence.
- Do not commit directly to `master`; commit on the dedicated branch first, then merge into `master`.
- After code is merged into `master`, automatically clean up redundant branches other than `master` (both local and remote merged branches).
- Temporary integration branches are allowed for merge workflows when needed.
- Breaking changes must be explicit with `!` or `BREAKING CHANGE:`.

### 2.1 Git Safety Rules

- All git operations must be executed sequentially.
- Never run concurrent git commands in the same repository.
- Enforce a single-operation-at-a-time policy for the repository.
- On any lock conflict (for example `index.lock`), stop and retry instead of proceeding.

### 2.2 GitHub Operation Rules (`gh` CLI by default)

- Default to GitHub CLI (`gh`) for GitHub remote operations (for example PR create/view/merge, remote branch inspection, workflow checks).
- Keep local repository operations on `git` (commit, rebase, local merge, local branch cleanup), and use `gh` when the action targets GitHub platform resources.
- If a specific GitHub action cannot be completed with `gh`, document the reason in the task log and then use the minimum necessary fallback command.

Examples:

```bash
gh pr create --fill
gh pr view --web
gh pr merge --squash --delete-branch
gh run list --limit 20
```

## 3. Allowed Types

- `feat`: new feature (`MINOR` in SemVer).
- `fix`: bug fix (`PATCH` in SemVer).
- `docs`: documentation changes.
- `style`: formatting/style-only changes (no behavior changes).
- `refactor`: code restructuring without feature or fix semantics.
- `perf`: performance improvements.
- `test`: tests added or updated.
- `build`: build system or build dependency changes.
- `ci`: CI/CD pipeline changes.
- `chore`: maintenance updates that do not fit other types.
- `revert`: revert a previous commit.

## 4. Recommended Scopes for This Repo

- `frontend`
- `backend`
- `docs`
- `openspec`
- `scripts`
- `api`
- `ui`
- `runtime`
- `self-check`
- `config`
- `deps`

Example: `fix(backend): normalize hf token loading order`

## 5. Breaking Change Rules

Use either form below:

1. Add `!` in the title.
2. Add `BREAKING CHANGE:` in footer.

Example:

```text
feat(api)!: rename /tasks/export endpoint

BREAKING CHANGE: endpoint changed from /tasks/export to /tasks/{id}/export
```

## 6. Good Examples

```text
feat(frontend): add environment self-check modal with realtime SSE timeline
fix(backend): handle missing CUDA runtime libs in self-check report
docs(openspec): add self-check stream requirements and scenarios
chore(scripts): force-stop occupied ports before bootstrap
test(backend): add auto-fix conflict status test for self-check session
revert(frontend): revert sidebar interaction behavior
```

Example with body and footer:

```text
fix(runtime): prevent background scroll when modal is open

Lock html and body overflow while the sidebar modal is active,
and restore previous styles on close.

Refs: #128
```

## 7. Bad Examples

```text
update code
fix: tweak
feat(frontend) add button
docs: update
```

Why these are bad:
- invalid or incomplete Conventional Commit structure.
- vague description with poor traceability.

## 8. Quick Templates

Standard commit:

```text
<type>(<scope>): <description>

<why>
<what>
<impact>

Refs: #<issue-id>
```

Breaking change commit:

```text
<type>(<scope>)!: <description>

BREAKING CHANGE: <what changed and how to migrate>
```
