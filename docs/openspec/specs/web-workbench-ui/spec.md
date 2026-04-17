## ADDED Requirements

### Requirement: Electron workbench SHALL render a fixed shell with isolated scroll regions
The Electron renderer SHALL present a fixed top title bar, a left navigation sidebar, and a main content region. Scrollbars SHALL be confined to content regions below the title bar.

#### Scenario: Scroll a long settings page
- **WHEN** content height exceeds the viewport
- **THEN** the title bar remains sticky at the top
- **AND** the scrollbar appears only inside the page content region beneath the title bar

#### Scenario: Highlight current recent task and workflow selection in the shell
- **WHEN** the user opens the sidebar workflow menu or opens a task from the recent-task list
- **THEN** the currently selected workflow option uses an explicit filled selected state instead of relying only on subtle hover contrast
- **AND** the active recent-task entry uses an explicit selected state in the sidebar
- **AND** recent-task rows include compact workflow and video-duration context when that duration is available

### Requirement: Settings center SHALL provide frontend-driven configuration sections
Settings center SHALL provide `模型配置`, `提示词模板`, `外观设置`, and `语言设置` sections backed by persisted backend data.

#### Scenario: Open settings center
- **WHEN** user opens settings from the application shell
- **THEN** the renderer shows the four sections with current persisted values from backend config APIs

#### Scenario: Hydrate settings center through HTTP JSON config endpoints
- **WHEN** renderer mounts the settings center during the frontend-driven backend transition
- **THEN** it loads `模型配置` data from `/config/models`、`/config/whisper`、`/config/llm`、`/config/ollama`
- **AND** it loads `提示词模板` data from `/config/prompts`
- **AND** all settings requests use the shared HTTP JSON API contract rather than an Electron-only transport bridge

#### Scenario: Persist appearance and language changes from settings center
- **WHEN** user updates theme hue, font size, autosave, background skin, or UI language inside settings
- **THEN** renderer saves the patch through `/config/ui`
- **AND** backend returns the normalized persisted UI settings snapshot used by the renderer shell

#### Scenario: Manage prompt templates from settings center
- **WHEN** user creates, edits, deletes, or switches a prompt template in settings
- **THEN** renderer uses `/config/prompts/templates` and `/config/prompts/selection`
- **AND** backend returns the refreshed template bundle including channel selection and effective template lists

### Requirement: Whisper model configuration SHALL expose GPU readiness controls without implying managed install
The settings-center Whisper model dialog SHALL expose the current GPU-readiness summary, configured path hints, and a GPU mode toggle while keeping the backend contract aligned with the current runtime contract.

#### Scenario: Configure Whisper GPU readiness from settings
- **WHEN** user opens `whisper-default` 的模型配置
- **THEN** the renderer shows a `Whisper GPU 加速` section with readiness summary, configured `whisper-cli` / model path hints, and environment-sync state
- **AND** the user-facing copy explains that the current acceleration target is the transcription chain
- **AND** the section allows toggling Whisper GPU mode and refreshing runtime detection
- **AND** the readiness copy only promises probe results based on executable and model-path availability, not CUDA runtime-bundle DLL validation or a managed runtime install flow
- **AND** current UI contract does not require a managed runtime install, pause, or resume workflow before the dialog can be used

### Requirement: Settings center SHALL expose Ollama runtime and model migration controls
The settings-center model surface SHALL expose dedicated `Ollama 运行时与模型目录` and `本地模型批量迁移` cards so users can control Ollama installation paths, model-storage paths, service address, and manual migration guidance for existing local model files.

#### Scenario: Configure Ollama runtime from settings
- **WHEN** user opens settings and visits `模型配置`
- **THEN** the renderer shows a compact `Ollama 运行时` summary card
- **AND** the card exposes a `配置` action that opens a dialog with `安装目录`、`可执行文件`、`模型安装目录`、`服务地址` fields
- **AND** the dialog allows opening native directory pickers for install and model directories
- **AND** the card keeps `启动/重启` action separate from the dialog save action
- **AND** the same card shows current Ollama service reachability, whether a local process was detected, the configured model directory, the latest config or probe snapshot, and a backend-supplied status message
- **AND** the card states that the configured model directory is the desired target for later manual migration or manual pull guidance rather than a guaranteed reflection of the running service
- **AND** when backend reports `can_self_restart=false`, renderer surfaces the probe-only status instead of implying that restart is already self-managed

#### Scenario: Prompt manual pull after Ollama model migration
- **WHEN** user clicks an Ollama model pull guidance action after model files have already been moved into the configured directory
- **THEN** renderer surfaces the backend status or guidance message instead of always showing a generic `已开始通过 Ollama 安装模型`
- **AND** if backend reports that the running Ollama service may still be using another directory, the toast tells the user to start or restart Ollama manually rather than implying a managed pull or duplicate install

#### Scenario: Batch migrate local-directory model entries from settings
- **WHEN** user opens the local-model migration config dialog, reviews the configured local model list, enters a target root directory, and starts migration
- **THEN** the renderer submits the backend migration request and refreshes the model list after completion
- **AND** the dialog only supports submitting the shared migration action for all configured local models together
- **AND** renderer surfaces backend `message` and `warnings` directly, including placeholder responses where no files were moved
- **AND** renderer treats migration results as file-operation feedback only and prompts for manual restart or manual verification when the backend does not explicitly report a runtime outcome

#### Scenario: Model list data is still loading
- **WHEN** the settings view has entered `模型配置` but the backend model list has not yet returned
- **THEN** the renderer shows skeleton rows in the model list region
- **AND** the skeleton placeholders use the shared neutral loading surface instead of a theme-hue accented variant
- **AND** it does not flash an empty-state card before the first model payload arrives

### Requirement: Configuration dialogs SHALL stay within viewport with fixed chrome
Model configuration and prompt-template configuration dialogs SHALL remain within the visible viewport, keep header and action area fixed, and allow inner content scrolling when fields exceed available height. The header chrome SHALL stay visually compact so the main form area remains the dominant surface inside the dialog.

#### Scenario: Open a long configuration dialog
- **WHEN** dialog content exceeds available viewport height
- **THEN** the dialog body becomes scrollable
- **AND** the title, close control, cancel action, and save action remain visible

