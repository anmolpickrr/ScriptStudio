# ScriptStudio design system

The interface a crew lead can scan in a second and a beginner can use without a manual. One bold element per
screen, quiet glass everywhere else. Tokens live in `frontend/src/styles.css` (`:root` for Day, `[data-theme="dark"]`
for Night); the v9 layer at the end of that file holds the components below.

## Colour

| Token | Day | Night | Use |
|---|---|---|---|
| `--cobalt` (violet) | `#6953da` | `#9c8be7` | Primary: actions, the active nav item, the composer, the "Ready" tile |
| `--ink` | `#131315` | `#131315` | Anchors: nav pill, logo chip, Write button, selected toggles (Day) |
| `--mint` (lime) | `#ddff00` | `#ddff00` | Write button, active nav, Ready tile, success |
| `--sky` | `#dce6ff` | cobalt 14% | Drafts tile |
| `--lilac` | `#e6e0ff` | violet 16% | In-progress tile |
| `--apricot` | `#ffdcb5` | orange 14% | Needs-review tile |
| `--bg` | `#eef2ff` + sky/lilac/mint washes | `#0a1022` + cobalt/violet washes | Page |
| `--glass` | white 72% + blur | navy 72% + blur | Panels |
| `--text` / `--text-2` / `--text-3` | `#0b0d12` / `#474e6b` / `#5e6580` | `#eef2ff` / `#b6c0de` / `#8b96bb` | Body, secondary, muted |
| `--warn` / `--bad` | `#9a4708` / `#c9303f` | `#ffb36b` / `#ff7a86` | Review and errors |

Every text pair meets WCAG AA (4.5:1). Checked: white on cobalt 5.2–5.8:1, muted on page 5.15:1, muted on the
lightest tile 4.61:1, warning on its tint above 4.5:1.

## Type

- **Bricolage Grotesque** (Google Fonts, free): page titles and headings, 700, tight tracking (−1px to −1.4px).
- **Figtree** (bundled): everything else, 400–700.
- Sentence case for all labels. No all-caps eyebrows, no single highlighted word in headlines.

## Shape

Pills for every control (`999px`); 24–34px radius for panels (the composer is the roundest at 34px); 44px round
icon buttons; 26px summary tiles. Glass panels blur what's behind them; only the composer and the cobalt tile are solid.

## Components

- **Top navigation**: logo on a black chip (the logo's lettering is white), a black pill of round icon links (the
  active one expands to cobalt with its label), then India time, search, Day/Night and account, and "New script".
  Phones keep the logo and tools on top and a black tab bar at the bottom.
- **Start from**: a black-selected pill switch, "New script" or "Refine a client's script".
- **Composer**: the one bold element. White fields on a cobalt card; format and story choices as white-on-cobalt
  pills; the writer switch and a black "Write script" / "Refine script" button share the footer.
- **Summary tiles**: tint carries the status; the "Ready" tile is solid cobalt; a dark ring marks the active filter.
- **Script cards**: white glass, status badge, platform and length, brand and time.
- **Editor**: a wide dialog with scene jump pills and labelled fields for camera, visual, performance, VO,
  on-screen text, music, sound effects, transition and dialogue lines (speaker, line, delivery).

## Interaction and accessibility

- Visible cobalt focus ring on every control; dialogs move focus inside, keep Tab inside, close with Escape and
  return focus to the button that opened them.
- Icon-only links carry names for screen readers; every form field has a label.
- Touch targets are at least 44px.
- Motion only answers an action (opening, hovering, saving); reduced-motion settings are respected.
- Automated WCAG 2.1 AA scan (axe-core) passes on Studio, Scripts, a script page, New script, Library and Format, in
  both themes.

## Words

Plain, specific, sentence case. Actions say what happens ("Write script", "Refine script", "Save changes",
"Paste product details"); the same action keeps the same name everywhere. Errors say what went wrong and what to do.
No references to AI anywhere in the interface.
