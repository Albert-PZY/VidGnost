# B 站扫码登录与 AI 字幕接入方案

更新时间：2026-04-23

## 1. 目标

- 在桌面端设置中心增加 `B 站扫码登录`。
- 把登录得到的 Cookie 持久化到本地，失效后提示重新扫码登录。
- 在 `bilibili` 来源下，为当前 `yt-dlp 字幕优先 -> Whisper 回退` 主链路补上一条“已登录 AI 字幕补充通道”。

## 2. 推荐方案

采用 `后端代理扫码登录 + 本地明文 Cookie 仓库 + B 站专用字幕客户端` 的最小增量方案。

这样做的好处：

- 前端不接触原始 Cookie。
- 登录、校验、字幕请求都在后端闭环，便于复用到 Phase `C`。
- 不影响现有 `youtube / local_file / local_path` 逻辑。
- 用户只需“扫码一次，过期再登”，不依赖浏览器 Cookie 导入。

## 3. 当前已验证的 B 站链路

### 3.1 二维码登录接口

已直接验证当前可用：

- 生成二维码：
  - `GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header`
  - 返回 `url + qrcode_key`
- 轮询状态：
  - `GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...&source=main-fe-header`
  - 未完成时返回状态码；二维码失效时会返回 `86038`

### 3.2 AI 字幕获取链路

已知有效路径：

1. `view?bvid=...` 获取 `aid + cid`
2. 带登录态调用 `x/player/wbi/v2?aid=...&cid=...`
3. 从 `data.subtitle.subtitles[*].subtitle_url` 取字幕地址
4. 直接 `GET subtitle_url` 拿字幕 JSON

## 4. 系统设计

### 4.1 设置中心

设置页新增一个独立卡片即可，建议名称：`B 站登录`。

状态：

- `未登录`
- `等待扫码`
- `已登录`
- `已失效`

操作：

- `开始扫码`
- `刷新二维码`
- `重新登录`
- `退出登录`

展示信息：

- 登录状态
- 最近校验时间
- 过期提示
- 可选：昵称 / UID

不建议把它塞进 `UISettings` 通用配置；应作为独立配置模块处理。

### 4.2 后端模块

建议新增：

- `apps/api/src/modules/bilibili/bilibili-auth-repository.ts`
- `apps/api/src/modules/bilibili/bilibili-login-service.ts`
- `apps/api/src/modules/bilibili/bilibili-subtitle-client.ts`
- `apps/api/src/routes/bilibili-auth.ts`

职责拆分：

- `repository`
  - 负责本地持久化、读取、删除登录态
- `login-service`
  - 负责二维码生成、轮询、Cookie 提取、状态校验
- `subtitle-client`
  - 负责 `bvid -> aid/cid -> player -> subtitle_url -> 字幕 JSON`

## 5. API 设计

建议新增以下接口：

### 5.1 登录状态

- `GET /api/config/bilibili-auth`

返回：

- `status`: `missing | pending | active | expired`
- `account`: `{ mid, uname } | null`
- `expires_at`
- `last_validated_at`
- `last_error`

### 5.2 开始扫码

- `POST /api/config/bilibili-auth/qrcode/start`

返回：

- `login_id`
- `qrcode_key`
- `qrcode_url`
- `expires_at`
- `poll_interval_ms`

### 5.3 轮询扫码结果

- `GET /api/config/bilibili-auth/qrcode/poll?login_id=...`

返回：

- `status`: `pending | scanned | confirmed | success | expired | failed`
- `account`
- `expires_at`
- `message`

说明：

- 轮询成功后由后端直接持久化 Cookie
- 前端只拿状态，不拿原始 Cookie

### 5.4 退出登录

- `DELETE /api/config/bilibili-auth/session`

行为：

- 删除本地持久化 Cookie
- 清空内存态

## 6. 本地持久化

建议文件：

- `storage/config/bilibili-auth.json`

建议结构：

