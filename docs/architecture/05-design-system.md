# 5. Apple-Style Design System Specifications

The goal is a product that feels native to macOS/iOS conventions without pretending to
be an Apple app. Everything below is expressed as CSS custom properties in
`apps/web/src/styles/theme.css`, consumed by Tailwind v4 utilities, hand-written CSS,
and the Web Animations API alike.

## 5.1 Color

Values are Apple's published system colors (iOS 13+ semantic palette). Ship them as
tokens, not as literals scattered through components.

```css
/* One declaration per token. `light-dark()` resolves against the element's used
   `color-scheme`, so the explicit toggle and the system preference are handled by the
   SAME declaration — no duplicated dark block, no token defined only inside a media
   query. Baseline: Chrome 123+, Safari 17.5+, Firefox 120+. */
:root                      { color-scheme: light dark; }
:root[data-theme="light"]  { color-scheme: light; }
:root[data-theme="dark"]   { color-scheme: dark; }

@theme {
  /* --- Accent / semantic:          light        dark      --- */
  --color-blue:   light-dark(#007aff,    #0a84ff);
  --color-green:  light-dark(#34c759,    #30d158);
  --color-red:    light-dark(#ff3b30,    #ff453a);
  --color-orange: light-dark(#ff9500,    #ff9f0a);
  --color-yellow: light-dark(#ffcc00,    #ffd60a);
  --color-indigo: light-dark(#5856d6,    #5e5ce6);
  --color-purple: light-dark(#af52de,    #bf5af2);
  --color-pink:   light-dark(#ff2d55,    #ff375f);
  --color-teal:   light-dark(#30b0c7,    #40c8e0);

  /* --- Grays (Apple systemGray 1–6; the scale inverts in dark) --- */
  --color-gray-1: light-dark(#8e8e93,    #8e8e93);
  --color-gray-2: light-dark(#aeaeb2,    #636366);
  --color-gray-3: light-dark(#c7c7cc,    #48484a);
  --color-gray-4: light-dark(#d1d1d6,    #3a3a3c);
  --color-gray-5: light-dark(#e5e5ea,    #2c2c2e);
  --color-gray-6: light-dark(#f2f2f7,    #1c1c1e);

  /* --- Backgrounds --- */
  --bg-primary:   light-dark(#ffffff,    #000000);
  --bg-secondary: light-dark(#f2f2f7,    #1c1c1e);
  --bg-tertiary:  light-dark(#ffffff,    #2c2c2e);

  /* --- Labels: Apple specifies these as alphas, not solids, so they compose
         correctly over materials --- */
  --label-primary:    light-dark(rgb(0 0 0 / 1),          rgb(255 255 255 / 1));
  --label-secondary:  light-dark(rgb(60 60 67 / 0.60),    rgb(235 235 245 / 0.60));
  --label-tertiary:   light-dark(rgb(60 60 67 / 0.30),    rgb(235 235 245 / 0.30));
  --label-quaternary: light-dark(rgb(60 60 67 / 0.18),    rgb(235 235 245 / 0.16));
  --separator:        light-dark(rgb(60 60 67 / 0.29),    rgb(84 84 88 / 0.65));
  --separator-opaque: light-dark(#c6c6c8,                 #38383a);

  /* --- Materials (translucent chrome) --- */
  --material-thin:    light-dark(rgb(255 255 255 / 0.55), rgb(30 30 32 / 0.55));
  --material-regular: light-dark(rgb(255 255 255 / 0.72), rgb(30 30 32 / 0.72));
  --material-thick:   light-dark(rgb(255 255 255 / 0.88), rgb(30 30 32 / 0.88));
  --material-blur:    20px;
  --material-sat:     180%;
}
```

`body` must paint `--bg-primary` explicitly — an unpainted body inherits the host's
ground and breaks in one of the two themes.

### Game-semantic colors

Board state must never be encoded by hue alone (≈8% of men have a red/green color
vision deficiency, and hit/miss is the single most important distinction in the game).

