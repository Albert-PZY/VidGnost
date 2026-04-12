## ADDED Requirements

### Requirement: Electron workbench SHALL render a fixed shell with isolated scroll regions
The Electron renderer SHALL present a fixed top title bar, a left navigation sidebar, and a main content region. Scrollbars SHALL be confined to content regions below the title bar.

#### Scenario: Scroll a long settings page
- **WHEN** content height exceeds the viewport
- **THEN** the title bar remains sticky at the top
- **AND** the scrollbar appears only inside the page content region beneath the title bar

### Requirement: Settings center SHALL provide frontend-driven configuration sections
Settings center SHALL provide `模型配置`, `提示词模板`, `外观设置`, and `语言设置` sections backed by persisted backend data.

#### Scenario: Open settings center
- **WHEN** user opens settings from the application shell
- **THEN** the renderer shows the four sections with current persisted values from backend config APIs

### Requirement: Configuration dialogs SHALL stay within viewport with fixed chrome
Model configuration and prompt-template configuration dialogs SHALL remain within the visible viewport, keep header and action area fixed, and allow inner content scrolling when fields exceed available height. The header chrome SHALL stay visually compact so the main form area remains the dominant surface inside the dialog.

#### Scenario: Open a long configuration dialog
- **WHEN** dialog content exceeds available viewport height
- **THEN** the dialog body becomes scrollable
- **AND** the title, close control, cancel action, and save action remain visible

### Requirement: Model configuration dialog SHALL separate overview and grouped controls
Model configuration dialog SHALL use a responsive split layout with a left overview panel and a right grouped form panel. On desktop widths the dialog SHALL keep a wide presentation area suitable for dense professional forms, supporting a visual width up to `85rem`, and SHALL not fall back to the default small dialog width token. The overview panel SHALL keep a fixed readable width while the right-side configuration panel stays intentionally narrower than the previous ultra-wide layout. The overview panel SHALL expose model identity, component tag, provider, runtime status, install status, default path, current enabled state, and preset note, while keeping helper copy concise. Dialog centering SHALL preserve crisp text rendering and SHALL not distort embedded fixed-position surfaces.

#### Scenario: Open a model configuration dialog
- **WHEN** user clicks `配置` on a model item
- **THEN** the dialog shows a compact overview panel for model identity and state on the left
- **AND** the right side groups editable runtime parameters into dedicated cards
- **AND** path fields span the full row while regular scalar fields follow a responsive two-column grid

### Requirement: Prompt template UI SHALL distinguish channels visually
Prompt template list and editor SHALL use channel-specific labels for `correction`, `notes`, `mindmap`, and `vqa`, while avoiding duplicated explanatory copy inside the editor sidebar.

#### Scenario: Browse prompt templates
- **WHEN** user opens the prompt template section
- **THEN** each template card shows the channel label and a distinct icon marker
- **AND** the editor dialog reflects the currently selected channel visually

### Requirement: Prompt template editor SHALL provide split markdown editing with live preview
Prompt template editor SHALL use a markdown editor that keeps the source editor and rendered preview visible at the same time. The editor theme SHALL follow the application light/dark theme, editor-side scrolling SHALL remain synchronized with the preview pane during editing, and helper text above the editor SHALL stay concise without repeating nearby labels.

#### Scenario: Edit a prompt template in the settings center
- **WHEN** user opens the prompt template editor dialog
- **THEN** the dialog shows a markdown editor with source editing on the left and live rendered preview on the right
- **AND** the editor applies the same light or dark color mode as the renderer shell
- **AND** scrolling one pane keeps the other pane aligned for long prompt content

### Requirement: Desktop startup SHALL preload core workbench views before main window reveal
Electron desktop startup SHALL open a dedicated splash window first, keep the main window hidden while renderer assets and core workbench views initialize, and reveal the main window only after bootstrap completes or enters degraded mode. Core workbench views such as `新建任务`, `历史记录`, `设置中心`, `系统自检`, `任务处理`, and the prompt-template Markdown editor SHALL be included in the initial renderer startup path instead of route-level or dialog-level lazy loading placeholders. The splash surface SHALL follow the same restrained professional dark-tool styling as the renderer shell, using the project logo, compact status copy, and a single thin progress bar instead of decorative gradients, scanlines, floating ornaments, or oversized glass effects.

#### Scenario: Launch the Electron workbench
- **WHEN** user opens the desktop application
- **THEN** a standalone splash surface appears immediately with the project brand image and startup progress copy
- **AND** the splash surface keeps a compact professional layout with restrained dark surfaces and no decorative glow, scanline, or floating ornament treatment
- **AND** the hidden main window continues loading renderer assets, core workbench views, and initial UI data in the background
- **AND** the main window is revealed only after startup bootstrap reports completion or explicitly enters degraded mode
- **AND** no page-level or prompt-editor skeleton placeholder is shown as part of the initial desktop startup chain

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
- **AND** higher blur values MAY reduce the internal offscreen blur resolution to preserve interactive smoothness while keeping the saved scale, focus, and output frame unchanged
- **AND** the primary save action follows the active UI theme hue instead of using a fixed accent color
- **AND** saving the dialog persists opacity, blur, scale, and focus coordinates for the selected image