### Requirement: Model configuration dialog SHALL separate overview and grouped controls
Model configuration dialog SHALL use a responsive split layout with a left overview panel and a right grouped form panel. On desktop widths the dialog SHALL keep a wide presentation area suitable for dense professional forms, supporting a visual width up to `85rem`, and SHALL not fall back to the default small dialog width token. The overview panel SHALL keep a fixed readable width while the right-side configuration panel stays intentionally narrower than the previous ultra-wide layout. The overview panel SHALL expose model identity, component tag, provider, runtime status, install status, default path, current enabled state, and preset note, while keeping helper copy concise. The right-side grouped form panel SHALL adapt its visible fields to the selected provider and component capabilities, including dedicated online-API controls for image-capable entries. Dialog centering SHALL preserve crisp text rendering and SHALL not distort embedded fixed-position surfaces.

#### Scenario: Open a model configuration dialog
- **WHEN** user clicks `配置` on a model item
- **THEN** the dialog shows a compact overview panel for model identity and state on the left
- **AND** the right side groups editable runtime parameters into dedicated cards
- **AND** path fields span the full row while regular scalar fields follow a responsive two-column grid

#### Scenario: Switch provider inside a model configuration dialog
- **WHEN** user changes a model entry between `本地目录`、`Ollama`、`在线 API`
- **THEN** the dialog updates the visible fields to match that route instead of showing one generic mixed form
- **AND** `在线 API` shows Base URL、API Key、模型名、协议和超时 fields for the current component
- **AND** `本地目录` and `Ollama` routes keep model path or logical model-id controls visible while hiding remote-only fields

#### Scenario: Open the `llm-default` configuration dialog
- **WHEN** user configures `llm-default`
- **THEN** the dialog keeps `文本纠错设置` grouped inside the same model configuration surface regardless of whether the current provider is `Ollama` or `在线 API`
- **AND** saving LLM provider changes does not require leaving the model dialog to update transcript-correction settings

#### Scenario: Recover unsaved model-dialog draft after renderer reload
- **WHEN** user edits a model configuration dialog and the renderer reloads before the user saves
- **THEN** reopening the same model restores the locally cached unsaved form draft for that model
- **AND** an explicit successful save or explicit dialog close clears that local draft

### Requirement: Prompt template UI SHALL distinguish channels visually
Prompt template list and editor SHALL use channel-specific labels for `correction`, `notes`, `mindmap`, and `vqa`, while avoiding duplicated explanatory copy inside the editor sidebar.

#### Scenario: Browse prompt templates
- **WHEN** user opens the prompt template section
- **THEN** each template card shows the channel label and a distinct icon marker
- **AND** the editor dialog reflects the currently selected channel visually
- **AND** system default templates expose a read-only inspect action instead of edit and delete actions

### Requirement: Prompt template editor SHALL provide split markdown editing with live preview
Prompt template editor SHALL use a markdown editor that keeps the source editor and rendered preview visible at the same time. The editor theme SHALL follow the application light/dark theme, editor-side scrolling SHALL remain synchronized with the preview pane during editing, and helper text above the editor SHALL stay concise without repeating nearby labels.

#### Scenario: Edit a prompt template in the settings center
- **WHEN** user opens the prompt template editor dialog
- **THEN** the dialog shows a markdown editor with source editing on the left and live rendered preview on the right
- **AND** the editor applies the same light or dark color mode as the renderer shell
- **AND** scrolling one pane keeps the other pane aligned for long prompt content

#### Scenario: View a default prompt template in the settings center
- **WHEN** user opens a system default prompt template from the prompt-template list
- **THEN** the dialog reuses the markdown editor with the template content already populated
- **AND** the source pane remains read-only while the preview pane keeps live rendered output visible
- **AND** the dialog omits editable form fields and extra helper copy unrelated to reading the template body

### Requirement: Workbench notes editor SHALL prefer a wide split layout
The task-workbench Markdown notes editor dialog SHALL use a wide split layout that prioritizes side-by-side editing and preview over vertical height. On desktop widths, the dialog SHALL expand toward a wide landscape presentation instead of a tall narrow panel, and the editor viewport SHALL stay visually compact enough to avoid pushing the action area below the fold.

#### Scenario: Open the Markdown notes editor from the task workbench
- **WHEN** user opens `编辑 Markdown 笔记`
- **THEN** the dialog uses a wide landscape layout suited for side-by-side source and preview panes
- **AND** the dialog reuses the same bounded desktop width contract as the prompt-template configuration dialog, with a maximum visual width around `88rem`
- **AND** desktop responsive breakpoints keep that wide layout instead of falling back to the generic small dialog max-width token
- **AND** the wide layout stays bounded rather than expanding to an oversized ultra-wide sheet on desktop
- **AND** the header and footer chrome stay compact and omit redundant helper copy so the editor keeps the dominant share of vertical space
- **AND** the editor viewport height remains intentionally lower than the previous tall layout so the dialog reads as a compact work surface instead of a vertically stretched sheet
- **AND** in light theme with a custom skin active, the source editor pane keeps readable light foreground text instead of falling back to low-contrast overlay token colors
- **AND** task-relative Markdown images such as `notes-images/...` are resolved through the current task artifact file endpoint so generated note images remain visible inside the live preview
- **AND** preview-side Markdown decoration such as task-relative image resolution and timestamp link rewriting runs through a background preprocessing path so typing stays responsive
- **AND** Mermaid preview blocks wait until they enter the visible preview area before starting expensive rendering work and reuse cached SVG output when the same diagram appears again
- **AND** the edit dialog preview uses the same Markdown enhancement contract as the read-only notes workspace so timestamps, task-relative images, tables, and Mermaid blocks stay behaviorally consistent across both surfaces

### Requirement: Desktop startup SHALL preload core workbench views before main window reveal
Electron desktop startup SHALL open a dedicated splash window first, keep the main window hidden while renderer assets and core workbench views initialize, and reveal the main window only after bootstrap completes or enters degraded mode. Core workbench views such as `新建任务`, `历史记录`, `设置中心`, `系统自检`, `任务处理`, and the prompt-template Markdown editor SHALL be included in the initial renderer startup path instead of route-level or dialog-level lazy loading placeholders. The splash surface SHALL follow the same restrained professional dark-tool styling as the renderer shell, using the project logo, a centered vertical brand composition, a single thin progress bar, and a five-step startup checklist with per-step elapsed-time feedback. The checklist SHALL be bound to explicit startup task states emitted by the hidden main window and renderer instead of inferring stages from display copy. The dedicated splash window SHALL keep a compact fixed footprint around `420 x 480` logical pixels so the launch surface reads as a concise startup panel instead of a large poster-like frame.