| State | Fill | Shape | Notes |
|---|---|---|---|
| Unknown | `--bg-tertiary` | — | Subtle 1px `--separator` grid lines |
| Miss | `--color-gray-2` | Small filled **circle**, 22% of cell | Peg metaphor |
| Hit | `--color-red` | Filled **rounded square** with a 4-point burst | Distinct silhouette, not just color |
| Sunk | `--color-red` @ 0.35 fill + solid outline | Outline traces the whole ship | Ship-shaped, obvious at a glance |
| Own ship (intact) | `--color-gray-4` | Continuous rounded capsule | Ship spans cells; do not draw per-cell |
| Own ship (hit) | `--color-orange` | Capsule segment | |
| Legal drop target | `--color-blue` @ 0.18 | — | |
| Illegal drop target | `--color-red` @ 0.18 | — | |
| Last shot | `--color-blue` 2px ring, 1.2 s pulse | — | Draws the eye to what just changed |

Contrast target: **WCAG 2.2 AA (4.5:1) for text, 3:1 for UI state indicators**, verified
in both themes by an automated axe pass in CI. Note that `--label-secondary` on
`--bg-secondary` sits close to the line; use `--label-primary` for anything a player
must read under time pressure (turn timer, coordinates).

## 5.2 Typography

**SF Pro cannot be self-hosted.** Apple's font license permits use in UI mockups and on
Apple platforms, not redistribution as a web font. So:

```css
@theme {
  --font-sans:
    -apple-system, BlinkMacSystemFont,       /* real SF Pro on Apple devices */
    "SF Pro Text", "SF Pro Display",
    "Inter Variable", Inter,                 /* self-hosted fallback, woff2, subset */
    "Segoe UI Variable Text", "Segoe UI",
    system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
}
html { font-optical-sizing: auto; -webkit-font-smoothing: antialiased; }
```

On Apple hardware this renders in genuine SF Pro at zero bytes. Elsewhere, Inter
Variable is the closest widely-licensed neo-grotesque; its `opsz` axis approximates SF's
Text/Display optical split when `font-optical-sizing: auto` is set. Self-host Inter with
`unicode-range` subsetting (Latin + Latin-Ext ≈ 28 KB woff2) and `font-display: swap`.

### Type scale (iOS Dynamic Type, "Large" default)

| Token | Size / Line height | Weight | Use |
|---|---|---|---|
| `--text-large-title` | 34 / 41 px | 700 | Landing hero |
| `--text-title-1` | 28 / 34 | 700 | "Your Turn" / result screen |
| `--text-title-2` | 22 / 28 | 600 | Section headers |
| `--text-title-3` | 20 / 25 | 600 | Card titles |
| `--text-headline` | 17 / 22 | 600 | Emphasis in body |
| `--text-body` | 17 / 22 | 400 | Default |
| `--text-callout` | 16 / 21 | 400 | Secondary panels |
| `--text-subhead` | 15 / 20 | 400 | Labels |
| `--text-footnote` | 13 / 18 | 400 | Hints |
| `--text-caption-1` | 12 / 16 | 400 | Grid coordinates |
| `--text-caption-2` | 11 / 13 | 400 | Legal |

Tracking: SF applies positive tracking below ~20 pt and negative above it. Approximate
with `letter-spacing: 0.012em` for ≤17 px styles and `-0.021em` for ≥28 px. These are
approximations of Apple's per-size table, not the exact values.

Numeric UI (timer, shot counter, room code) uses
`font-variant-numeric: tabular-nums slashed-zero` so digits do not reflow as they tick.
The room code additionally uses `--font-mono` with wide `letter-spacing: 0.16em`.

## 5.3 Materials, elevation, and shape

```css
.material-regular {
  background: var(--material-regular);
  backdrop-filter: blur(var(--material-blur)) saturate(var(--material-sat));
  -webkit-backdrop-filter: blur(var(--material-blur)) saturate(var(--material-sat));
  border: 0.5px solid var(--separator);
}
@supports not (backdrop-filter: blur(1px)) {
  .material-regular { background: var(--bg-secondary); }   /* opaque fallback */
}
```

**Performance rules for glass, which are not optional:**

1. **At most 3 backdrop-filtered layers on screen at once** (nav bar, active sheet,
   HUD). Each one forces an offscreen render pass of everything behind it.
2. **Never apply `backdrop-filter` to grid cells.** 100 blurred elements will drop a
   mid-range laptop below 30 fps. The board sits *behind* glass, it is not made of it.