#### Scenario: Restore a saved custom skin
- **WHEN** renderer loads with persisted skin settings
- **THEN** the fixed shell background layer restores the saved image using the stored opacity, blur, scale, and focus coordinates
- **AND** the fixed shell background layer applies skin blur through the same offscreen WebGL pipeline used by the skin dialog preview
- **AND** the appearance settings skin status preview reuses the stored scale and focus coordinates when rendering its blurred preview surface
- **AND** the appearance settings skin status preview becomes visible as soon as the appearance section enters view and has a measurable preview surface
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
- **AND** sidebar separators stay clipped to the sidebar content width in every theme and SHALL NOT visually protrude past the container edge
- **AND** in light theme with a custom skin active, generic select and dropdown controls across the workbench keep white foreground text and icons by default and SHALL NOT fall back to dark typography inside glass popup surfaces
- **AND** in light theme with a custom skin active, new-task intake mode tabs and intake panels use theme-hue translucent fills with white foreground text and explicit hover or active emphasis
- **AND** in light theme with a custom skin active, history pagination controls keep white foreground text
- **AND** in light theme with a custom skin active, titlebar language/theme menus and the sidebar workflow menu use the shared glass dropdown surface, default to white text/icons, and express selected or hover state via neutral glass emphasis instead of theme-cyan fills
- **AND** in light theme with a custom skin active, titlebar language/theme menu items and sidebar workflow options keep a neutral resting state and SHALL NOT inherit global accent background fills outside their explicit local hover, focus, highlight, or selected glass states
- **AND** in light theme with a custom skin active, prompt-template list cards suppress hard white outline strokes in favor of translucent surface separation
- **AND** the workspace shell does not add extra renderer-side blur or tint beyond the persisted skin blur and opacity values
- **AND** wallpaper preview, blur, and transient feedback surfaces coalesce live renderer refreshes to frame cadence and release temporary GPU or audio resources when they close so long-running Electron sessions remain smooth

### Requirement: Shell controls SHALL expose explicit language selection state
Header language controls SHALL show the current selected language with explicit selected-state feedback and persist the language choice through UI settings.

#### Scenario: Open header language menu
- **WHEN** user opens the language menu in the title bar
- **THEN** the active language option is visually highlighted
- **AND** changing the option updates persisted UI settings

### Requirement: Shell controls SHALL expose explicit theme selection state
Header theme controls SHALL show the current selected theme mode with explicit selected-state feedback for `light`, `dark`, and `system`.

#### Scenario: Open header theme menu
- **WHEN** user opens the theme menu in the title bar
- **THEN** the active theme option is visually highlighted
- **AND** only the selected theme option shows the explicit selection indicator

### Requirement: Workbench branding SHALL use the project logo asset
Renderer branding surfaces, desktop splash branding, and favicon SHALL use `frontend/public/icon.svg` as the canonical project logo asset. The desktop package MAY include a synchronized raster companion asset at `frontend/public/icon.png` for runtime or distribution compatibility, and branding assets SHALL NOT depend on a separate legacy light-icon file.

#### Scenario: Open application shell
- **WHEN** application renderer loads
- **THEN** the desktop splash surface and sidebar branding use the project logo
- **AND** browser/electron renderer favicon resolves to the same logo asset
- **AND** any packaged raster companion icon stays visually aligned with the canonical SVG branding

### Requirement: Renderer SHALL consume backend data through plain HTTP APIs
Frontend SHALL only render backend-provided data and call the Python backend over HTTP APIs. Electron bridge SHALL be limited to desktop shell integrations such as open path, open external link, image-file selection, startup progress handoff between splash and main windows, and window controls.

#### Scenario: Load the workbench in Electron
- **WHEN** renderer starts inside Electron
- **THEN** data requests go through the backend HTTP API
- **AND** Electron preload APIs are used only for desktop shell interactions
- **AND** startup progress and completion handoff between the hidden main window and the splash surface stays inside the Electron shell bridge instead of changing backend transport contracts

#### Scenario: Pick a skin image from Electron
- **WHEN** user clicks the skin selection button in appearance settings inside Electron
- **THEN** Electron opens the native file picker for image files
- **AND** the renderer receives the selected image payload through the preload bridge without changing the backend transport model

