# Frozen feature integration contract

Root: C:/Users/Saeed/ai_projects/check-list. All writers own only assigned feature directories and feature-specific tests. Do not change dependencies, DB schema, shared files, routes or git. Manager commits and deploys. Full types: src/db/types.ts (read it).

## Shared imports (manager implements)
- `import { db, uid, updateDay, changeWater, saveHabit, setHabitValue, removeHabit } from '../../db'` (db/index.ts). Dexie tables: `profiles` (Profile id main), `settings` (Settings id main), `habits`, `habitLogs`, `days` (key date), `weights`, `measurements`, `foods`, `meals`, `workouts`, `routines`, `photos`. All except days use string id keys. Typed put/add/update/delete/toArray/where methods. `uid(): string`.
- `updateDay(date: string, patch: Partial<Omit<DailyLog,'date'>>): Promise<void>` transactional read/merge, default zero/null day. `changeWater(date, deltaMl): Promise<void>` clamps >=0 with transaction.
- `saveHabit(habit: Habit): Promise<void>` preserves prior historical configuration effective on old dates. `setHabitValue(habit: Habit,date:string,value:number):Promise<void>` upserts unique habit/date snapshot target. `removeHabit(id): Promise<void>` deletes habit and its logs in transaction (explicit user confirmation first).
- `import { useData } from '../../hooks/useData'`: synchronous AppData from context; root handles loading/errors. Live reactive updates from Dexie. Photos are NOT in AppData, query with `useLiveQuery` locally.
- `import { useUI, toast, run } from '../../store/ui'`: Zustand hook with `date:string, setDate(date), quickAdd:boolean, setQuickAdd(boolean)`. `toast(message:string,kind?:'success'|'error'):void`. `run(action:()=>Promise<unknown>,message?:string):Promise<boolean>` catches errors and notifies; pass writes through run to avoid unhandled rejections.
- `import { today, addDays, daysBetween, weekday, startOfWeek, dateRange, formatDate, shortDate, isISODate } from '../../lib/dates'`.
  `today():ISODate` local not UTC; `addDays(date,amount):ISODate`; `daysBetween(from,to):number`; `weekday(date):number` Sunday=0; `startOfWeek(date,weekStartsOn=6):ISODate`; `dateRange(start,end):ISODate[]` inclusive; `formatDate(date,settings,options?:Intl.DateTimeFormatOptions):string`; `shortDate(date,settings):string`; `isISODate(x):boolean` validates actual day.
- `import { formatNumber, toKg, fromKg, toCm, fromCm } from '../../lib/format'`. `formatNumber(n,settings,decimals=0):string`, `toKg(value,unit)`, `fromKg(kg,unit)`, `toCm(value,unit)`, `fromCm(cm,unit)`.
- Calculations in `../../lib/calculations`:
  `nutritionTargets(profile:Profile,weightKg?:number):{bmr:number;tdee:number;calories:number;protein:number;carbs:number;fat:number;paceKg:number;limited:boolean}|null` specialCondition => null.
  `movingAverage(entries:WeightEntry[],windowDays=7):Array<{date:string;weightKg:number;trend:number}>` groups same-date entries, last time wins; date-window not sample count.
  `estimateGoalDate(entries,goalKg,asOf=today()):string|null` >=7 elapsed days, recent 30d, correct direction only.
  `bmi(kg,cm):number`; `metCalories(type:WorkoutType,duration:number,intensity:Intensity,kg:number):number`.
  `habitAtDate(habit,date):HabitConfig|undefined`, `isHabitScheduled(habit,date):boolean`, `habitStreak(habit,logs,asOf):number`, `bestHabitStreak(habit,logs,asOf):number`, `dayCompletion(habits,logs,date):{done:number;total:number;percent:number}`, `dayStreak(habits,logs,asOf):number`.
- UI from `../../components/ui`:
  `Card({children,className?,...HTMLAttributes<HTMLElement>})`, `PageHeader({title:string,subtitle?:string,action?:ReactNode})`.
  `Button({variant?:'primary'|'secondary'|'ghost'|'danger',className?,...ButtonHTMLAttributes})` default type button.
  `IconButton({label:string,children,...ButtonHTMLAttributes})` min44.
  `Field({label:string,hint?:string,children,className?})` wraps label; child input has required accessible label via wrapping.
  `Modal({open:boolean,onClose:()=>void,title:string,children})` accessible focus-trapped native dialog; use form inside.
  `EmptyState({icon?:LucideIcon,title:string,description:string,action?:ReactNode})`.
  `Progress({value:number,max:number,label:string,color?:string})`; `Stat({label:string,value:ReactNode,detail?:ReactNode,icon?:LucideIcon})`.
  `Segments<T extends string>({value:T,onChange:(v:T)=>void,options:{value:T;label:string}[],label:string})`.
  `Confirm({open,onClose,onConfirm:()=>void,title:string,description:string,danger?:boolean})`.
- `import DataChart from '../../components/DataChart'`: default component props `{data: Record<string,string|number|null>[], xKey?:string(default 'label'), series:{key:string;label:string;color?:string;dashed?:boolean;type?:'line'|'bar'}[], goal?:number, goalLabel?:string, height?:number, valueFormatter?:(n:number)=>string, title:string}`. Fully interactive Recharts + legend + table. Default series color first blue second orange, separately selected dark tokens. Key names stable not repainted on filter.

## Feature exports / router
Default export React component from:
- `src/features/habits/HabitsPage.tsx`
- `src/features/weight/WeightPage.tsx`
- `src/features/diet/DietPage.tsx`
- `src/features/exercise/ExercisePage.tsx`
- `src/features/journal/JournalPage.tsx`
No route setup or feature header date picker; shared Layout owns current selected day. Each component reads date from useUI. Responsive grid classes `grid gap-4 lg:grid-cols-2`, CSS `.card`, `.stack`, `.row`, `.muted`, `.metric`, `.badge`, `.input`, `.section-title`, `.form-grid` available plus Tailwind. Use semantic theme variables, no hardcoded light-only backgrounds. Numeric HTML inputs native `type=number` with step/min/max, accessible visible labels. Store canonical kg/cm, convert at boundary for unit setting. Dates ISO internally; format labels with shared helpers. Labels formal-but-friendly Persian, ZWNJ, no Arabic ي/ك. Lucide icons not emoji. No network access. Touch targets >=44px; charts have empty states (don't invent user's data). Buttons for reorder, not drag-only. Dangerous deletes explicitly confirm. Forms validate and keep data on failed save. Tests FIRST using Vitest and real pure logic; report RED and GREEN commands. Full spec docs/superpowers/specs/2026-10-18-fit-tracker-design.md.