#### Scenario: Launch the Electron workbench
- **WHEN** user opens the desktop application
- **THEN** a standalone splash surface appears immediately with the project brand image and startup progress copy
- **AND** the splash surface keeps a compact professional layout with restrained dark surfaces and no decorative glow, scanline, floating ornament, or card-heavy dashboard treatment
- **AND** the splash surface centers the project logo, product name, and product subtitle above the startup progress region
- **AND** the startup progress region presents a thin progress bar plus the ordered checklist `加载前端资源` → `连接本地服务` → `同步任务概览` → `同步界面配置` → `稳定首帧并挂载 UI`
- **AND** completed checklist items show elapsed-time feedback while the active item shows a loading affordance instead of repeating large paragraphs of copy
- **AND** the splash progress percentage is derived from the count of completed explicit startup steps rather than heuristic text matching
- **AND** each checklist step is promoted to `active`, `complete`, or `error` only when the corresponding renderer or main-process startup task actually changes state
- **AND** the hidden main window continues loading renderer assets, core workbench views, and initial UI data in the background
- **AND** the main window is revealed only after startup bootstrap reports completion or explicitly enters degraded mode
- **AND** no page-level or prompt-editor skeleton placeholder is shown as part of the initial desktop startup chain

#### Scenario: Bootstrap script enforces fixed service ports
- **WHEN** the Windows or shell startup script launches the local desktop workbench
- **THEN** the backend process binds only to `8666` and the frontend dev server binds only to `6221`
- **AND** the script attempts to reclaim those fixed ports before startup
- **AND** startup stops with a clear port-availability failure if either fixed port still cannot be bound
- **AND** the spawned frontend or Electron process receives matching `VITE_API_BASE_URL` and `VITE_DEV_SERVER_URL` values for the fixed ports
- **AND** the Windows launcher preserves quoted child-console bootstrap commands so frontend wait chains that contain shell operators such as `&&` stay compatible with Windows PowerShell 5.1

### Requirement: Workspace maintenance scripts SHALL clear local transient artifacts safely
Repository maintenance scripts SHALL provide Windows and shell entry points that remove local transient logs, build outputs, and cache directories without touching persisted runtime data.

#### Scenario: Run workspace cleanup script
- **WHEN** maintainer executes `scripts/clean-workspace.ps1` or `scripts/clean-workspace.sh`
- **THEN** root-level transient `.log` files, desktop build output, and local cache directories such as `apps/api/dist`, `apps/api/coverage`, `apps/desktop/.vite`, and `apps/desktop/node_modules/.vite` are removed
- **AND** persisted runtime data under `storage/` remains untouched

### Requirement: Workbench SHALL surface transient notifications through a compact toast stack
Renderer SHALL present transient `success`, `error`, and `loading` feedback through a single top-centered toast stack. The stack SHALL keep at most three visible notifications and SHALL retire older visible items when newer notifications overflow the cap.

#### Scenario: Trigger multiple transient notifications in quick succession
- **WHEN** renderer emits more than three transient notifications before earlier ones disappear
- **THEN** the notifications appear in a top-centered stack using the shared workbench toast surface
- **AND** only the three newest visible notifications remain on screen
- **AND** each newly shown visible notification triggers one playback attempt of the bundled `toast.mp3` sound effect

### Requirement: Appearance settings SHALL persist theme hue, font size, autosave, and custom skin state
UI settings SHALL persist `theme_hue`, `font_size`, `auto_save`, `background_image`, `background_image_opacity`, `background_image_blur`, `background_image_scale`, `background_image_focus_x`, `background_image_focus_y`, and `background_image_fill_mode`, and the renderer SHALL apply them immediately to the active shell through a dedicated fixed background layer.

#### Scenario: Adjust theme hue
- **WHEN** user changes theme hue from the appearance section and saves it
- **THEN** title bar, sidebar, and primary emphasis colors update from the persisted hue setting
- **AND** the hue section keeps only essential directional labels without extra explanatory taglines
- **AND** the same hue is restored after application restart

#### Scenario: Adjust font size
- **WHEN** user changes interface font size and saves it
- **THEN** renderer applies the new root font size immediately and restores it on next launch

#### Scenario: Configure a custom skin image
- **WHEN** user chooses a skin image from the Electron shell and opens the skin dialog
- **THEN** the renderer shows a compact single-column skin dialog with a fixed selection frame and wheel-driven zoom
- **AND** dragging inside the selection frame moves the image behind the frame instead of moving or resizing the frame itself
- **AND** the live shell preview uses a short eased transition while the user drags the frame, changes image scale, or adjusts image opacity, unless reduced-motion is requested
- **AND** adjusting blur only changes blur intensity and SHALL NOT alter the saved image scale or focus position
- **AND** increasing blur SHALL NOT crop the bottom edge of the sampled image or shift the sampled frame vertically
- **AND** blur rendering in the dialog preview uses an offscreen WebGL pipeline that keeps the image layout fixed instead of inflating the image bounds to hide blur edges
- **AND** the blur pipeline duplicates edge samples at the image boundary so higher blur values do not reveal transparent or empty borders
- **AND** the dialog preview only displays the original image rect and SHALL NOT expose duplicated edge-fill strips outside that rect
- **AND** the helper copy tells the user to place the pointer on the image to drag the image position
- **AND** surrounding appearance cards keep helper copy minimal and avoid repeating nearby controls or status labels
- **AND** the selection frame stays fully inside the currently rendered image bounds, including at the minimum persisted `100%` scale
- **AND** the current shell background updates in real time while the dialog is open
- **AND** brief drag, zoom, opacity, or blur bursts from the dialog coalesce before they reach the shell background layer so each preview fade can complete without being restarted on every pointer frame
- **AND** the shell background layer starts each crossfade only after the incoming preview layer has produced its first rendered frame, so the user sees an actual fade instead of a direct visual swap
- **AND** when the runtime reports reduced motion, the shell background layer MAY shorten this crossfade but SHALL keep a lightweight opacity fade for skin preview swaps so the preview does not visually snap between frames
- **AND** higher blur values MAY reduce the internal offscreen blur resolution to preserve interactive smoothness while keeping the saved scale, focus, and output frame unchanged
- **AND** the primary save action follows the active UI theme hue instead of using a fixed accent color
- **AND** saving the dialog persists opacity, blur, scale, and focus coordinates for the selected image

