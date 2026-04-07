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

### 2.4 代码风格层：Prettier + Ruff

仓库现已补充代码风格层，分工如下：

- `Prettier`：负责前端、Markdown、JSON、YAML、TOML、仓库元文件等非 Python 文本格式化
- `Ruff`：负责 Python 导入顺序、基础静态检查与格式化

对应配置文件：

- `.prettierrc.json`
- `.prettierignore`
- `backend/pyproject.toml` 中的 `tool.ruff`

对应入口：

- 前端局部格式化：
  - `cd frontend && pnpm format`
  - `cd frontend && pnpm format:check`
- 仓库级统一入口：
  - `python scripts/repository_style.py format`
  - `python scripts/repository_style.py check`

## 3. 适用范围

当前重点覆盖以下文本类型：

- 代码：`py`、`ts`、`tsx`、`js`、`jsx`
- 样式与页面：`css`、`html`
- 文档：`md`、`txt`
- 配置：`json`、`jsonl`、`toml`、`yaml`、`yml`
- 脚本：`sh`、`ps1`
- 仓库元文件：`.editorconfig`、`.gitattributes`、`.gitignore`、`.npmrc`、`LICENSE`、`README*`

例外说明：

- `backend/storage/config.toml`
- `backend/storage/model_config.json`

这两个本地配置文件属于受保护运行时配置，不参与自动归一化改写，避免误动本地真实配置值与敏感信息。

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

执行全仓文本归一化 + 代码格式化：

```bash
python scripts/repository_style.py format
```

执行全仓格式检查（不改文件）：

```bash
python scripts/repository_style.py check
```

## 6. 变更建议

新增文本文件时，优先遵循：

1. 使用 UTF-8 无 BOM 保存
2. 使用 LF 换行
3. 保留结尾换行
4. 若为新增文本类型且希望纳入统一约束，同步补充到：
   - `.gitattributes`
   - `scripts/git-hooks/check_text_file_policy.py`
5. 若新增了需要由 Prettier 或 Ruff 接管的文件类型 / 目录，同步更新：
   - `.prettierignore`
   - `scripts/repository_style.py`
   - `backend/pyproject.toml`

## 7. 不在本策略中强制处理的内容

当前不强制纳入本策略的内容：

- 缩进风格以外的细粒度业务代码风格规则
- 二进制资源内容本身的编码或压缩方式

这部分如果后续需要，可以继续在当前轻量工具链基础上追加。
