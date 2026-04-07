# OpenSpec 文档索引

本目录用于管理本项目的 OpenSpec 规范文档与流程资产。

## 1. 新手入口

- 小白完整教程（推荐先读）：
  - `docs/OpenSpec-beginner-guide.zh-CN.md`

## 2. 当前变更

- Active change root:
  - `docs/openspec/changes/build-lightweight-v2/`
- Manifest:
  - `docs/openspec/changes/build-lightweight-v2/.openspec.yaml`
- Proposal:
  - `docs/openspec/changes/build-lightweight-v2/proposal.md`
- Design:
  - `docs/openspec/changes/build-lightweight-v2/design.md`
- Tasks:
  - `docs/openspec/changes/build-lightweight-v2/tasks.md`

## 3. 基线规格（Base Specs）

稳定后的能力要求沉淀在这里：

- `docs/openspec/specs/`

## 4. 归档区

已完成并归档的 change 放这里：

- `docs/openspec/changes/archive/`
- 归档规则见：
  - `docs/openspec/changes/archive/README.md`

## 5. 模板区

新建 change 时优先从模板复制：

- `docs/openspec/templates/change-template/`

## 6. 自动检查脚本

用于检查 OpenSpec 目录结构与基础内容质量：

- Linux/WSL:
  - `bash scripts/check-openspec.sh`
- Windows PowerShell:
  - `powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1`
- 直接运行 Python:
  - `python scripts/check-openspec.py`