#### Scenario: Restore a saved custom skin
- **WHEN** renderer loads with persisted skin settings
- **THEN** the fixed shell background layer restores the saved image using the stored opacity, blur, scale, and focus coordinates
- **AND** the fixed shell background layer applies skin blur through the same offscreen WebGL pipeline used by the skin dialog preview
- **AND** the appearance settings skin status preview reuses the stored scale and focus coordinates when rendering its blurred preview surface
- **AND** the appearance settings skin status preview becomes visible as soon as the appearance section enters view and has a measurable preview surface
- **AND** the appearance settings skin status preview keeps its helper and status strip docked flush to the bottom edge of the preview frame without exposing a visual gap below the strip
- **AND** the title bar, sidebar, and main content shell render above the same background layer
- **AND** cards, dialogs, popovers, and the left sidebar switch to translucent glass surfaces while the custom skin is active
- **AND** shell text outside card surfaces uses high-contrast light text with a soft shadow while the custom skin is active
- **AND** in light theme with a custom skin active, visible white borders on glass cards and shell surfaces are suppressed in favor of transparent edges and shadow separation
- **AND** in light theme with a custom skin active, card content text renders in high-contrast light text instead of default dark foreground tokens
- **AND** in light theme with a custom skin active, white or near-white interactive fills used by buttons, hover states, and label chips shift to theme-hue fills when they render light text
- **AND** in light theme with a custom skin active, workflow step markers and upload placeholder icon shells avoid white fills and use the active theme hue family instead
- **AND** in light theme with a custom skin active, dense model-management panels and their dividers use softened translucent separators instead of hard rectangular border strokes
- **AND** in light theme with a custom skin active, settings-center section tabs keep a transparent resting state and only shift to the theme-hue fill on hover, focus, or active selection
- **AND** in light theme with a custom skin active, prompt-template preview blocks avoid neutral white fills and instead use a softened theme-hue translucent preview surface
- **AND** in light theme with a custom skin active, appearance-setting action buttons and hue chips suppress visible outline strokes and rely on translucent surfaces plus theme-hue hover feedback
- **AND** in light theme with a custom skin active, titlebar controls keep a neutral resting surface while the sidebar workflow trigger uses a glass resting surface and both only add emphasis on hover, focus, or open state
- **AND** in light theme with a custom skin active, history overview icon shells use the active theme hue family while preserving each icon glyph color
- **AND** in light theme with a custom skin active, the application-close confirmation dialog uses a denser frosted light surface with white foreground text
- **AND** in light theme with a custom skin active, diagnostics check-list icon shells use the active theme hue family and keep the inner icon glyphs white
- **AND** in light theme with a custom skin active, model-configuration and prompt-template dialogs reuse the custom-skin dialog's deep glass surface, preserve light foreground text, suppress hard borders, use thinner themed scrollbars, and keep header/footer chrome visually compact
- **AND** in light theme with a custom skin active, the prompt-template Markdown editor preview SHALL NOT fall back to the library default white canvas and instead keeps a tinted dark translucent reading surface with readable light foreground text
- **AND** in light theme with a custom skin active, the prompt-template Markdown editor input pane and preview pane use the same thin themed scrollbar styling
- **AND** in light theme with a custom skin active, the notes-workbench Markdown editor input pane also keeps readable light source text and SHALL NOT render invisible overlay tokens
- **AND** sidebar separators stay clipped to the sidebar content width in every theme and SHALL NOT visually protrude past the container edge
- **AND** in light theme with a custom skin active, generic select and dropdown controls across the workbench keep white foreground text and icons by default and SHALL NOT fall back to dark typography inside glass popup surfaces
- **AND** in light theme with a custom skin active, new-task intake mode tabs and intake panels use theme-hue translucent fills with white foreground text and explicit hover or active emphasis
- **AND** in light theme with a custom skin active, selected upload-file rows use the active theme hue family for their video icon shells while keeping the glyphs readable
- **AND** in light theme with a custom skin active, history pagination controls keep white foreground text
- **AND** in light theme with a custom skin active, sidebar section labels, navigation text, and recent-task labels keep high-contrast white foreground text in their resting state
- **AND** in light theme with a custom skin active, history-view `查看` plus workbench `编辑笔记` / `导出 Markdown` / `导出结果包` actions use theme-hue filled resting surfaces with white label text
- **AND** in light theme with a custom skin active, the diagnostics `自动修复` action keeps white foreground text and icon color in resting, hover, focus, and disabled states
- **AND** in light theme with a custom skin active, titlebar language/theme menus and the sidebar workflow menu use the shared glass dropdown surface, default to white text/icons, and express selected or hover state via neutral glass emphasis instead of theme-cyan fills
- **AND** in light theme with a custom skin active, titlebar language/theme menu items and sidebar workflow options keep a neutral resting state and SHALL NOT inherit global accent background fills outside their explicit local hover, focus, highlight, or selected glass states
- **AND** in dark theme with a custom skin active, tooltip surfaces switch to a light floating background with dark readable text so icon-only helper text remains legible over the darker shell
- **AND** in light theme with a custom skin active, prompt-template list cards suppress hard white outline strokes in favor of translucent surface separation
- **AND** the workspace shell does not add extra renderer-side blur or tint beyond the persisted skin blur and opacity values
- **AND** wallpaper preview, blur, and transient feedback surfaces coalesce live renderer refreshes to frame cadence and release temporary GPU or audio resources when they close so long-running Electron sessions remain smooth

### Requirement: Shell controls SHALL expose explicit language selection state
Header language controls SHALL show the current selected language with explicit selected-state feedback and persist the language choice through UI settings.

#### Scenario: Open header language menu
- **WHEN** user opens the language menu in the title bar
- **THEN** the active language option is visually highlighted
- **AND** pointing to the title-bar language trigger opens the dropdown without requiring an extra click, while click and focus access remain available
- **AND** changing the option updates persisted UI settings

