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

### Requirement: Heavy renderer modules SHALL lazy load with structured skeleton placeholders
Heavy renderer modules such as settings subviews and embedded markdown editors SHALL load on demand and SHALL present structured skeleton placeholders instead of plain text loading prompts while code or CSS chunks are still resolving. Those placeholders SHALL use neutral placeholder surfaces with subtle shimmer sweeps rather than accent-colored solid blocks.

#### Scenario: Open a lazily loaded settings surface
- **WHEN** user opens a lazily loaded view or prompt editor
- **THEN** the renderer shows a layout-matched skeleton placeholder
- **AND** the placeholder uses neutral, low-contrast loading tones with a restrained shimmer effect
- **AND** the final surface replaces the skeleton once the async chunk and styles are ready

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
- **AND** the helper copy tells the user to place the pointer on the image to drag the image position
- **AND** surrounding appearance cards keep helper copy minimal and avoid repeating nearby controls or status labels
- **AND** the selection frame stays fully inside the currently rendered image bounds, including at the minimum persisted `100%` scale
- **AND** the current shell background updates in real time while the dialog is open
- **AND** the primary save action follows the active UI theme hue instead of using a fixed accent color
- **AND** saving the dialog persists opacity, blur, scale, and focus coordinates for the selected image

#### Scenario: Restore a saved custom skin
- **WHEN** renderer loads with persisted skin settings
- **THEN** the fixed shell background layer restores the saved image using the stored opacity, blur, scale, and focus coordinates
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
- **AND** the workspace shell does not add extra renderer-side blur or tint beyond the persisted skin blur and opacity values

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
Renderer branding surfaces and favicon SHALL use `frontend/public/icon.svg` as the project logo asset.

#### Scenario: Open application shell
- **WHEN** application renderer loads
- **THEN** sidebar branding uses the project logo
- **AND** browser/electron renderer favicon resolves to the same logo asset

### Requirement: Renderer SHALL consume backend data through plain HTTP APIs
Frontend SHALL only render backend-provided data and call the Python backend over HTTP APIs. Electron bridge SHALL be limited to desktop shell integrations such as open path, open external link, image-file selection, and window controls.

#### Scenario: Load the workbench in Electron
- **WHEN** renderer starts inside Electron
- **THEN** data requests go through the backend HTTP API
- **AND** Electron preload APIs are used only for desktop shell interactions

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
