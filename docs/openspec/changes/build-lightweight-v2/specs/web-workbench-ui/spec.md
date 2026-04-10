## ADDED Requirements

### Requirement: UI SHALL preserve current frontend visual system as hard constraint
All subsequent frontend work SHALL extend the current visual language, spacing rhythm, shell structure, dialog style, and interaction tone. New features SHALL not introduce a separate design system or conflicting visual direction.

#### Scenario: Add a new UI control
- **WHEN** frontend adds a new control, panel, or page
- **THEN** it uses the current tokens, component density, title bar pattern, sidebar pattern, and card/dialog styling
- **AND** it keeps the current frontend aesthetic direction as the governing baseline

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

### Requirement: Prompt template UI SHALL distinguish channels visually
Prompt template list and editor SHALL use channel-specific icons and labels for `correction`, `notes`, `mindmap`, and `vqa`.

#### Scenario: Browse prompt templates
- **WHEN** user opens the prompt template section
- **THEN** each template card shows the channel label and a distinct icon marker
- **AND** the editor dialog reflects the currently selected channel visually

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