### Requirement: Shell controls SHALL expose explicit theme selection state
Header theme controls SHALL show the current selected theme mode with explicit selected-state feedback for `light`, `dark`, and `system`.

#### Scenario: Open header theme menu
- **WHEN** user opens the theme menu in the title bar
- **THEN** the active theme option is visually highlighted
- **AND** pointing to the title-bar theme trigger opens the dropdown without requiring an extra click, while click and focus access remain available
- **AND** only the selected theme option shows the explicit selection indicator

### Requirement: Workbench branding SHALL use the project logo asset
Renderer branding surfaces, desktop splash branding, and favicon SHALL use `apps/desktop/public/icon.svg` as the canonical project logo asset. The desktop package MAY include a synchronized raster companion asset at `apps/desktop/public/icon.png` for runtime or distribution compatibility, and branding assets SHALL NOT depend on a separate legacy light-icon file.

#### Scenario: Open application shell
- **WHEN** application renderer loads
- **THEN** the desktop splash surface and sidebar branding use the project logo
- **AND** browser/electron renderer favicon resolves to the same logo asset
- **AND** any packaged raster companion icon stays visually aligned with the canonical SVG branding

### Requirement: Renderer SHALL consume backend data through plain HTTP APIs
Frontend SHALL only render backend-provided data and call the TypeScript backend over HTTP APIs. Electron bridge SHALL be limited to desktop shell integrations such as open path, open external link, image-file selection, startup progress handoff between splash and main windows, and window controls.

#### Scenario: Load the workbench in Electron
- **WHEN** renderer starts inside Electron
- **THEN** data requests go through the backend HTTP API
- **AND** Electron preload APIs are used only for desktop shell interactions
- **AND** startup progress and completion handoff between the hidden main window and the splash surface stays inside the Electron shell bridge instead of changing backend transport contracts

#### Scenario: Bootstrap requests backend readiness and runtime paths
- **WHEN** renderer enters bootstrap synchronization
- **THEN** it requests `/health` first to confirm backend readiness before overview and configuration synchronization continue
- **AND** it requests `/runtime/paths` through plain HTTP JSON during configuration synchronization instead of introducing a custom desktop-only transport
- **AND** the runtime paths payload exposes `storage_dir`, `event_log_dir`, and `trace_log_dir` so degraded recovery surfaces can resolve a log directory target

#### Scenario: Pick a skin image from Electron
- **WHEN** user clicks the skin selection button in appearance settings inside Electron
- **THEN** Electron opens the native file picker for image files
- **AND** the renderer receives the selected image payload through the preload bridge without changing the backend transport model

#### Scenario: Pick an Ollama or model directory from Electron
- **WHEN** user clicks an Ollama install-directory, model-directory, or similar browse action inside settings
- **THEN** Electron opens the native directory picker
- **AND** the renderer receives the selected absolute directory path through the preload bridge without changing backend transport contracts

### Requirement: Diagnostics view SHALL present runtime metrics as a compact live strip
Diagnostics view SHALL render runtime metrics in a single compact strip that exposes `uptime_seconds`, `cpu_percent`, `memory_used_bytes`, `memory_total_bytes`, `gpu_percent`, `gpu_memory_used_bytes`, `gpu_memory_total_bytes`, and `sampled_at` from the backend runtime metrics API without nested metric cards.

#### Scenario: Open diagnostics view after runtime metrics load
- **WHEN** the renderer requests `/runtime/metrics`
- **THEN** the diagnostics page shows a compact runtime strip with uptime, CPU, memory, and GPU summaries
- **AND** the strip shows the latest sample timestamp
- **AND** memory and GPU rows expose usage detail without expanding into secondary cards
- **AND** byte-derived capacity values use `MB` as the minimum display unit while values that already reach `GB` or `TB` remain in those larger units

### Requirement: New-task view SHALL expose multi-source intake with value preview
New-task view SHALL expose `Upload`, `URL`, and `Path` intake modes inside the same workbench surface and SHALL show workflow-specific value preview blocks before the user starts analysis.

#### Scenario: Open new-task view for notes workflow
- **WHEN** user enters the new-task view with workflow `notes`
- **THEN** the renderer shows responsive workflow step cards without horizontal scrolling, a value-preview summary, and the three intake modes
- **AND** workflow-step and value-preview content keep a compact flat structure inside the surrounding shell cards instead of reintroducing nested heavyweight sub-cards
- **AND** the upload mode supports drag-and-drop plus batch file selection
- **AND** upload selection, drag-and-drop intake, and absolute local-path entry only accept `MP4`、`MOV`、`AVI`、`MKV` video inputs
- **AND** the renderer blocks other file extensions before request submission instead of relying only on backend rejection
- **AND** selected local video files attempt to read media duration from local metadata and show the detected duration when the browser can resolve it
- **AND** upload helper copy keeps a higher-contrast foreground treatment in dark theme so the prompt remains readable during idle and importing states
- **AND** the user can switch to URL or absolute local-path input without leaving the page

### Requirement: History view SHALL keep compact overview and batch-delete controls
History view SHALL present a compact summary strip and a flat batch-delete toolbar that preserve quick task access while reducing unnecessary visual chrome.

#### Scenario: Open history view with no persisted tasks
- **WHEN** user opens `历史记录` before any task has been created
- **THEN** the `批量删除` entry action is visibly disabled
- **AND** the disabled presentation follows the same affordance family used by the history pagination controls

#### Scenario: Enter batch-delete mode from history view
- **WHEN** user clicks `批量删除` in history view while tasks are available
- **THEN** the renderer enters selection mode for every task shown on the current page
- **AND** the toolbar keeps a compact flat presentation while exposing `全选本页`、`退出选择`、`删除已选` actions

#### Scenario: Delete a single task from history view
- **WHEN** user confirms deleting one task from the history row action menu
- **THEN** the renderer submits `DELETE /tasks/{task_id}` without a request body
- **AND** the shared HTTP client does not attach `Content-Type: application/json` to that bodyless delete request
- **AND** after backend deletion succeeds, the history list, summary counts, and recent-task surfaces refresh against the latest backend snapshot

### Requirement: Bootstrap surfaces SHALL provide startup progress and backend recovery actions
Workbench bootstrap SHALL expose a desktop splash progress state before the main window reveal and a renderer overlay state machine for `initializing`, `connecting`, `degraded`, and `ready` after the main window becomes visible. Initializing states SHALL keep an explicit loading affordance, while degraded states SHALL switch to a non-blocking recovery panel.

