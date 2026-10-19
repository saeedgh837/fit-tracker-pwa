# Hamgam color system

## Direction and references

**Cobalt-led actions, warm apricot/coral accents, and quiet neutral surfaces.** The goal is a clearer daily dashboard with more warmth, not a different saturated color on every card. The Persian UI, self-hosted font, RTL layout, storage schema, and existing habit-color values are unchanged.

References inspected during the redesign:

- [Color Hunt blue/cyan/citrus palette](https://colorhunt.co/palette/2373f4578ef565d0f4f2f7a0): inspiration for a stronger blue focal point and a warm counter-accent.
- [Color Hunt warm coral palette](https://colorhunt.co/palette/a14646da6556eb895bfdb773): inspiration for warmth in food/activity details.
- [Happy Hues 17](https://www.happyhues.co/palettes/17): inspected the actual background, headline, paragraph, button, and illustration roles; useful as a role-assignment example rather than a palette to copy verbatim.
- [Happy Hues 14](https://www.happyhues.co/palettes/14): a secondary reference for dark ink with restrained bright accents.

Pinterest did not expose usable pin imagery anonymously in this research session. The advisor supplied alternatives; Color Hunt and Happy Hues provided usable references. Coolors did not yield a verified extracted palette. These sources are inspiration, not evidence of a uniquely “best” palette or a year-specific trend.

The advisor approved the cobalt direction, reviewed the measured representative-dashboard implementation, and required independent light/dark checks. Screenshot inspection was performed by the implementing operator; the text-only advisor received the implementation and measured evidence, not the images themselves.

## Semantic roles

The source of truth is [`src/styles.css`](../src/styles.css). Values are deliberately different between modes; dark mode is not a filter over light mode.

| Role                       | Light     | Dark      |
| -------------------------- | --------- | --------- |
| Page                       | `#f5f7fc` | `#101827` |
| Card                       | `#ffffff` | `#192338` |
| Soft surface               | `#eef2fa` | `#222f47` |
| Body ink                   | `#18243d` | `#edf3ff` |
| Secondary ink              | `#505e76` | `#b6c4dd` |
| Primary fill               | `#255cdb` | `#8bb4ff` |
| Primary hover / strong ink | `#1e46ac` | `#adcaff` |
| On primary                 | `#ffffff` | `#102346` |
| Teal category ink          | `#0b6b63` | `#75ddc6` |
| Blue category ink          | `#244fb7` | `#a7c6ff` |
| Orange category ink        | `#963b1f` | `#ffb38c` |
| Violet category ink        | `#6840a6` | `#d0b2ff` |
| Rose category ink          | `#a12f5b` | `#ffa9ca` |
| Destructive fill           | `#b42338` | `#ff9fac` |
| On destructive             | `#ffffff` | `#421321` |
| Essential control boundary | `#79869d` | `#7f91b0` |

Each category has an explicit `*-soft` surface. Do not recreate these by applying opacity to the ink. `teal` is independent of `primary`: previously stored teal habits must remain teal after the brand changes to cobalt.

- `--line` is decorative. Inputs, outlined buttons, and other essential boundaries use `--control-line`.
- Primary and destructive fills always use their dedicated foreground, including dark mode. White on the dark theme's pale-blue primary is not readable.
- The hero and onboarding illustration use dedicated gradient stops, white main text, and full-opacity `--hero-muted`. Hero keyboard focus is white, not cobalt.
- Numeric progress remains visible independently of the amber ring. The heatmap uses an ordered single-blue scale and retains date/value labels.
- Category identity is not success/error. Destructive actions retain explicit wording, icons, and confirmation.
- Active navigation and selected segments have an additional visible indicator; their state is not conveyed only by a slight tint change.

## Charts

Stable identity order is cobalt, coral, teal:

| Slot | Light     | Dark      |
| ---- | --------- | --------- |
| 1    | `#255cdb` | `#3984e6` |
| 2    | `#c24a30` | `#d76542` |
| 3    | `#00866f` | `#009e80` |

All three marks clear 3:1 against the chart surface. The local dataviz validator passed its all-pairs lightness/chroma, normal-vision, protanopia and deuteranopia gates for both modes. **Tritanopia separation is weaker**; do not describe this as universal color-vision certification. Existing multi-series charts use different line/mark geometry, matching labeled legends, tooltips and an accessible data table. The third line also uses a distinct short-dash pattern. Do not add more overlapping series or remove those alternative cues without another review.

## Regression checks

```bash
npm run test:contrast
```

Reads shipped CSS directly and checks 67 role pairs per mode: normal text at 4.5:1, essential boundaries/focus/graphics at 3:1, hero stops, hover foregrounds, category tints, heatmap text, and chart marks. Missing or non-opaque required tokens fail rather than silently skipping a check. This is a targeted regression audit, not a complete WCAG conformance claim.

```bash
npm run test:e2e
```

Uses a production root build in an isolated browser profile. Theme tests cover both modes at 375px and 1440px, actual computed color pairs, all eight routes with demo data, chart rendering, overflow, inverse focus, saved-theme reload and theme metadata. PWA tests retain first-visit registration, offline routes and lazy-chart coverage. Screenshots are produced under the ignored `test-results/` directory.

```bash
node scripts/generate-icons.mjs
```

Regenerates favicon, regular icons, Apple icon and maskable icon using the cobalt/amber identity. Manifest startup background and runtime browser chrome match the page background. Browsers and operating systems may refresh installed icons on their own schedule; native iOS/Android home-screen appearance and a real existing installation's OS-managed icon update still need device verification. The redesign does not change service-worker update prompting, app identity, scope, start URL, domain, or local data origin.
