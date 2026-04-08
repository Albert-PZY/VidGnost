# VidGnost 错误码字典（后端）

本文档用于前后端联调、日志排障与告警聚合。  
约定的错误响应结构：

```json
{
  "code": "ERROR_CODE",
  "message": "可读错误信息",
  "detail": {}
}
```

## 通用错误码

| 错误码 | 含义 | 典型触发场景 |
| --- | --- | --- |
| `BAD_REQUEST` | 请求参数不合法 | 通用 400 |
| `NOT_FOUND` | 资源不存在 | 通用 404 |
| `CONFLICT` | 状态冲突 | 通用 409 |
| `VALIDATION_ERROR` | 请求体验证失败 | Pydantic/FastAPI 参数验证失败 |
| `INTERNAL_SERVER_ERROR` | 未捕获服务端异常 | 500；`detail.trace_id` 可用于日志追踪 |

## 任务与输入相关

| 错误码 | 含义 | 典型触发场景 |
| --- | --- | --- |
| `TASK_NOT_FOUND` | 任务不存在 | 查询/更新不存在的任务 ID |
| `EMPTY_TASK_TITLE` | 任务标题为空 | 修改任务标题传入空字符串 |
| `UPLOAD_FILE_TOO_LARGE` | 上传文件超出限制 | 超过后端配置的 `max_upload_mb` |
| `UNSUPPORTED_VIDEO_EXTENSION` | 不支持的视频后缀 | 上传或本地路径文件后缀不在白名单 |
| `LOCAL_PATH_NOT_FOUND` | 本地路径不存在 | `create_task_from_path` 参数无效 |

## 配置中心相关

| 错误码 | 含义 | 典型触发场景 |
| --- | --- | --- |
| `PROMPT_TEMPLATE_SELECTION_INVALID` | 提示词模板选择非法 | 选中了不存在模板 ID |
| `PROMPT_TEMPLATE_CREATE_INVALID` | 创建模板失败 | 名称/内容为空或越界 |
| `PROMPT_TEMPLATE_UPDATE_INVALID` | 更新模板失败 | 默认模板被修改、参数非法 |
| `PROMPT_TEMPLATE_DELETE_INVALID` | 删除模板失败 | 删除默认模板或非法模板 |
| `WARMUP_SESSION_NOT_FOUND` | 预热会话不存在 | 查询不存在的 Whisper 预热会话 |
| `RUNTIME_PREPARE_SESSION_NOT_FOUND` | 部署会话不存在 | 查询/终止不存在的部署会话 |

## 运行时与资源相关（SSE/runtime_warning）

下列错误码主要通过 SSE `runtime_warning` 事件或任务失败日志出现：

| 错误码 | 含义 | 典型触发场景 |
| --- | --- | --- |
| `GPU_RUNTIME_REQUIRED` | GPU 运行条件不满足 | 无 `nvidia-smi`、显存不足、CUDA 不可用 |
| `RESOURCE_GUARD_WARNING` | 资源守卫触发告警 | 磁盘空间不足、配置自动回退 |
| `VISUAL_ENRICHMENT_WARNING` | 视觉增强链路告警 | OCR/VLM 模型未就绪或降级 |
| `LLM_API_UNAVAILABLE` | 在线 LLM API 不可用 | key/base_url/model 无效或网络不可达 |
| `LLM_ALL_UNAVAILABLE` | 本地与在线 LLM 全不可用 | 本地推理失败且 API 不可用 |

## 追踪建议

1. HTTP 500 场景：优先记录并检索 `detail.trace_id`。
2. SSE 场景：每条事件包含 `trace_id`，可与后端 `storage/event-logs/<task_id>.jsonl` 对齐定位。
3. 用户反馈场景：建议同时提供 `task_id + trace_id + 时间点`，可显著降低排障时间。