#### Scenario: Renderer is still initializing after main window reveal
- **WHEN** renderer has entered `initializing` or `connecting` and is still waiting for backend health or first configuration payloads
- **THEN** the startup surface keeps a blocking overlay over the main workbench
- **AND** the overlay shows an animated loading affordance together with the current phase message
- **AND** the overlay does not render disabled recovery buttons before log paths or degraded actions become actionable

#### Scenario: Backend is unavailable during bootstrap
- **WHEN** renderer cannot complete initial health/config synchronization
- **THEN** the desktop splash completes the startup handoff and the main window opens in degraded mode
- **AND** the desktop splash marks the failing explicit startup step as `error` instead of fabricating a fully completed progress bar
- **AND** a non-blocking recovery panel explains that the backend is unavailable without locking the whole workbench
- **AND** the panel provides `重试连接` and `查看诊断` actions
- **AND** `打开日志目录` is shown only when the renderer has a current or cached runtime log path
- **AND** the user can switch to `系统自检` while the degraded recovery panel remains available
- **AND** the panel is dismissed automatically once bootstrap reaches `ready`

#### Scenario: Runtime paths enable degraded log actions
- **WHEN** bootstrap has resolved `/runtime/paths`
- **THEN** the renderer caches `event_log_dir` and `trace_log_dir` as the preferred degraded recovery targets for `打开日志目录`
- **AND** the degraded recovery panel keeps the log action unavailable until at least one runtime log path has been resolved

### Requirement: Task processing workbench SHALL provide a resizable evidence-driven workspace
Task processing workbench SHALL use a horizontal resizable split layout. For notes tasks, the left workspace SHALL provide `转写片段`, `文本纠错`, `证据时间轴`, and `阶段输出` tabs. For VQA tasks, the left workspace SHALL provide `转写片段`, `证据时间轴`, `阶段输出`, and a conditional `文本纠错` tab whenever transcript correction is enabled for that task. The right workspace SHALL switch between `Markdown 工作区 / 思维导图` for notes tasks and `流式问答 / Trace Theater` for VQA tasks.

#### Scenario: Open a completed notes task
- **WHEN** user opens a notes task in the processing workbench
- **THEN** the renderer shows the resizable video-and-artifact layout
- **AND** the left workspace exposes an additional `文本纠错` tab dedicated to transcript correction output
- **AND** left and right workspace tab bars use a clear filled selected state instead of relying only on a thin bottom border
- **AND** the Markdown workspace renders a single notes Markdown surface instead of duplicating equivalent summary content beside it
- **AND** the Markdown workspace wraps that notes surface inside a dedicated reading panel with a compact darker action header and a continuous reading body so wallpaper imagery stays atmospheric instead of competing with note readability
- **AND** Markdown timestamps can seek the video
- **AND** the Markdown workspace keeps an inner vertical scrollbar so long notes remain scrollable without moving the outer workbench shell
- **AND** the read-only notes workspace uses the same Markdown enhancement contract as the edit-dialog preview so timestamp links, task-relative images, and Mermaid blocks stay consistent before and after editing
- **AND** when the right workspace is resized narrow, Markdown, mindmap, and VQA panes reflow their tab chrome, actions, cards, and dense content within the available pane width instead of clipping the reading surface
- **AND** entering note-edit mode opens a dedicated Markdown dialog with source editing on the left and live rendered preview on the right
- **AND** in light theme with a custom skin active, the notes workspace tabs, action row, rendered Markdown, and empty states keep readable white foreground text
- **AND** in light theme with a custom skin active, the left-side workbench tab labels also keep readable white foreground text in resting state and use theme-hue filled emphasis in their selected state
- **AND** in light theme with a custom skin active, the notes reading panel uses theme-hue tinted translucent fills instead of near-black slabs so it remains consistent with the lighter wallpaper atmosphere
- **AND** transcript cards render a precise timestamp chip at the top, keep only icon actions on the trailing edge, and expose action meaning through hover tooltips
- **AND** in light theme with a custom skin active, transcript cards and correction surfaces keep white foreground text while timestamp chips and quick-action icons remain readable against the glass surface
- **AND** transcript cards support workflow-specific quick actions such as `加入笔记草稿` for notes tasks and `设为问答问题` for VQA tasks
- **AND** in light theme with a custom skin active, evidence-timeline seek buttons use the active theme hue family for their resting fill instead of falling back to neutral outline styling

#### Scenario: Open task detail from history or recent tasks
- **WHEN** user opens a task and the right-side artifact workspace still needs several seconds to load detail data
- **THEN** the right workspace shows a compact loading placeholder surface before the final Markdown or VQA pane mounts
- **AND** the placeholder is replaced only after detail data is ready, instead of rendering the final pane shell with incomplete content
- **AND** if the user switches to a different task or workflow context before an earlier detail request resolves, the stale response is ignored and does not overwrite the current workbench state or in-progress local edits

#### Scenario: Inspect transcript correction output in a task with correction enabled
- **WHEN** user opens the `文本纠错` tab for a task whose transcript-correction stage is enabled
- **THEN** `strict` mode shows per-timestamp comparison rows with original transcript on the left and corrected transcript on the right
- **AND** the corrected side can fill in progressively while the correction stream is still running
- **AND** `strict` comparison rows align original and corrected segments by their timestamp key instead of relying on array index position or arrival order
- **AND** if one timestamp has not received its corrected segment yet, only that timestamp row shows a local waiting placeholder and later rows remain visible
- **AND** long `strict` comparison lists render through a virtualized row surface so only the visible timestamp rows stay mounted
- **AND** `rewrite` mode also renders through the same timestamp-aligned left-right comparison surface instead of falling back to a single undifferentiated text block
- **AND** if a legacy task only has whole-text rewrite output without timestamp-aligned segments, the workbench MAY show a compatibility fallback notice together with that whole-text result
- **AND** if correction is skipped or disabled, the tab explains that downstream notes generation is using the raw transcript directly

#### Scenario: Review transcript output while task state continues updating
- **WHEN** task state, progress, or transcript artifacts refresh while the user is staying on the `转写片段` tab
- **THEN** the transcript list keeps stable scroll behavior instead of jumping unexpectedly
- **AND** the renderer can append or replace transcript content without fighting manual user scrolling