```json
{
  "provider": "bilibili",
  "status": "active",
  "cookie_names": ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"],
  "cookies": {
    "SESSDATA": "xxx",
    "bili_jct": "xxx",
    "DedeUserID": "xxx",
    "DedeUserID__ckMd5": "xxx",
    "sid": "xxx"
  },
  "account": {
    "mid": "123456",
    "uname": "example"
  },
  "created_at": "2026-04-23T10:00:00.000Z",
  "updated_at": "2026-04-23T10:00:00.000Z",
  "last_validated_at": "2026-04-23T10:00:00.000Z",
  "expires_at": "2026-05-23T10:00:00.000Z",
  "last_error": null
}
```

建议只保留白名单 Cookie，不保存无关项，不做额外加密。

## 7. 安全策略

- 原始 Cookie 不返回前端。
- 原始 Cookie 不写日志、不写事件流、不写任务工件。
- 本地仅保存在后端配置文件中，前端只看登录状态。
- 明文存储即可，但文件应限制在 `storage/config/`，并继续保持 `.gitignore` 排除。
- `退出登录` 必须删除持久化文件。

## 8. 字幕链路接入方式

推荐接入顺序：

1. 先走现有 `yt-dlp` 公共平台字幕探测
2. 若来源是 `bilibili` 且公共字幕不可用，再尝试 `B 站登录态 AI 字幕`
3. 再失败，回退现有 Whisper / 远程 ASR

原因：

- 保持现有主链路稳定
- 登录态只作为增强能力，不把公开可拿的字幕也强行绑到登录上
- 改动最小

### 8.1 B 站 AI 字幕解析步骤

在 `source_type=bilibili` 且存在有效登录态时：

1. 从 URL 解析 `bvid`
2. 调 `view` 接口获取 `aid + cid`
3. 带 Cookie 调 `x/player/wbi/v2?aid=...&cid=...`
4. 读取 `data.subtitle.subtitles`
5. 选中最合适的字幕轨
6. 请求 `subtitle_url`
7. 转成现有 `TranscriptSegment[]`
8. 继续写入当前统一工件合同

建议保留原始工件：

- `C/platform-subtitles/bilibili-auth-raw.json`
- `C/platform-subtitles/selected-track.json`

`selected-track.json` 中新增一个来源标记即可：

```json
{
  "source": "bilibili-auth"
}
```

## 9. 失效与重登

不做复杂刷新，只做“发现失效 -> 标记失效 -> 引导重登”。

触发失效的条件：

- 二维码轮询返回过期
- 登录态校验失败
- 调用 B 站字幕接口返回未登录 / 权限失效

处理原则：

- 后端把状态标记为 `expired`
- 前端设置页显示 `登录已失效，请重新扫码`
- 字幕链路自动回退到现有 `yt-dlp / Whisper`

## 10. 建议的实现边界

第一阶段只做：

- 设置页扫码登录
- Cookie 本地持久化
- B 站 AI 字幕补充通道
- 失效重登

先不做：

- 浏览器 Cookie 自动导入
- 多账号切换
- 登录态自动刷新
- 与其他站点共用账号系统

## 11. 涉及文件

建议优先改这些位置：

- `apps/desktop/src/components/views/settings-view.tsx`
- `apps/desktop/src/lib/api.ts`
- `packages/contracts/src/config.ts`
- `apps/api/src/routes/config.ts` 或新增 `apps/api/src/routes/bilibili-auth.ts`
- `apps/api/src/modules/bilibili/*`
- `apps/api/src/modules/asr/platform-subtitle-transcript-service.ts`

## 12. 一句话结论

最优落地方式不是“继续找浏览器 Cookie”，而是把 `B 站扫码登录` 做成设置中心的一个正式能力，让后端持久化并复用登录态；字幕链路上保持 `yt-dlp 公共字幕优先，B 站登录态 AI 字幕补充，Whisper 兜底`，这样风险最低、收益最高、实现也最干净。
