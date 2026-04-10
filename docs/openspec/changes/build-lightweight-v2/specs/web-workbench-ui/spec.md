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
Model configuration and prompt-template configuration dialogs SHALL remain within the visible viewport, keep header and action area fixed, and allow inner content scrolling when fields exceed available height.

#### Scenario: Open a long configuration dialog
- **WHEN** dialog content exceeds available viewport height
- **THEN** the dialog body becomes scrollable
- **AND** the title, close control, cancel action, and save action remain visible

### Requirement: Model configuration dialog SHALL separate overview and grouped controls
Model configuration dialog SHALL use a responsive split layout with a left overview panel and a right grouped form panel. On desktop widths the dialog SHALL keep an extra-wide presentation area suitable for dense professional forms, supporting a visual width up to `100rem`, and SHALL not fall back to the default small dialog width token. The right-side configuration panel SHALL receive the larger share of horizontal space. The overview panel SHALL expose model identity, component tag, provider, runtime status, install status, default path, current enabled state, and preset note. The form panel SHALL group common runtime parameters and, for `openai_compatible` providers, a separate OpenAI-compatible interface configuration card.

#### Scenario: Open a model configuration dialog
- **WHEN** user clicks `配置` on a model item
- **THEN** the dialog shows a compact overview panel for model identity and state on the left
- **AND** the right side groups editable runtime parameters into dedicated cards
- **AND** path fields span the full row while regular scalar fields follow a responsive two-column grid

### Requirement: Prompt template UI SHALL distinguish channels visually
Prompt template list and editor SHALL use channel-specific icons and labels for `correction`, `notes`, `mindmap`, and `vqa`.

#### Scenario: Browse prompt templates
- **WHEN** user opens the prompt template section
- **THEN** each template card shows the channel label and a distinct icon marker
- **AND** the editor dialog reflects the currently selected channel visually

### Requirement: Prompt template editor SHALL provide split markdown editing with live preview
Prompt template editor SHALL use a markdown editor that keeps the source editor and rendered preview visible at the same time. The editor theme SHALL follow the application light/dark theme, and editor-side scrolling SHALL remain synchronized with the preview pane during editing.

#### Scenario: Edit a prompt template in the settings center
- **WHEN** user opens the prompt template editor dialog
- **THEN** the dialog shows a markdown editor with source editing on the left and live rendered preview on the right
- **AND** the editor applies the same light or dark color mode as the renderer shell
- **AND** scrolling one pane keeps the other pane aligned for long prompt content

### Requirement: Appearance settings SHALL persist theme hue, font size, and autosave
UI settings SHALL persist `theme_hue`, `font_size`, and `auto_save`, and the renderer SHALL apply them immediately to the active shell.

#### Scenario: Adjust theme hue
- **WHEN** user changes theme hue from the appearance section and saves it
- **THEN** title bar, sidebar, and primary emphasis colors update from the persisted hue setting
- **AND** the same hue is restored after application restart

#### Scenario: Adjust font size
- **WHEN** user changes interface font size and saves it
- **THEN** renderer applies the new root font size immediately and restores it on next launch

### Requirement: Shell controls SHALL expose explicit language selection state
Header language controls SHALL show the current selected language with explicit selected-state feedback and persist the language choice through UI settings.

#### Scenario: Open header language menu
- **WHEN** user opens the language menu in the title bar
- **THEN** the active language option is visually highlighted
- **AND** changing the option updates persisted UI settings

### Requirement: Workbench branding SHALL use the project logo asset
Renderer branding surfaces and favicon SHALL use `frontend/public/light.svg` as the project logo asset.

#### Scenario: Open application shell
- **WHEN** application renderer loads
- **THEN** sidebar branding uses the project logo
- **AND** browser/electron renderer favicon resolves to the same logo asset

### Requirement: Renderer SHALL consume backend data through plain HTTP APIs
Frontend SHALL only render backend-provided data and call the Python backend over HTTP APIs. Electron bridge SHALL be limited to shell/window integrations such as open path, open external link, and window controls.

#### Scenario: Load the workbench in Electron
- **WHEN** renderer starts inside Electron
- **THEN** data requests go through the backend HTTP API
- **AND** Electron preload APIs are used only for desktop shell interactions

### Requirement: Diagnostics view SHALL present runtime metrics as a compact live strip
Diagnostics view SHALL render runtime metrics in a single compact strip that exposes `uptime_seconds`, `cpu_percent`, `memory_used_bytes`, `memory_total_bytes`, `gpu_percent`, `gpu_memory_used_bytes`, `gpu_memory_total_bytes`, and `sampled_at` from the backend runtime metrics API without nested metric cards.

#### Scenario: Open diagnostics view after runtime metrics load
- **WHEN** the renderer requests `/runtime/metrics`
- **THEN** the diagnostics page shows a compact runtime strip with uptime, CPU, memory, and GPU summaries
- **AND** the strip shows the latest sample timestamp
- **AND** memory and GPU rows expose usage detail without expanding into secondary cards
