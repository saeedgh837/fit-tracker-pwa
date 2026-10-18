# Task 1: Diet feature and feature-owned tests

## Mission and authority

Implement the complete local-first diet screen for Hamgam: four meal groups, calorie entry with optional macros, food-library CRUD, favorites/recent foods, meal CRUD, adherence/cheat markers, water quick controls, and daily/weekly calorie-versus-target charts. This is one independently reviewable worker assignment, not permission to change the application foundation.

Work directly in **C:/Users/Saeed/ai_projects/check-list**, never in a worktree or another checkout. Write only **C:/Users/Saeed/ai_projects/check-list/src/features/diet/**, including colocated `*.test.ts` and `*.test.tsx`. Required deliverable: **C:/Users/Saeed/ai_projects/check-list/src/features/diet/DietPage.tsx**, default-exporting the route component. Keep reusable feature logic in **C:/Users/Saeed/ai_projects/check-list/src/features/diet/dietLogic.ts** with tests in **C:/Users/Saeed/ai_projects/check-list/src/features/diet/dietLogic.test.ts** and UI/write tests in **C:/Users/Saeed/ai_projects/check-list/src/features/diet/DietPage.test.tsx**. Additional components/services/tests may live only in the same owned directory.

Do not spawn agents, use git, commit, deploy, install/change dependencies, access the network, send Telegram/notifications, edit shared files/tests/configuration, create routes, or add a feature-level date picker. Do not execute the broader implementation plan's git/deployment steps. Application `toast` feedback is allowed; external reporting is not. Report blockers to the manager in the ordinary worker response, without notification tools.

## Read first and integration contract

Read these absolute main-root paths before writing:

- **C:/Users/Saeed/ai_projects/check-list/docs/CONTRACT.md**
- **C:/Users/Saeed/ai_projects/check-list/src/db/types.ts**
- **C:/Users/Saeed/ai_projects/check-list/docs/superpowers/specs/2026-10-18-fit-tracker-design.md**
- **C:/Users/Saeed/ai_projects/check-list/package.json**
- **C:/Users/Saeed/ai_projects/check-list/vitest.config.ts**
- **C:/Users/Saeed/ai_projects/check-list/src/test/setup.ts**

The manager implements ALL frozen shared imports. From top-level feature files consume only their published APIs: `db`, `uid`, `updateDay`, `changeWater` from `../../db`; types from `../../db/types`; synchronous reactive `useData` from `../../hooks/useData`; `useUI`, `run`, `toast` from `../../store/ui`; date helpers from `../../lib/dates`; `formatNumber` from `../../lib/format`; `nutritionTargets` from `../../lib/calculations`; UI primitives from `../../components/ui`; default `DataChart` from `../../components/DataChart`. Adjust relative depth for nested files. Never implement production fallbacks, ambient declarations, copied shared calculations, shared API stubs, or a second persistence store.

Relevant frozen shapes:

- `MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'`.
- `Nutrition = { calories:number; protein:number; carbs:number; fat:number }`.
- `Food` adds `{ id:string; name:string; favorite:boolean; lastUsedAt:string|null }` to Nutrition.
- `MealEntry` adds `{ id:string; date:string; meal:MealType; name:string; cheat:boolean; foodId?:string }` to Nutrition.
- `DailyLog` has `date`, `waterMl`, `adherence:'full'|'partial'|'off'|null`, `cheatMeal`, and other features' fields.
- `updateDay(date, patch)` transactionally merges only supplied fields. `changeWater(date, deltaMl)` transactionally clamps water to zero. `run(action,message?):Promise<boolean>` catches/notifies write failures.
- `nutritionTargets(profile, weightKg?)` returns calorie/macro estimates or null; do not implement its medical rules locally.
- `DataChart` consumes record rows, stable series keys, `title`, optional `goal`/`goalLabel`, and `valueFormatter`; it already supplies interaction, legend and a data table.

## Behavior and acceptance

- Read selected ISO day from `useUI().date`. Four visibly named groups are صبحانه، ناهار، شام، میان‌وعده, even when empty. Show per-group and selected-day calorie/macro totals. Never aggregate another day accidentally.
- Meal create/read/edit/delete is complete, with a real form/modal and confirmed destructive deletion. Require trimmed nonempty name and finite nonnegative calories. Protein/carbs/fat are optional inputs in grams; blank saves as numeric zero because the frozen schema requires numbers. Reject negative/nonfinite values; never infer calories from macros or require macro totals to match calories. Explain that optional macro totals may be incomplete.
- Food library has create/edit/delete, search, favorite toggle and separate favorites/recent views. Food nutrition is explicitly per saved serving, not silently per 100 g. Recent means non-null `lastUsedAt`, newest actual use timestamp first, with stable tie ordering. Editing/favoriting alone does not mark a food used.
- Selecting a library food pre-fills an editable meal draft; saving snapshots name/nutrition into the meal and saves `foodId`. Update `lastUsedAt` on successful use. Meal/library edits must not retroactively change older meal snapshots. Food deletion requires danger confirmation, preserves all linked meals and nutrition, and removes their optional `foodId` before deleting the food. Perform the related writes in a Dexie transaction if supported by the manager's real `db`; do not invent an undeclared shared helper. Never query an assumed `foodId` index: `toArray()` plus filtering is sufficient. If transaction support or reference policy is unavailable, report the precise integration dependency rather than leaving broken references or changing schema.
- Selected-day adherence supports full/partial/off and clearing to null, using a narrow `updateDay` patch. Provide a per-meal cheat toggle and an explicit daily `cheatMeal` marker. Distinguish the daily marker from meal flags; daily summary indicates either a daily marker or at least one flagged meal, without silently overwriting the explicit marker during meal CRUD.
- Show selected-day water in mL, progress against `profile.waterGoalMl` when positive, and visibly labeled +250, -250, +500 and -500 mL quick buttons with accessible Persian names. Every click calls `changeWater` through `run`; never read-modify-put a whole day. Missing day displays zero. Negative results clamp to zero; rapid successful increments are not lost. Disable pending duplicate submission appropriately. No division by zero for absent/zero goal.
- Add two real charts, both bounded by the selected day: daily calories for the trailing seven calendar days, and weekly calorie totals for eight weeks ending in the selected day's week. Use `startOfWeek(date, settings.weekStartsOn)`, `addDays` and `dateRange`; clip the final weekly bucket at the selected date. Keep ISO dates as identities and format only labels. Do not use UTC-derived date keys or include future records.
- The reference target is `nutritionTargets` using the latest weight on/before the selected date (latest time within that date), otherwise `profile.startWeightKg`. Label this as an estimate based on the current profile, not a stored historical prescription. Daily goal is that calorie estimate; weekly goal is estimate times the bucket's elapsed calendar days, not always seven for the partial week. Show logging completeness. Missing meal days are unrecorded/null in the daily chart, not invented zero consumption; weeks with no records remain empty/null. When all records are absent, show an actionable empty state rather than synthetic chart data. If profile/target is unavailable or calculator returns null, retain CRUD and actual totals while hiding target comparisons and explaining the unavailable estimate. Do not subtract exercise calories from intake.
- All writes pass through `run`; close/reset forms only after success. Keep draft input and dialog open after failure, expose an understandable Persian error, and allow retry. Preserve original record identity/date during edits. New drafts capture their selected date and show it in the modal, so changing global date cannot save into a different day silently.
- Use shared `PageHeader`, `Card`, `Field`, `Modal`, `Confirm`, `Button`/`IconButton`, `EmptyState`, `Progress`, and `DataChart` with their exact published props. Confirm uses `danger` for deletion. Persian formal-friendly copy, correct نیم‌فاصله and ی/ک, inherited RTL, logical spacing, locale-aware numbers/dates using settings, and isolated Latin fragments. Accessible visible labels, semantic buttons, focus restoration, keyboard-operable forms/dialogs, announced errors, minimum 44px touch targets, responsive layout and semantic light/dark tokens are acceptance requirements. Native number inputs use meaningful min/step and validation. Do not add external fonts/assets or hardcoded light-only surfaces.

## Test-first execution and evidence

The installed stack is React/TypeScript, Vitest/jsdom, Testing Library and fake IndexedDB. Tests must be colocated under the owned feature directory because the current configuration includes only `src/**/*.test.{ts,tsx}`. Test production feature logic, not a second implementation inside tests. Local test fixtures/mocks for contract boundaries are allowed; they do not prove real shared integration.

For each behavior batch: write tests first, run genuine RED, implement the minimum feature code, run GREEN, then refactor and rerun. A missing tool/package/shared module is a blocker, not intended RED. If necessary, add only a minimal importable unimplemented signature so assertions can fail on the missing behavior. Preserve actual commands, failing assertion excerpts, exit codes, and final test counts in the worker response; do not manufacture a pre-implementation failure after implementing.

Required coverage:

- Exact-day/group totals and no double counting; zero values, blank optional macros, invalid negatives/NaN/Infinity and whitespace names.
- Food CRUD/favorites/recent ordering; add-food snapshot plus use timestamp; later library edits/deletion preserve old meal values and valid references.
- Meal CRUD for two historical dates, edit identity/date preservation, cancel/confirm deletion, and failed-save draft retention.
- Adherence clear/set, independent cheat markers, narrow day patches preserving steps/rest/note, water helper arguments and failure/rapid-click behavior. Exercise actual fake-IndexedDB helper integration when the manager's implementation is available; do not claim mocked clamping proves the real helper.
- Chart daily/weekly sums, Saturday and nondefault week starts, month/year boundaries, clipped partial-week target, missing days, no future leakage, target-null/profile-missing cases, and latest eligible weight selection.
- UI visible labels, RTL container, accessible dialog/confirmation interactions and empty/error states. Inspect chart input rows, not only mocked chart presence.

Commands (run in main root; no install/network):

```sh
npm --prefix "C:/Users/Saeed/ai_projects/check-list" run test -- src/features/diet --reporter=verbose
node "C:/Users/Saeed/ai_projects/check-list/node_modules/eslint/bin/eslint.js" --config "C:/Users/Saeed/ai_projects/check-list/eslint.config.js" "C:/Users/Saeed/ai_projects/check-list/src/features/diet" --max-warnings 0
node "C:/Users/Saeed/ai_projects/check-list/node_modules/typescript/bin/tsc" -p "C:/Users/Saeed/ai_projects/check-list/tsconfig.app.json" --noEmit
```

Run the targeted Vitest command for both RED and GREEN. Lint must pass for owned files. Typecheck is application-wide: report exact manager/other-feature blockers without editing those files. Do not launch servers or require a browser download; manager handles app-wide browser/integration verification.

## Dependencies, risks and final worker report

Independent of the exercise worker: do not import that feature. Manager must supply installed dependencies, the frozen DB/context/UI/date/format/calculation/chart implementations, profile/settings and route integration. These shared implementation files were not present at planning time. Do not call absent shared implementations a feature success; feature tests may progress against explicit boundary mocks, but integrated verification remains blocked until the real modules arrive.

High-risk boundaries: concurrent `DailyLog` updates across features; food deletion/reference integrity and transaction availability; optional macros represented as zero; null medical targets; current-profile estimates displayed on historical dates; partial/missing calendar buckets; jsdom dialog mocks concealing real focus behavior.

Return only a factual worker report: changed absolute paths; implemented acceptance checklist; actual RED/GREEN commands/exits/output excerpts/counts; scoped lint/typecheck results; any unmet criteria or shared blockers; what the supervisor should verify. No git/commit/deployment/Telegram actions. Final approval belongs to the manager after supervisor evidence review.