### Requirement: Diagnostics view SHALL present runtime metrics as a compact live strip
Diagnostics view SHALL render runtime metrics in a single compact strip that exposes `uptime_seconds`, `cpu_percent`, `memory_used_bytes`, `memory_total_bytes`, `gpu_percent`, `gpu_memory_used_bytes`, `gpu_memory_total_bytes`, and `sampled_at` from the backend runtime metrics API without nested metric cards.

#### Scenario: Open diagnostics view after runtime metrics load
- **WHEN** the renderer requests `/runtime/metrics`
- **THEN** the diagnostics page shows a compact runtime strip with uptime, CPU, memory, and GPU summaries
- **AND** the strip shows the latest sample timestamp
- **AND** memory and GPU rows expose usage detail without expanding into secondary cards

### Requirement: New-task view SHALL expose multi-source intake with value preview
New-task view SHALL expose `Upload`, `URL`, and `Path` intake modes inside the same workbench surface and SHALL show workflow-specific value preview blocks before the user starts analysis.

#### Scenario: Open new-task view for notes workflow
- **WHEN** user enters the new-task view with workflow `notes`
- **THEN** the renderer shows responsive workflow step cards without horizontal scrolling, a value-preview summary, and the three intake modes
- **AND** the upload mode supports drag-and-drop plus batch file selection
- **AND** the user can switch to URL or absolute local-path input without leaving the page

### Requirement: Diagnostics view SHALL surface developer-mode samples when enabled
Diagnostics view SHALL expose a dedicated developer-mode area below the runtime strip and issue summary. When developer mode is enabled from settings, the area SHALL list recent local frontend performance samples captured from critical views or heavy actions; when developer mode is disabled, the same area SHALL explain how to enable it.

#### Scenario: Open diagnostics view with developer mode enabled
- **WHEN** user enables developer mode in settings and then opens diagnostics
- **THEN** the diagnostics page shows a developer-mode panel near the bottom of the page
- **AND** the panel lists recent performance samples with readable operation labels, local timestamps, and duration values in milliseconds
- **AND** the panel updates as new local samples are recorded during the same renderer session

### Requirement: Bootstrap surfaces SHALL provide startup progress and backend recovery actions
Workbench bootstrap SHALL expose a desktop splash progress state before the main window reveal and a renderer overlay state machine for `initializing`, `connecting`, `degraded`, and `ready` after the main window becomes visible. Degraded states SHALL provide direct recovery actions.

#### Scenario: Backend is unavailable during bootstrap
- **WHEN** renderer cannot complete initial health/config synchronization
- **THEN** the desktop splash completes the startup handoff and the main window opens in degraded mode
- **AND** a blocking overlay explains that the backend is unavailable
- **AND** the overlay provides `重试连接`, `查看诊断`, and `打开日志目录` actions
- **AND** the overlay is dismissed automatically once bootstrap reaches `ready`

### Requirement: Task processing workbench SHALL provide a resizable evidence-driven workspace
Task processing workbench SHALL use a horizontal resizable split layout. The left workspace SHALL provide `转写片段`, `证据时间轴`, and `阶段输出` tabs. The right workspace SHALL switch between `Markdown 工作区 / 思维导图 / 研究板` for notes tasks and `流式问答 / Trace Theater / 研究板` for VQA tasks.

#### Scenario: Open a completed notes task
- **WHEN** user opens a notes task in the processing workbench
- **THEN** the renderer shows the resizable video-and-artifact layout
- **AND** summary and notes results render as Markdown instead of plain preformatted text
- **AND** Markdown timestamps can seek the video
- **AND** transcript cards support quick actions such as `加入笔记` and `加入研究板`

#### Scenario: Open a VQA task and ask a question
- **WHEN** user submits a question from the VQA workbench
- **THEN** the renderer streams incremental answer chunks into the chat surface
- **AND** each answer may expose `trace_id`, citations, and citation jump actions
- **AND** opening Trace Theater reveals retrieval-stage panels such as Dense, Sparse, RRF, and rerank results

### Requirement: Prompt settings SHALL include an experiment surface
Prompt-template settings SHALL include a `Prompt Lab` surface that compares two templates under the same channel against the same sample title and transcript.

#### Scenario: Open prompt settings after templates load
- **WHEN** user enters the prompt-template section
- **THEN** the renderer shows the template list and the Prompt Lab surface in the same section
- **AND** Prompt Lab allows selecting a channel plus template `A/B`
- **AND** Prompt Lab shows both the original template text and a generated sample prompt draft for comparison

### Requirement: Diagnostics view SHALL expose autofix and issue summary
Diagnostics view SHALL provide a direct autofix action when the backend marks issues as auto-fixable, and SHALL summarize actionable issues below the live runtime strip.

#### Scenario: Self-check report contains auto-fixable issues
- **WHEN** diagnostics report indicates `auto_fix_available`
- **THEN** the renderer shows an `自动修复` action
- **AND** the issue summary lists each problem, its status, message, and optional manual action guidance
