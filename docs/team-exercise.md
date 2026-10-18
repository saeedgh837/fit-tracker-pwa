# Task 2: Exercise feature and feature-owned tests

## Mission and authority

Implement the complete local-first exercise screen for Hamgam: workout CRUD with type/duration/intensity/MET calorie estimate/notes/sets/reps/weight, reusable routine CRUD and use, daily steps, weekly workout goal, personal records, rest-day marking, and weekly training-volume charts. This is one independently reviewable worker assignment, not permission to change shared infrastructure.

Work directly in **C:/Users/Saeed/ai_projects/check-list**, never in a worktree or another checkout. Write only **C:/Users/Saeed/ai_projects/check-list/src/features/exercise/**, including colocated `*.test.ts` and `*.test.tsx`. Required deliverable: **C:/Users/Saeed/ai_projects/check-list/src/features/exercise/ExercisePage.tsx**, default-exporting the route component. Keep reusable feature logic in **C:/Users/Saeed/ai_projects/check-list/src/features/exercise/exerciseLogic.ts** with tests in **C:/Users/Saeed/ai_projects/check-list/src/features/exercise/exerciseLogic.test.ts** and UI/write tests in **C:/Users/Saeed/ai_projects/check-list/src/features/exercise/ExercisePage.test.tsx**. Additional components/services/tests may live only in the same owned directory.

Do not spawn agents, use git, commit, deploy, install/change dependencies, access the network, send Telegram/notifications, edit shared files/tests/configuration, create routes, or add a feature-level date picker. Do not execute the broader implementation plan's git/deployment steps. Application `toast` feedback is allowed; external reporting is not. Report blockers to the manager in the ordinary worker response, without notification tools.

## Read first and integration contract

Read these absolute main-root paths before writing:
- **C:/Users/Saeed/ai_projects/check-list/docs/CONTRACT.md**
- **C:/Users/Saeed/ai_projects/check-list/src/db/types.ts**
- **C:/Users/Saeed/ai_projects/check-list/docs/superpowers/specs/2026-10-18-fit-tracker-design.md**
- **C:/Users/Saeed/ai_projects/check-list/package.json**
- **C:/Users/Saeed/ai_projects/check-list/vitest.config.ts**
- **C:/Users/Saeed/ai_projects/check-list/src/test/setup.ts**

The manager implements ALL frozen shared imports. From top-level feature files consume only their published APIs: `db`, `uid`, `updateDay` from `../../db`; types from `../../db/types`; synchronous reactive `useData` from `../../hooks/useData`; `useUI`, `run`, `toast` from `../../store/ui`; date helpers from `../../lib/dates`; `formatNumber`, `toKg`, `fromKg` from `../../lib/format`; `metCalories` from `../../lib/calculations`; UI primitives from `../../components/ui`; default `DataChart` from `../../components/DataChart`. Adjust relative depth for nested files. Never implement production fallbacks, ambient declarations, copied shared MET tables/conversions, shared API stubs, or a second persistence store.

Relevant frozen shapes:
- `WorkoutType = 'walk'|'run'|'cycle'|'swim'|'strength'|'yoga'|'hiit'|'other'`.
- `Intensity = 'light'|'moderate'|'vigorous'`.
- `ExerciseSet = { name:string; sets:number; reps:number; weightKg:number }`.
- `Routine = { id:string; name:string; type:WorkoutType; duration:number; intensity:Intensity; exercises:ExerciseSet[] }`.
- `WorkoutEntry = { id:string; date:string; type:WorkoutType; duration:number; intensity:Intensity; calories:number; notes:string; exercises:ExerciseSet[] }`.
- Daily steps and `restDay` belong to `DailyLog`; weekly session target belongs to `Profile.workoutGoal`, not to `DailyLog` or settings.
- `metCalories(type,duration,intensity,kg):number` is the sole shared calorie estimator. `updateDay(date,patch)` transactionally merges supplied fields; `run(action,message?):Promise<boolean>` catches/notifies write failures.
- `DataChart` consumes record rows, stable series keys, `title`, optional goals, and `valueFormatter`; it already supplies interaction, legend and a data table.

## Behavior and acceptance

- Read selected ISO day from `useUI().date`; display its workouts with type, minutes, intensity, estimated kcal, notes, and exercise rows. All eight workout types and all three intensity values have understandable Persian labels.
- Implement create/edit/delete with real forms/modals and explicit danger confirmation. Duration is finite positive integer minutes. Exercise rows can be added/removed; every nonempty row requires trimmed name, positive integer sets/reps, and finite nonnegative weight. Zero load is valid for bodyweight work. Empty exercise arrays are valid for cardio or a workout without detailed sets. Reject partial rows, invalid enums, blank required names, negative/nonfinite values and fractional sets/reps. Preserve exercise order; if reordering is offered, provide buttons rather than drag-only controls. Notes remain optional.
- Store duration in minutes, calories in kcal and all loads in canonical kg. Weight inputs/display use `settings.weightUnit`; convert through shared `toKg`/`fromKg` exactly once at the boundary, preserving decimal precision. Label units visibly. A unit switch must not silently reinterpret a dirty form's numeric load: retain the draft's input unit until saved or explicitly convert the draft once.
- Calculate estimated calories with `metCalories` on creation and edits affecting type/duration/intensity. Use the latest measured weight on/before the workout's date, resolving same-date measurements by latest time; otherwise use `profile.startWeightKg`. Never use a future measurement. Label estimates and the MET method; do not add a fictitious editable MET field, hardcode a MET table, or store extra schema fields. Notes/set-only edits preserve the saved estimate. Later profile/weight changes do not silently rewrite historical workout calories. With neither eligible weight nor valid profile starting weight, show an actionable unavailable-estimate state and disable saving a new/recalculated estimate; do not invent a bodyweight or calorie value. Existing records remain readable/editable for unaffected fields/deletable.
- Routine create/read/edit/delete includes name, type, duration, intensity and the same exercise validation. Using a routine opens a new editable workout draft for the selected day; it does not save immediately. Deep-copy exercise rows so draft edits cannot mutate the routine. Saving creates a fresh workout ID. Subsequent routine edits/deletion cannot change any saved workout. Routine deletion requires danger confirmation; no unsupported routine foreign key is added to workouts.
- Provide a selected-day steps form accepting integer values >=0, plus visible current value and successful-save feedback. Save only `updateDay(date,{steps})` through `run`. Missing day displays zero; validation, failure retention and retry are required.
- Provide editable global weekly workout goal stored with a narrow update of profile ID `main` and `workoutGoal` only. Accept integer targets >=0; zero explicitly disables the goal and must not cause division by zero. If no profile exists, explain the prerequisite rather than creating a partial profile. Weekly progress counts saved workout sessions, not unique active days; multiple sessions on one day count separately. Use `settings.weekStartsOn` and the selected day as the as-of cutoff, not today's week. Label the target as the current profile goal because the schema has no historical goal revisions.
- Provide an explicit selected-day rest toggle using only `updateDay(date,{restDay})`. It is independent of missing workouts: no workouts does not imply rest. Marking rest must not delete/hide workouts, exclude them from counts/volume, or overwrite steps/water/notes. If rest and a workout coexist, show both honestly with a clear explanatory status rather than mutating data silently.
- Personal records are derived from saved workouts dated <= selected day, never routines or future logs. Define the displayed record clearly as greatest recorded load per exercise, not estimated one-rep max. Group exercise names by trimmed/collapsed whitespace and Persian ی/ک normalization; retain a readable display name. Choose ties deterministically and display date, load, reps and sets. Zero-load rows remain valid but are not a weighted-load record. Editing/deleting a workout recomputes records; never persist stale PR badges.
- Provide weekly weighted-volume and rest-day charts for eight calendar weeks ending in the selected day's week. Bucket using `startOfWeek(date, settings.weekStartsOn)`, `addDays`, `dateRange`, clipping the last week at the selected day; exclude future entries. Volume is sum of `sets * reps * weightKg` across saved exercise rows, labeled kg × repetitions, or lb × repetitions after one display conversion. Example: 3 sets × 10 reps × 20 kg = 600 kg × repetitions. Do not substitute workout count, duration or MET kcal for volume. Bodyweight rows contribute zero load-volume, while the workout still counts toward session progress. Rest chart counts explicit `restDay` flags, not absent workouts. Missing records are not invented rest days; distinguish unrecorded buckets from recorded zero where possible and explain incomplete logging. No synthetic rows pretending to be user measurements; all-empty ranges have actionable empty states. Date labels use shared locale helpers, while ISO keys stay stable.
- All writes go through `run`; preserve drafts/dialogs on failure, announce an understandable Persian error and allow retry. Close/reset only after success; prevent accidental double submission. New workout drafts capture and visibly show their selected date. Edits preserve the original ID/date, even if global selected day changes while a dialog is open.
- Use shared `PageHeader`, `Card`, `Field`, `Modal`, `Confirm`, `Button`/`IconButton`, `EmptyState`, `Progress`, and `DataChart` with their exact published props. Confirm uses `danger` for deletion. Persian formal-friendly copy, correct نیم‌فاصله and ی/ک, inherited RTL, logical spacing, locale-aware numbers/dates, isolated Latin fragments, semantic light/dark tokens and responsive layout are mandatory. Visible accessible labels, keyboard-operable forms/dialogs, focus restoration, announced errors, minimum 44px targets and native numeric inputs with meaningful min/step/validation are acceptance requirements. Do not add external fonts/assets or hardcoded light-only surfaces.

## Test-first execution and evidence

The installed stack is React/TypeScript, Vitest/jsdom, Testing Library and fake IndexedDB. Tests must be colocated under the owned feature directory because the current configuration includes only `src/**/*.test.{ts,tsx}`. Test actual production feature logic, not a duplicate implementation in tests. Local test fixtures/mocks for contract boundaries are allowed; they do not prove real shared integration.

For each behavior batch: write tests first, run genuine RED, implement the minimum feature code, run GREEN, then refactor and rerun. A missing tool/package/shared module is a blocker, not intended RED. If necessary, add only a minimal importable unimplemented signature so assertions fail on the missing behavior. Preserve actual commands, failing assertion excerpts, exit codes and final test counts in the worker response; do not manufacture pre-implementation failures after implementing.

Required coverage:
- Validation for workouts, routine drafts and exercise rows, including zero load, empty rows, invalid enums, NaN/Infinity, fractional sets/reps, duration and steps bounds.
- Shared estimator called with correct type/minutes/intensity/canonical weight; latest eligible historical weight, same-date time tie, profile fallback, unavailable weight, no future-weight leakage, and notes-only estimate preservation. Use real `metCalories` integration when available; a mocked return is not evidence that the shared MET formula is correct.
- Workout/routine create/edit/delete, cancel/confirm destructive actions, routine deep-copy/use with new workout ID, library edits not mutating previous workouts, and failed-save draft retention.
- lb/kg round-trip conversion with decimals and dirty-form unit switching; canonical persisted loads and correctly converted volume/record display.
- Exact weekly volume arithmetic (including the 600 example), multiple sessions per day, PR normalization/ties/recalculation after deletion, and no contribution from future logs or routine templates.
- Steps/rest narrow patches preserve other daily fields; rest/workout coexistence; goal updates preserve unrelated profile fields; zero/missing-profile goal behavior.
- Saturday/nondefault week starts, month/year boundaries, partial weeks, historic selected dates, null/empty chart buckets, rest counts and chart input rows rather than only chart presence.
- Persian accessible labels, RTL container, dialog/confirmation interactions, keyboard access and empty/error states. Exercise real fake-IndexedDB write integration when manager modules exist; label boundary mocks honestly.

Commands (run in main root; no install/network):
```sh
npm --prefix "C:/Users/Saeed/ai_projects/check-list" run test -- src/features/exercise --reporter=verbose
node "C:/Users/Saeed/ai_projects/check-list/node_modules/eslint/bin/eslint.js" --config "C:/Users/Saeed/ai_projects/check-list/eslint.config.js" "C:/Users/Saeed/ai_projects/check-list/src/features/exercise" --max-warnings 0
node "C:/Users/Saeed/ai_projects/check-list/node_modules/typescript/bin/tsc" -p "C:/Users/Saeed/ai_projects/check-list/tsconfig.app.json" --noEmit
```
Run the targeted Vitest command for both RED and GREEN. Lint must pass for owned files. Typecheck is application-wide: report exact manager/other-feature blockers without editing those files. Do not launch servers or require a browser download; manager handles app-wide browser/integration verification.

## Dependencies, risks and final worker report

Independent of the diet worker: do not import that feature. Manager must supply installed dependencies, the frozen DB/context/UI/date/unit/MET/chart implementations, profile/settings and route integration. These shared implementation files were not present at planning time. Do not call absent shared implementations a feature success; feature tests may progress against explicit boundary mocks, but integrated verification remains blocked until the real modules arrive.

High-risk boundaries: daily-field concurrency with diet/journal; canonical load conversions and unsaved-unit switches; historical weight selection and frozen calorie estimates; undefined medical/bodyweight inputs; routine shallow copies; PR ties/name normalization; confusing rest/unrecorded days or workout count/weighted volume; current goals shown on historical weeks; jsdom dialog mocks concealing real focus behavior.

Return only a factual worker report: changed absolute paths; implemented acceptance checklist; actual RED/GREEN commands/exits/output excerpts/counts; scoped lint/typecheck results; any unmet criteria or shared blockers; what the supervisor should verify. No git/commit/deployment/Telegram actions. Final approval belongs to the manager after supervisor evidence review.
