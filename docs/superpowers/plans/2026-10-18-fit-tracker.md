# Fit Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and deploy the complete Persian local-first mobile fitness PWA.
**Architecture:** Typed Dexie persistence and one reactive data context feed independent feature routes. Pure calculations, local-date helpers and backup validation stay outside React. Manager owns integration and deployment; bounded feature workers own separate directories, with two supervisors independently verifying their domain.
**Tech Stack:** Vite, React, strict TypeScript, Tailwind, Dexie, Zustand, Recharts, Framer Motion, Lucide, vite-plugin-pwa, Vitest.
**Spec:** ../specs/2026-10-18-fit-tracker-design.md

## Global Constraints
- No backend, login, telemetry or CDN; all data stays on device.
- Persian RTL, local Vazirmatn, ISO stored dates, kg/cm canonical units, HashRouter.
- Min 44px targets, safe areas, focus states, reduced motion, light/dark/auto.
- Full JSON including photos, strict atomic import, CSV, confirmed reset and demo.
- No placeholders or TODOs; user has authorized autonomous delivery without questions.

## Review Focus
- DST/timezone/year boundaries: calendar days and weekly summaries cannot shift by UTC conversion.
- Untrusted backup files: invalid dates, NaN, broken references, duplicate IDs and oversized photo data must reject without partial writes.
- Historical habits: archived/future/scheduled-off habits must not invalidate prior completions or inflate today's completion.
- Unit switches: lb/in input converts exactly once, exports remain canonical and BMI/ETA stay consistent.
- Mobile offline reload and update: all route chunks/fonts available, unsaved forms not silently discarded by worker update.

## Task 1: Scaffold and design foundation
Files: package.json, Vite/TS/ESLint/Prettier configs, index.html, src/styles.css, src/components/ui.tsx, src/store/ui.ts, docs/CONTRACT.md.
- [ ] Configure strict TS, scripts, dependencies and responsive semantic design tokens.
- [ ] Install dependencies and verify test runner and TypeScript toolchain.
- [ ] Commit `chore: scaffold typed React fitness PWA`.

## Task 2: Persistence and pure functions
Files: src/db/{types,index,backup,seed}.ts, src/lib/{dates,calculations,format}.ts, src/hooks/useData.tsx, src/test/*.
Interfaces: docs/CONTRACT.md defines all types, component props and APIs.
- [ ] Write and run failing tests for BMR/TDEE safety, moving average, ETA, MET, scheduled streaks, date arithmetic, conversion, DB upserts and backup atomicity.
- [ ] Implement canonical typed tables, pure functions and reactive context; confirm tests pass.
- [ ] Commit `feat: add local-first database and tested health calculations`.

## Task 3: Checklist
Files: src/features/habits/* and tests.
- [ ] Add tests for schedule/target/archive/order and dates before creation.
- [ ] Build edit/create/reorder/archive, numeric completion, per-habit streak and heatmap.
- [ ] Verify tests and commit `feat: build customizable habit checklist and streaks`.

## Task 4: Weight and journal
Files: src/features/weight/*, src/features/journal/*, src/components/DataChart.tsx, chart/photo tests.
- [ ] Test date-based seven-day average, ETA direction/minimum sample, photo limits and canonical conversions.
- [ ] Build raw/trend/goal charts, ranges, editable logs, BMI/change/ETA, five measurement charts; build sleep/mood/energy/notes and local photo comparison.
- [ ] Verify tests and commit `feat: add weight trends measurements and private journal`.

## Task 5: Diet
Files: src/features/diet/* and tests.
- [ ] Test calorie/macro aggregation and water floor.
- [ ] Build meal quick add and edit/delete, custom foods, favorites/recent, macros, adherence, cheat markers, water and daily/weekly target charts.
- [ ] Verify tests and commit `feat: add meal library nutrition and hydration tracking`.

## Task 6: Exercise
Files: src/features/exercise/* and tests.
- [ ] Test MET/intensity, weekly volume, PR and rest-day behavior.
- [ ] Build workout logs/edit/delete, sets/reps/weights, reusable routines, steps, weekly goal, records, rest and volume chart.
- [ ] Verify tests and commit `feat: add workouts routines and training records`.

## Task 7: Integration, dashboard, onboarding, reports and settings
Files: src/{App,main}.tsx, src/features/{onboarding,today,reports,settings}/*, src/components/{Layout,QuickAdd,ErrorBoundary}.tsx, src/hooks/usePwa.ts.
- [ ] Test profile validation, badges and period aggregation; run failing tests before implementation.
- [ ] Implement three-step profile flow, routes/date navigation, completion ring/confetti, quick add, reminders, reports/correlation/badges, settings/profile/locale/units/theme, backup/CSV/demo/reset/install.
- [ ] Browser-verify primary CRUD and unit/theme/calendar settings; commit `feat: integrate dashboard insights onboarding and settings`.

## Task 8: PWA, deploy and documentation
Files: public/icons/*, manifest generation, .github/workflows/deploy.yml, README.md, LICENSE, docs/screenshots/*.
- [ ] Generate 192/512/maskable/Apple icons and offline service worker, base `/fit-tracker-pwa/`, Actions deployment.
- [ ] Write complete Persian + English README with real screenshots, run/build/deploy/install/backup/privacy/medical limits.
- [ ] Run lint, tests, build, browser/offline/accessibility/Lighthouse and fresh independent reviews; fix all important failures with regression tests.
- [ ] Commit `feat: ship offline installable PWA and Pages deployment` and `docs: document setup installation backups and verification`.
- [ ] Create public GitHub repository with description/topics, push main, enable Pages Actions, verify deployment and live URL.