3. **Never animate a property on a blurred element** other than `opacity` and
   `transform`; animating `backdrop-filter` itself re-renders the blur every frame.
4. Blurred containers get `contain: paint` and `transform: translateZ(0)` to bound the
   composited region.

Corner radii follow Apple's continuous-corner convention approximated with
`border-radius`:

| Token | Value | Use |
|---|---|---|
| `--radius-cell` | 6px | Grid cells |
| `--radius-control` | 12px | Buttons, inputs |
| `--radius-card` | 20px | Panels |
| `--radius-sheet` | 28px (top corners only) | Modal sheets |
| `--radius-capsule` | 999px | Segmented control, pills |

Shadows are soft and low-contrast — Apple's depth comes from material and radius, not
drop shadows:
`--shadow-card: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06);`
In dark mode, shadows are nearly invisible; substitute a `0.5px` `--separator` hairline.

## 5.4 Board and layout specifications

```css
.board {
  display: grid;
  grid-template-columns: var(--gutter) repeat(10, minmax(0, 1fr));
  grid-template-rows:    var(--gutter) repeat(10, minmax(0, 1fr));
  gap: clamp(2px, 0.5cqw, 4px);
  --gutter: clamp(18px, 4cqw, 28px);          /* A–J / 1–10 labels */
  container-type: inline-size;
  aspect-ratio: 1;
  width: min(100%, 560px);
}
.cell { aspect-ratio: 1; border-radius: var(--radius-cell); }
```

- **Touch targets.** Apple's HIG minimum is 44×44 pt. A 10×10 grid at 44 pt is 440 pt
  wide, which does not fit a 390 pt iPhone viewport. Resolution: the *active* (firing)
  board is rendered large — cells ≥ 32 px — and augmented with a **magnifier loupe**: on
  touch-and-hold, a floating enlarged preview of the target cell follows the finger and
  the shot commits on release. This is the same pattern iOS uses for text cursor
  placement, and it makes sub-44 pt targets reliably hittable. The opponent's-view board
  (your own fleet) is rendered small and is non-interactive during play.
- **Two-board layout.** ≥1024 px: side by side, active board 1.35× the size of the
  reference board. 768–1023 px: stacked, active on top. <768 px: single board with a
  segmented control to swap views, plus a persistent 88 px mini-map of the inactive
  board so the player never loses context.
- **Safe areas.** `padding: max(16px, env(safe-area-inset-*))` on the app shell for
  notched devices and iPad Stage Manager.
