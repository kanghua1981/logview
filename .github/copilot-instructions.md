# Copilot Instructions for LogView

LogView is a high-performance desktop log analysis tool for embedded developers, built with **Tauri (Rust)** and **React (TypeScript)**.

## 🏗️ Architecture & Boundaries
- **Rust Backend (`src-tauri/src/lib.rs`)**: Handles all heavy-lifting: file I/O (mmap), parallel regex parsing (rayon), and log indexing.
- **React Frontend (`src/`)**: 
  - **State**: Managed via Zustand in [src/store.ts](src/store.ts).
  - **UI**: Components in [src/components/](src/components/). Styled with Tailwind CSS.
  - **Visualization**: Recharts in [src/components/MetricsPanel.tsx](src/components/MetricsPanel.tsx).
  - **Bridge**: Tauri commands (`invoke`) and events. See [src/utils/logLoader.ts](src/utils/logLoader.ts).

## 🔑 Core Concepts & Patterns
- **Cascading Filters**: Users add filters that are applied sequentially. Managed via `refinementFilters` in [src/store.ts](src/store.ts).
- **Command Mode**: VI-like interaction in the filter bar (prefix `:`, `@`, `?`). Logic resides in [src/utils/commandProcessor.ts](src/utils/commandProcessor.ts).
- **Virtualized Rendering**: Millions of lines are handled by `react-virtuoso` in [src/components/LogViewer.tsx](src/components/LogViewer.tsx). 
- **Dehydration Mode**: A core concept of filtering noise to see the "KeyPath Trace".
- **Session/Boot Management**: Logs are split into "Sessions" based on boot markers.

## 🛠️ Developer Workflows
- **Development**: `npm run tauri:dev` (runs both Vite and Tauri).
- **Frontend Build**: `npm run build`.
- **Backend Build**: `cargo build` within `src-tauri`.
- **Debugging**: Use `console.log` for frontend; `println!` or `log` crate for backend (visible in terminal).

## 📝 Conventions
- **Tauri Commands**: Always define in [src-tauri/src/lib.rs](src-tauri/src/lib.rs) and register in `generate_handler!`.
- **Frontend States**: Keep UI-only state in `useState`, but everything shared or persistent in Zustand [src/store.ts](src/store.ts).
- **Tailwind**: Use utility classes (like `bg-blue-900/40`) for consistent styling.
- **I18n**: Currently mainly Chinese. Maintain consistency in comments and UI text.

## 🤖 AI Context
- Use [src/utils/aiContextCollector.ts](src/utils/aiContextCollector.ts) to gather log snippets for AI analysis without hitting token limits.
- Command mode `?` triggers AI analysis via [src/components/AiSidePanel.tsx](src/components/AiSidePanel.tsx).