#### Scenario: Preview imported source media inside the workbench
- **WHEN** user opens a task whose detail payload includes a persisted `source_local_path`
- **THEN** the left video panel requests the playable source through `GET /tasks/{task_id}/source-media` instead of a renderer-side `file://` URL
- **AND** if backend detects that the stored `source_local_path` points to a cleaned temporary workspace, it repairs the task detail path from the retained source asset before the panel requests playback
- **AND** the video element resets stale playback time and duration state when the task or media source changes
- **AND** if the source file can no longer be opened, the panel shows a readable preview-failure hint instead of leaving a silent black frame

#### Scenario: Open a running task during transcript production
- **WHEN** a running task is still executing phase `C` and persisted transcript artifacts are not yet complete
- **THEN** the transcript tab keeps a stable loading or processing hint instead of alternating between contradictory empty states
- **AND** once live `transcript_delta` events arrive, the renderer replaces that hint with ordered timestamped transcript cards before phase `C` fully completes
- **AND** transcript reset events clear stale live rows when the same task restarts or reruns phase `C`
- **AND** once persisted transcript segments arrive from the detail API, the renderer reconciles them with the live transcript view without duplicating cards

#### Scenario: Read a long stage-output timeline
- **WHEN** the stage-output tab contains more content than the available panel height
- **THEN** the left workbench panel exposes an inner vertical scrollbar for that tab
- **AND** recent stage activity is summarized with user-readable stage labels and business-language status text instead of raw backend event type names or opaque debug payloads

#### Scenario: Drag the workbench split while dense note content is visible
- **WHEN** user drags the horizontal split handle while long Markdown notes, note images, or Mermaid previews are mounted
- **THEN** transcript scrolling, video controls, tab switching, and split dragging remain responsive
- **AND** non-critical note imagery or Mermaid preview paint MAY defer until the drag interaction completes
- **AND** the workbench uses a lower-cost visual mode for high-frequency surfaces during the drag interaction instead of keeping every decorative layer live

#### Scenario: Render high-frequency runtime updates without workspace flicker
- **WHEN** phase `C` emits frequent `progress` or stage events while the task workbench is open
- **THEN** the renderer updates the visible overall progress from stream data without forcing a full task-detail refresh on every event
- **AND** background task-detail refresh is reserved for stage transitions, milestone logs, and terminal events
- **AND** stream-driven progress updates do not recreate the task SSE subscription or cancel already scheduled milestone refreshes
- **AND** task runtime stream state is buffered in a dedicated Zustand workbench runtime store instead of staying in root-component local state
- **AND** transcript, correction, stage-output, chat, and trace panels subscribe to their own selectors so high-frequency updates do not force the whole workbench shell to commit together
- **AND** unchanged right-side Markdown or VQA workspaces remain stable while those progress events continue arriving, unless their own displayed artifact data has changed
- **AND** the running-state badge summarizes the active workflow step in business language instead of showing a raw generic backend status string
- **AND** recent stage activity omits repetitive raw progress spam and keeps milestone-focused readable updates
- **AND** when transcript optimization is skipped for long content or timeout fallback is used, recent stage activity explains that the task continues with the current transcript to shorten waiting time instead of exposing raw pipeline wording
- **AND** terminal task events immediately retire the cancel action and trigger a background task-detail sync so the workbench does not remain visually stuck on an earlier phase after backend completion

#### Scenario: Pause and resume a running task from the workbench header
- **WHEN** user pauses a running task from the header action area
- **THEN** the workbench updates the task summary to `已暂停`
- **AND** the header swaps the primary running-state action from `暂停任务` to `继续任务`
- **AND** while the task remains paused, the header keeps `取消任务` available so the user can terminate the same unfinished run without reopening the task
- **AND** after resume, the same workbench re-enters the running stream flow without requiring the user to reopen the task

#### Scenario: Keep playback interactions smooth during task inspection
- **WHEN** user plays, drags, or seeks the task video inside the left preview pane
- **THEN** high-frequency playback state such as current time, duration, mute state, and play state stays isolated to the preview surface instead of invalidating the entire task workbench tree
- **AND** unrelated surfaces such as the right-side Markdown workspace, VQA panes, and top summary header do not rerender on every video `timeupdate`
- **AND** transcript-row highlighting updates with the active segment while unchanged transcript rows remain stable

### Requirement: UI library SHALL provide a reusable virtual-list primitive for long evidence surfaces
Frontend UI library SHALL provide a reusable virtual-list component under `apps/desktop/src/components/ui` implemented with `@tanstack/react-virtual`. The primitive SHALL support dynamic item-height measurement, configurable `overscan`, caller-supplied stable `itemKey`, and customizable empty-state rendering so transcript and evidence surfaces can share one virtualization contract.

#### Scenario: Render a large transcript or evidence collection
- **WHEN** a workbench surface renders hundreds of transcript or evidence rows
- **THEN** the surface can mount the shared virtual-list primitive and keep only visible rows in the DOM
- **AND** row height can be measured dynamically to support mixed-content cards
- **AND** list overscan can be tuned per usage context
- **AND** callers can provide stable item keys and a custom empty-state node