- Coordinate labels are `--text-caption-1` in `--label-tertiary`, `aria-hidden` (screen
  readers get the full cell label from the button's accessible name).

## 5.5 Motion

Apple's animation language is **spring physics**, not duration-plus-easing. UIKit
parameterizes springs by `response` (perceived duration) and `dampingRatio`. Convert to
the stiffness/damping/mass that Motion and WAAPI want:

```ts
// packages/ui/src/motion/spring.ts
/** Apple UISpringTimingParameters(response, dampingRatio) -> Motion spring config. */
export function appleSpring(response: number, dampingRatio: number, mass = 1) {
  const omega = (2 * Math.PI) / response;         // undamped natural frequency
  return {
    type: 'spring' as const,
    mass,
    stiffness: mass * omega * omega,              // k = m·ω²
    damping: 2 * dampingRatio * mass * omega,     // c = 2ζ·√(k·m) = 2ζ·m·ω
  };
}

export const SPRING = {
  /** Buttons, toggles, small state changes. */
  snappy:  appleSpring(0.30, 0.86),   // ≈ { stiffness: 439, damping: 36 }
  /** Cards, sheets, board transitions. */
  smooth:  appleSpring(0.45, 1.00),   // ≈ { stiffness: 195, damping: 28 }  (no overshoot)
  /** Playful: ship snap-to-grid, victory badge. */
  bouncy:  appleSpring(0.40, 0.65),   // ≈ { stiffness: 247, damping: 20 }
} as const;
```

For CSS-driven animations where a spring is unavailable, use these approximations:

```css
@theme {
  --ease-standard: cubic-bezier(0.25, 0.1, 0.25, 1);      /* Apple default curve */
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);         /* enter */
  --ease-in:       cubic-bezier(0.7, 0, 0.84, 0);         /* exit */
  --dur-micro: 120ms;  --dur-fast: 200ms;  --dur-base: 320ms;  --dur-slow: 480ms;
}
```

### Motion inventory

| Interaction | Spec |
|---|---|
| Button press | `scale(0.96)` in `--dur-micro`, release with `SPRING.snappy`. Pointer-down, not click |
| Cell hover (pointer only) | `scale(1.06)`, `--dur-micro`, `--ease-out`; ring in `--color-blue` @ 40% |
| Ship drag | Motion `drag` with `dragMomentum: false`; ghost at 60% opacity; snaps to nearest legal cell with `SPRING.bouncy` |
| Illegal drop | 3-cycle horizontal shake, ±6 px, 240 ms total, `--ease-standard` |
| Shot: miss | Peg scales 0 → 1 with `SPRING.snappy`, plus a 300 ms radial water ripple (single `element.animate()`, `opacity` + `transform` only) |
| Shot: hit | Cell flashes `--color-red` at 200 ms, 4-point burst scales 0 → 1.2 → 1, board shakes 4 px for 180 ms |
| Ship sunk | Sequential 60 ms-staggered pulse along the ship's cells, then the outline draws in via `stroke-dashoffset` over 420 ms |
| Turn change | Active board's border color crossfades 300 ms; inactive board desaturates to `filter: saturate(0.4) opacity(0.7)` |
| Phase transition | `AnimatePresence` crossfade + 12 px vertical slide, `SPRING.smooth` |
| Sheet present | Slides from bottom with `SPRING.smooth`; background scales to 0.94 and dims — the iOS modal presentation |
| Victory | Confetti burst (canvas, 1200 ms, auto-cleanup), stat card enters with `SPRING.bouncy`, staggered 80 ms |

### "Haptic-like" feedback — stated accurately

The Vibration API (`navigator.vibrate`) works on Android Chrome/Firefox. **iOS Safari
does not implement it**, and there is no supported workaround (the widely-shared
`<input type="checkbox" switch>` trick is not a general-purpose haptics API). Therefore:

```ts
export function feedback(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error') {
  if (prefersReducedMotion()) return;
  navigator.vibrate?.(VIBRATION_PATTERNS[kind]);   // no-op on iOS, by design
  playTick(kind);                                  // WebAudio: 8–40 ms envelope
  // Visual component is handled by the caller's transform animation.
}
```

The perceived "haptic" quality on iOS comes from the **combination of a sub-120 ms scale
transform and a short WebAudio transient**, not from hardware. Say this in the code
comment so nobody later "fixes" the missing iOS vibration.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` is honored globally, not per component:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

...and in JS, `MotionConfig reducedMotion="user"` plus a guard in `feedback()`. Critical
state changes (hit/miss/sunk) remain communicated by **color + shape + text**, so nothing
is conveyed by animation alone.

## 5.6 Theme switching

Three states: `light`, `dark`, `system` (default). Persist to `localStorage` in a
try/catch, apply before first paint to avoid a flash:

```html
<!-- inlined in index.html <head>, before any stylesheet -->
<script>
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (_) {}
</script>
```

The `color-scheme` rules in §5.1 do the rest: setting `data-theme` flips every
`light-dark()` token *and* the UA styling of scrollbars, form controls, and the
browser's own chrome, in one declaration. The toggle is a 3-position segmented control
(Radix `ToggleGroup`) styled as an iOS segmented control, with the moving pill animated
via Motion's `layoutId`.

## 5.7 Accessibility (non-negotiable)

- Every cell is a real `<button>` inside a `role="grid"`, with
  `aria-label="D4, unknown"` / `"D4, hit, battleship sunk"`. Screen-reader users can
  play the game.
- Full keyboard play: arrow keys move a roving `tabindex` focus, `Enter`/`Space` fires,
  `R` rotates the held ship during placement, `Esc` cancels a drag.
- Shot results are announced through an `aria-live="assertive"` region; turn changes
  through `aria-live="polite"`.
- Focus rings use `:focus-visible` with a 3 px `--color-blue` outline at 2 px offset —
  visible in both themes, never suppressed.
- Target: axe-core clean, and manual VoiceOver + NVDA passes before release (Phase 6).
