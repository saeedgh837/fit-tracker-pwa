# Hamgam / Fit Tracker PWA design

## Intent and constraints
Build the complete mobile-first personal fitness checklist requested on 2026-10-18. No backend, accounts, telemetry, external fonts or remote health-data services. Public repository contains code and synthetic demo data only. User explicitly authorized autonomous decisions, public repository creation, commits, push and GitHub Pages deployment, and requested no questions.

## Product decisions
- Persian product name: همگام. Calm teal identity (#087f80), glacier background (#f2f7fa), navy text (#16324a), blue charts (#2a78d6) with orange trend (#eb6834). White light surfaces and blue-slate dark surfaces. Vazirmatn self-hosted.
- Five bottom tabs: Today, Checklist, Health, Reports, Settings. Health has Weight, Diet, Exercise and Journal subroutes; every module has a direct hash link.
- Large quiet cards, a distinctive orbit-style daily completion panel, meaningful activity icons, persistent date navigation, accessible bottom sheets, obvious save/delete controls, data tables alongside charts, reduced-motion support.
- Store local calendar dates as YYYY-MM-DD and canonical kg/cm, convert units at display/input boundaries. Use Intl Persian calendar for display, ISO date inputs for reliable native entry. Default week starts Saturday.
- Adults-only nutritional calculator, Mifflin-St Jeor, activity multipliers, floor 1200/1500 kcal and max 1% bodyweight weekly pace; estimates clearly labeled, not medical advice. User may record data without granting any permission.
- Dexie relational tables with stable IDs and reactive reads; Zustand only ephemeral UI state. Atomic full JSON replacement with strict schema validation, integrity checks and explicit confirmation. CSV export excludes photos; JSON includes locally compressed images. Storage persistence requested only after user action.
- PWA precaches app/fonts/assets and lazy chunks, update prompt avoids interrupting unsaved work. Android install prompt where supported, explicit Safari iOS instructions.
- Demo inserts synthetic data only after confirmation and preserves real data by refusing nonempty datasets. Reset explicitly confirms destruction and recommends backup.

## Coverage
Three-step onboarding; daily dashboard; customizable scheduled/target habits, order/archive/streaks/heatmap; weight/trend/BMI/ETA/measurements; food library/favorites/recent/meals/macros/adherence/water; workouts/MET/sets/routines/steps/records/rest/volume; sleep/mood/energy/journal/photos/compare; weekly/monthly reports/correlations/badges; all locale/theme/unit/profile/reminder/backup/install settings; PWA, CI, documentation and deployment.

## Delivery and verification
At least eight logical Conventional Commits. Test pure calculations and local persistence/backup boundaries with Vitest and fake IndexedDB. Lint, typecheck, tests and production build must pass. Exercise browser flows at mobile and desktop widths, dark mode, persistence, offline production assets and installability. Run Lighthouse where available; report measured scores rather than claiming the target untested. Publish only after verification and independent review.
