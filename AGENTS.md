# Repository Guidelines

SnapSVG is a Vite + React app for image-to-SVG vectorization, with an optional Rust/WASM core.

## Project Structure & Module Organization
- `index.tsx` bootstraps the React app; `App.tsx` composes the main UI.
- `components/` holds UI building blocks (for example `Sidebar.tsx`, `Canvas.tsx`).
- `services/` contains tracing logic and integrations (for example `services/mockVTracer.ts`).
- `utils/` stores shared helpers like `utils/svgParser.ts`; shared types live in `types.ts`.
- `public/` hosts static assets; `dist/` is Vite build output.
- `src-rust/` contains the optional Rust/WASM tracing core and build artifacts.

## Build, Test, and Development Commands
- `npm install` installs Node dependencies.
- `npm run dev` starts the Vite dev server for local development.
- `npm run build` produces the production build in `dist/`.
- `npm run preview` serves the production build locally.
- Optional WASM build: `cd src-rust && wasm-pack build --target web --out-dir ../public/wasm`.

## Coding Style & Naming Conventions
- TypeScript + React with 4-space indentation and single quotes in TS/TSX files.
- Avoid `any`; keep types explicit (see `DEVELOPMENT.md`).
- Keep UI components in `components/` and business logic in `services/`.
- Component files use `PascalCase` (for example `Sidebar.tsx`); utilities use `camelCase` (for example `svgParser.ts`).
- Preserve existing core-algorithm comments; do not remove non-English notes.

## Testing Guidelines
- No automated test runner is configured yet (no `npm test` script).
- Validate changes manually via `npm run dev`, especially upload/trace/download flows.
- If you add tests, use `*.test.ts`/`*.test.tsx` and add the runner to `package.json`.

## Commit & Pull Request Guidelines
- Commit history uses Conventional Commits: `feat:`, `docs:`, `feat(core):` with short summaries.
- Keep commits focused and scoped; follow the existing English/Chinese mix where appropriate.
- PRs should include a concise summary, test steps, and screenshots for UI changes.
- Call out new environment variables or build steps in the PR description.

## Configuration & Secrets
- Create `.env.local` with `GEMINI_API_KEY` for AI features; never commit secrets.
- Node.js 18+ is expected; Rust + `wasm-pack` are required only for WASM work.

*回复以及注释都使用中文*