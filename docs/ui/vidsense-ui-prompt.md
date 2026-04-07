# VidSense UI Prompt

Design a front-end UI for a video AI note-taking tool called "VidSense" with the following specifications:

1. General Theme:
   - Minimalist, clean, and modern design
   - Supports both light and dark modes with smooth transitions
   - Animations should be natural, subtle, and performance-friendly
   - Focus on low performance load, minimal DOM elements, virtualized lists for transcripts
   - Typography handled with Pretext for all text hierarchy and layout
   - Google Fonts for readability and aesthetics

2. Layout Structure:
   - Header: Left-aligned logo and app name (VidSense), right-aligned theme toggle (light/dark)
   - Header subtitle text should be `实时多阶段视频分析工作台` (without `SSE` prefix)
   - Header should include a `Quick Start` entry that switches main area into an in-app markdown guide page
   - Sidebar (optional, collapsible): Navigation links to Upload Video, History, Settings
   - Main Content Area:
       a. Video Player with playback controls and progress bar for transcription
       b. Tabs or sections for:
           i. Transcript with time-stamped text, virtualized scrollable list, current segment highlight
           ii. AI-generated summary with hierarchical Pretext layout (headings, bullet lists)
           iii. Interactive mindmap (Markmap) with smooth zoom/pan, lightweight rendering
   - Footer: Status messages

3. Interactions & Animations:
   - Smooth hover and focus effects for buttons, icons (use Lucide for icons)
   - Tabs and collapsible panels animate with natural easing (0.2~0.3s)
   - Loading spinners are subtle and lightweight
   - Highlighting transcript segments with fade-in transitions
   - Theme toggle smoothly transitions colors using Tailwind CSS variables
   - When modal dialogs are open, background page scroll MUST be locked (mouse wheel should only affect modal content)

4. Inputs & Controls:
   - File/video upload: drag-and-drop + file picker
   - Searchable history list
   - Remove redundant static download section; after analysis completes, show a contextual one-click download button
   - The one-click button should package all artifacts and auto-select archive format by client OS (`Windows -> zip`, `Linux -> tar`)
   - Theme toggle with smooth transition
   - Faster-Whisper 参数提示采用结构化两行格式：先显示“可填参数”，再显示“说明”，并配合简洁图标提升可读性
   - Faster-Whisper 设备参数为 GPU-only：仅展示并使用 `cuda`，不提供 CPU 回退选项
   - Add an environment self-check modal with ordered vertical progress steps, realtime SSE logs, one-click auto-fix, and explicit manual-action guidance

5. Typography & Pretext Layout:
   - Video title: h1, bold, large
   - Section headings: h2/h3, bold, medium
   - Transcript and summary text: normal, readable
   - Timestamp: smaller, subtle color
   - Mindmap labels: medium, bold for main nodes, normal for children

6. Color Palette:
   - Light mode: #ffffff background, #000000 text, #4cafef accent
   - Dark mode: #121212 background, #e0e0e0 text, #4cafef accent
   - Accent color used sparingly for highlights, active tabs, buttons
   - All colors smoothly transition on theme change

7. Responsiveness:
   - Desktop-first design, gracefully scales to laptop screens
   - Sidebar collapses on smaller widths
   - Main content area adapts to available space
   - Layout remains left-anchored and stable when browser zoom is reduced to 50%, without drifting toward center

8. Component Guidelines:
   - Use React for UI structure
   - shadcn/ui + Radix UI for accessible, modular components (buttons, tabs, toggles, modals)
   - Tailwind CSS for styling and layout
   - Lucide icons for controls and feedback
   - Pretext for all text layout and hierarchical structure
   - Mindmap rendered with Markmap in lightweight canvas/iframe
   - Virtualized list for transcripts to ensure performance

9. Performance Considerations:
   - Avoid heavy animations or unnecessary DOM updates
   - Virtualized transcript list for long videos
   - Smooth transitions for theme, hover, and tab changes
   - Keep components modular and isolated to avoid re-renders

10. Additional Notes:
   - Maintain a cohesive, uncluttered minimalist style
   - User workflow: Upload video → transcription → summary → mindmap
   - Prioritize readability, simplicity, and ease of navigation
   - All interactions should feel intuitive and smooth, even on mid-range hardware (e.g., RTX 3050 + 16GB RAM)
   - On Windows, backend terminal output should enforce UTF-8 stdio to avoid Chinese garbling