#### Scenario: Open a VQA task and ask a question
- **WHEN** user submits a question from the VQA workbench
- **THEN** before retrieval hits or answer tokens arrive, the assistant bubble shows a temporary loading placeholder with business-language progress copy instead of a blank bubble
- **AND** while the answer stream is active, the composer action switches from `发送` to `停止`
- **AND** if the task has already completed its persisted `D/vqa-prewarm` preparation, the first question reuses that prepared retrieval corpus (merged transcript evidence and VLM keyframe semantics) instead of rebuilding the same vector index on demand
- **THEN** the renderer streams incremental answer chunks into the chat surface
- **AND** while answer chunks are still streaming, the assistant bubble keeps a lightweight plain-text surface instead of re-running full Markdown rendering on every chunk
- **AND** streamed assistant answers render as Markdown instead of plain paragraph text
- **AND** if the upstream LLM stream is interrupted after partial output, the renderer prefers a recovered full-answer replacement or a business-friendly retry hint instead of exposing raw transport errors such as incomplete chunked-read text
- **AND** user and assistant bubbles both use explicit avatar affordances instead of rendering the user side as an anonymous color block
- **AND** each answer may expose a retrieval trace identifier, citations, and citation jump actions
- **AND** retrieval-trace and citation actions use compact icon buttons with hover tooltips instead of long inline labels
- **AND** citations prefer the shared contracts fields `citation_type` and `image_evidence` for visual evidence rendering
- **AND** `image_path` and `visual_text` remain compatibility-only fields for legacy task artifacts
- **AND** opening Trace Theater reveals a single final retrieval-hits panel with deduplicated candidates from the unified vector-index chain
- **AND** Trace Theater does not render legacy `dense_hits`, `sparse_hits`, `rrf_hits`, or `rerank_hits` sections in the current baseline
- **AND** Trace Theater states that retrieval uses the original user question directly without query expansion
- **AND** Trace Theater shows human-readable normalized scores instead of raw backend magnitude values that collapse visually to zero
- **AND** per-task VQA chat history is restored when the user leaves the workbench and later reopens the same task from history or recent tasks
- **AND** restored per-task VQA chat history normalizes unfinished assistant streaming placeholders to a completed local state instead of reviving a stale `streaming` session
- **AND** persisted per-task VQA trace snapshots keep only a bounded recent cache window while preserving the active or selected trace entry so renderer-side storage does not grow without limit
- **AND** once the chat reaches fifteen user turns, the sixteenth send action first asks for confirmation and explains that continuing will clear the existing conversation before starting a new one

#### Scenario: Display VQA workflow steps during multimodal migration
- **WHEN** workbench renders task steps for `vqa`
- **THEN** the UI shows explicit multimodal stages (`文本向量化`、`视频抽帧`、`画面语义识别`、`多模态融合与就绪`) instead of collapsing directly to a generic `问答就绪`
- **AND** while backend substage names are still being migrated, the UI accepts legacy substage keys such as `multimodal_prewarm` and maps them into the new step presentation

### Requirement: Prompt settings SHALL include an experiment surface
Prompt-template settings SHALL include a `Prompt Lab` surface that compares two templates under the same channel against the same sample title and transcript.

#### Scenario: Open prompt settings after templates load
- **WHEN** user enters the prompt-template section
- **THEN** the renderer shows the template list and the Prompt Lab surface in the same section
- **AND** Prompt Lab allows selecting a channel plus template `A/B`
- **AND** Prompt Lab shows both the original template text and a generated sample prompt draft for comparison
- **AND** the surface explicitly explains that `模板原文` is the saved template body while `样例提示草稿` is the assembled prompt preview before model invocation rather than a model answer

### Requirement: Diagnostics view SHALL expose autofix and issue summary
Diagnostics view SHALL provide a direct autofix action when the backend marks issues as auto-fixable, and SHALL summarize actionable issues below the live runtime strip.

#### Scenario: Self-check report contains auto-fixable issues
- **WHEN** diagnostics report indicates `auto_fix_available`
- **THEN** the renderer shows an `自动修复` action
- **AND** the issue summary lists each problem, its status, message, and optional manual action guidance

#### Scenario: Diagnostics self-check validates LLM online connectivity
- **WHEN** the backend runs the `LLM 模型` self-check step
- **THEN** it verifies the configured online LLM API key and Base URL
- **AND** it probes the configured OpenAI-compatible `/models` endpoint
- **AND** it only reports success when the `/models` response is a valid model list and the configured `model` is present in that remote list
- **AND** the diagnostics issue summary reports the concrete connectivity result instead of only checking whether the config file exists

#### Scenario: Diagnostics self-check validates Whisper runtime readiness
- **WHEN** the backend runs the `Whisper 转写` self-check step
- **THEN** it reports current runtime readiness based on `whisper-cli` availability and the configured model directory
- **AND** the diagnostics issue summary tells the user whether the current problem is missing executable, missing model path, or both

#### Scenario: Diagnostics self-check validates embedding inference probe
- **WHEN** the backend runs the `嵌入模型` self-check step
- **THEN** it executes a minimal real embedding inference probe instead of only validating static config presence
- **AND** the step result includes current provider and processor labels from the runtime probe details
- **AND** any probe failure is surfaced as a step-level diagnostics issue rather than aborting the full self-check session

#### Scenario: Diagnostics self-check validates rerank inference probe
- **WHEN** the backend runs the `重排序模型` self-check step
- **THEN** it executes a minimal real rerank inference probe instead of only validating static config presence
- **AND** the step result includes current provider and processor labels from the runtime probe details

#### Scenario: Diagnostics self-check validates VLM inference probe
- **WHEN** the backend runs the `视觉模型` self-check step
- **THEN** it verifies `vlm-default` against the configured endpoint and prefers a minimal real image-description inference probe when that verification can finish within the current self-check budget
- **AND** for local loopback OpenAI-compatible or Ollama vision endpoints without a fresh successful probe cache, it MAY first return `check_depth=reachability` after `/models` validation while the real image-description probe continues in the background
- **AND** once that background probe succeeds, a subsequent self-check reuses the cached result and returns `check_depth=model_verified`
- **AND** the step result includes the configured model/provider details together with the current verification depth and probe summary

#### Scenario: Diagnostics view survives page navigation during self-check
- **WHEN** user starts a self-check, leaves the diagnostics page, and later returns within the same desktop session
- **THEN** the renderer restores the last active self-check session from local persistence
- **AND** it reloads the current report for that session
- **AND** it resumes SSE subscription when the restored session is still running or fixing
- **AND** while the session is still streaming, the diagnostics view applies step progress and log updates from incremental SSE payloads instead of re-fetching the full report on every event
- **AND** once the session reaches a terminal state, the renderer retires that session's SSE subscription promptly to avoid redundant polling, network traffic, and retained listeners

#### Scenario: Diagnostics self-check validates Whisper cache path from configured catalog entry
- **WHEN** the backend runs the `Whisper 模型缓存` self-check step after a local-model migration
- **THEN** it resolves the Whisper cache directory from the current model-catalog path instead of assuming the storage default directory
- **AND** the reported cache path matches the migrated absolute directory when the catalog has already been updated

#### Scenario: Diagnostics event logs stay Windows-safe
- **WHEN** backend persists self-check or other non-task event topics to JSONL
- **THEN** Windows-unsafe topic characters are sanitized before the event-log filename is generated
