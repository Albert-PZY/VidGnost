# 仓库文件格式策略

本文档定义 VidGnost 仓库内“文本文件”的统一格式策略，目标是减少 Windows / macOS / Linux 混合开发环境下的换行、编码、乱码和无意义 diff。

## 1. 目标

统一以下问题：

- 文本文件统一使用 `UTF-8` 无 BOM
- 文本文件统一使用 `LF` 换行
- 文本文件默认保留结尾换行
- 让编辑器、本地 Git 和提交钩子三层同时兜底

## 2. 当前策略分层

### 2.1 编辑器层：`.editorconfig`

仓库根目录的 `.editorconfig` 负责给大多数编辑器提供默认行为：

- `charset = utf-8`
- `end_of_line = lf`
- `insert_final_newline = true`
- `trim_trailing_whitespace = true`

额外约束：

- Python 文件使用 4 空格缩进
- Markdown 文件关闭尾随空白自动裁剪，避免误伤 Markdown 强制换行

### 2.2 Git 层：`.gitattributes`

仓库根目录的 `.gitattributes` 负责 Git 入库规范化：

- 默认文本文件按 `LF` 入库
- 常见源代码 / 文档 / 配置文件显式声明为文本
- 常见图片、压缩包、音视频等资源显式声明为二进制，避免误归一化

说明：

- 即使本地编辑器或系统默认换行为 `CRLF`，Git 也会按仓库策略进行规范化
- 新策略不会主动改写你当前未变更的工作区文件，但会约束后续新增和修改文件

### 2.3 提交层：Git Hook

`.githooks/pre-commit` 现已串联两类检查：

1. 敏感配置防泄漏检查
2. 文本文件格式检查

当前格式检查规则：

- 必须是 `UTF-8`
- 不能带 `UTF-8 BOM`
- 不能包含 `CRLF` / `CR`
- 非空文本文件必须以换行结尾

## 3. 适用范围

当前重点覆盖以下文本类型：

- 代码：`py`、`ts`、`tsx`、`js`、`jsx`
- 样式与页面：`css`、`html`
- 文档：`md`、`txt`
- 配置：`json`、`jsonl`、`toml`、`yaml`、`yml`
- 脚本：`sh`、`ps1`
- 仓库元文件：`.editorconfig`、`.gitattributes`、`.gitignore`、`.npmrc`、`LICENSE`、`README*`

## 4. 推荐本地启用方式

启用仓库自带 Hook：

```bash
git config core.hooksPath .githooks
```

## 5. 手动检查命令

检查当前暂存区中的文本文件是否符合策略：

```bash
python scripts/git-hooks/check_text_file_policy.py --mode staged
```

检查指定文件：

```bash
python scripts/git-hooks/check_text_file_policy.py --mode files .editorconfig .gitattributes README.zh-CN.md
```

## 6. 变更建议

新增文本文件时，优先遵循：

1. 使用 UTF-8 无 BOM 保存
2. 使用 LF 换行
3. 保留结尾换行
4. 若为新增文本类型且希望纳入统一约束，同步补充到：
   - `.gitattributes`
   - `scripts/git-hooks/check_text_file_policy.py`

## 7. 不在本策略中强制处理的内容

当前不强制纳入本策略的内容：

- 代码语义层格式化风格（例如是否接入 Prettier / Ruff 的自动 rewrite）
- 缩进风格以外的细粒度代码 style 规则
- 二进制资源内容本身的编码或压缩方式

这部分如果后续需要，可以在不破坏当前轻量开发体验的前提下继续追加。
