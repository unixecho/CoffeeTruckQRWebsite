# Design system

Ported from the 3D Prints manager, which targets **iOS-native quality** rather
than "a web app with rounded corners". Every value below mirrors Apple's Human
Interface Guidelines. The implementation is
[`src/app/globals.css`](../src/app/globals.css) and
[`src/components/ios/`](../src/components/ios/).

**The rule that matters most:** never write a raw hex value or an arbitrary
pixel size in a component. Use a token. If one does not exist for what you
need, add it here and to `globals.css` first, then use it.

Two deliberate departures from the source system, both because this site is
trilingual where that one is not — see §7.

---

## 1. Colour

iOS uses *semantic* colours that resolve differently per mode. You never pick
"grey #888"; you pick "secondary label" and the system decides what that means.

**Dark is the default look**, not a `prefers-color-scheme` fallback. The base
`:root` block holds the dark values; light applies only under
`:root[data-theme="light"]`, stamped on `<html>` by `ThemeProvider` before
paint. An OS set to light still sees this app dark until the visitor switches.

| Token | Use for | Never for |
|---|---|---|
| `--label-primary` | body text, titles | anything decorative |
| `--label-secondary` | subtitles, captions | primary reading text |
| `--label-tertiary` | placeholders, chevrons | text the user must read |
| `--label-quaternary` | empty-state glyphs | text |
| `--bg-grouped` | the page background | cards |
| `--bg-grouped-secondary` | cards, list groups | the page background |
| `--fill-tertiary` | tinted buttons, chips, search | text |
| `--separator` | hairlines between rows | borders around cards |
| `--material-bar` | nav and tab bars, with `backdrop-blur-xl` | static surfaces |
| `--material-sheet` | sheets, toasts | anything not floating |
| `--scrim` | the dim behind a modal | — |
| `--wash-1/2/3` | the fixed ambient gradient | any surface or control |

### Accents

`--ios-blue` `--ios-green` `--ios-indigo` `--ios-orange` `--ios-pink`
`--ios-purple` `--ios-red` `--ios-teal` `--ios-yellow`

Each has a distinct dark value — blue goes `#007AFF` → `#0A84FF`. This is why
you must use the token: hardcoding `#007AFF` gives a blue too dim to read on
black.

**Meaning is fixed.** Blue is interactive. Green is success and savings. Red is
destructive and errors *only*, never decorative. Orange is attention — the
read-only banner, a bundle deal, a low-stock note.

### The ambient wash

`body::before` paints three low-opacity radial gradients behind everything, so
the page reads as depth rather than flat black. Warmer here than in the source
system — amber rather than blue — because this is a coffee stand and the tint
should read as the truck's lamp. **Never** put a wash token on a card or text.

### Non-negotiable

Body text ≥ 4.5:1, secondary ≥ 3:1, verified in **both** modes — light values
do not transfer. Colour is never the only signal: the active tab gets weight as
well as colour, an error gets an icon as well as red.

## 2. Type

**Rubik**, self-hosted as variable woff2 subsets covering Hebrew, Arabic and
Latin. One face for all three scripts — a system stack renders them in three
different fonts and faux-bolds the weights Hebrew does not ship. Weight axis is
300–900; above 900 clamps.

| Token | Size / line-height | Use |
|---|---|---|
| `text-large-title` | 34 / 41, bold | the screen title, in the scroll flow |
| `text-title-1` | 28 / 34, bold | a hero figure |
| `text-title-2` | 22 / 28, bold | sheet titles, the cart total |
| `text-title-3` | 20 / 25, semibold | section headings |
| `text-headline` | 17 / 22, semibold | emphasised rows, collapsed nav title |
| `text-body` | 17 / 22 | **default** — list rows, inputs, buttons |
| `text-callout` | 16 / 21 | slightly reduced body |
| `text-subheadline` | 15 / 20 | card titles, secondary buttons |
| `text-footnote` | 13 / 18 | group headers, helper text, errors |
| `text-caption-1` | 12 / 16 | metadata |
| `text-caption-2` | 11 / 13 | tab bar labels only |

**17px body is deliberate.** Anything under 16px in a text input makes iOS
Safari auto-zoom on focus, which yanks the layout around mid-form.

Apply `.tabular` to any number that changes in place — prices, counts. Without
it, digits have different widths and the layout jitters as values update.

## 3. Spacing, radii, safe areas

4pt rhythm: `4 / 8 / 12 / 16 / 24 / 32`. Never `13px`.

Screen gutter `px-4`. Content `max-w-3xl`, centred. Between list groups `mb-8`.
Rows are `py-2.5` with `min-h-11` enforcing the 44pt floor.

| Token | Value | Use |
|---|---|---|
| `--radius-control` | 8 | chips, small buttons, search |
| `--radius-inset` | 10 | inset grouped list containers |
| `--radius-button` | 12 | standard buttons, text fields |
| `--radius-card` | 14 | cards, thumbnails |
| `--radius-sheet` | 20 | modal sheets, toasts |

Fixed chrome respects `env(safe-area-inset-*)`, and scrolling content reserves
matching space so nothing hides behind a bar.

## 4. Touch

44×44pt minimum for anything tappable — `min-h-11`, or `size-11` for an icon
button whose glyph is smaller. 8pt minimum between adjacent targets. Feedback
within 100ms: `.press` scales to 0.97, `.press-row` flashes a fill. Both
animate `transform`/`background-color` only, never `width` or `top`.

Hover is an enhancement, never the only way to reveal something.

## 5. Motion

`--ease-ios` is `cubic-bezier(0.32, 0.72, 0, 1)` — the curve iOS uses for sheet
presentation.

| Purpose | Class | Duration |
|---|---|---|
| press | `.press` | 140ms |
| sheet present | `.animate-sheet-in` | 350ms |
| toast | `.animate-hud-in` | 280ms |
| forward nav | `.animate-push-in` | 320ms |
| backward nav | `.animate-pop-in` | 320ms |
| settling in place | `.animate-rise-in` | 400ms |
| list stagger | `.stagger` | 300ms, 30ms/row |
| grid stagger | `.stagger-rise` | 380ms, 45ms/row |

**Motion must mean something.** Decorative animation is banned. Never stagger
twice in one transition — `.stagger-rise` exists because sliding rows inside a
panel that is itself sliding reads as jitter.

Push and pop use `translateX(calc(… * var(--dir)))`, and `--dir` is `-1` under
`[dir="rtl"]`. Forward navigation must arrive from the left in Hebrew; a stack
that always slides the same physical way reads as backwards in two of the three
languages this ships in.

`prefers-reduced-motion` collapses everything to 0.01ms globally. Do not fight
it.

## 6. Components — `src/components/ios/`

- **`ListGroup` / `ListRow`** — the inset grouped list, the backbone of every
  screen. Separators inset to align with the **text**, not the container edge;
  that single detail is most of what separates a native list from an HTML
  table. `ListRow` handles it — do not hand-roll rows.

  A row that is tappable *and* has interactive `trailing` **splits**: the text
  region becomes the button and `trailing` sits beside it. Nesting a button
  inside a button is invalid HTML, breaks hydration outright, and leaves the
  inner control unreachable by keyboard. This shipped as a bug once.

- **`Button` / `LinkButton`** — `filled` (one primary per screen) · `tinted` ·
  `gray` · `plain` · `destructive`. Width is never baked into a size; pass
  `fullWidth`. Use `LinkButton` for navigation so middle-click and
  open-in-new-tab work.

- **`Sheet` / `ActionSheet`** — three dismissal routes, all required: grabber
  drag, backdrop tap, Escape. Body scroll locks. Portalled to `document.body`,
  because `fixed` only escapes to the viewport if no ancestor sets a
  `transform` or `backdrop-filter` — and the nav bars do.
  Both take localized `dismissLabel` / `cancelLabel`; they hold no English.

- **`TextField`, `Switch`, `SegmentedControl`, `Stepper`, `Disclosure`** —
  native geometry (the switch is exactly 51×31pt). `TextField` always renders a
  visible label; placeholder-only labelling is a documented accessibility
  failure.

- **`useToast`** — auto-dismisses at 3.2s, announces `aria-live="polite"`, and
  **never takes focus**. A toast must not interrupt someone mid-keystroke.

- **`EmptyState`, `Skeleton`, `Spinner`, `ProgressBar`, `IconTile`** — use
  `Skeleton` for anything over ~300ms, not a blocking spinner. Every empty
  state needs a reason and a way forward.

## 7. RTL — the two departures from the source system

The 3D Prints system is LTR-only. Porting it required real changes, not a
stylesheet flip:

1. **Logical properties throughout.** `ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`/
   `text-start`. The back chevron, the disclosure arrow and the row chevron all
   carry `scaleX(var(--dir))`. The segmented control's sliding pill is anchored
   with `inset-inline-start` and its travel is signed by `--dir`, because
   `translateX` is physical while the flex track mirrors.

2. **`.ltr-nums` on every numeric expression.** `3 / 5` written inside Hebrew is
   reordered by the bidi algorithm into `5 / 3` — not cosmetic, a different and
   wrong claim. Same for ranges, a price beside a count, and the bundle ladder.
   The class sets `direction: ltr; unicode-bidi: isolate`.

**The two deliberate exceptions**, both floating and both commented in place:
the settings globe (top-left) and the WhatsApp button (bottom-right) are pinned
*physically*. A fixed affordance is remembered by where the thumb reaches for
it; one that changes corner when you change language is one you have to hunt
for. The cart button is pinned bottom-left for the same reason and to stay
clear of WhatsApp.

## 8. Accessibility floor

Required, not aspirational:

- [ ] Contrast ≥ 4.5:1 body / 3:1 secondary, verified in **both** modes
- [ ] Touch targets ≥ 44×44pt
- [ ] Visible `:focus-visible` ring — a global `!important` rule in
      `globals.css`, because inline styles beat a plain rule and codebases
      accumulate `outline: none` (PLAYBOOK §2.4)
- [ ] Icon-only buttons carry `aria-label`; decorative icons `aria-hidden`
- [ ] Real `<label>` on every input, wired with `htmlFor`
- [ ] Errors use `role="alert"` and sit beside the field
- [ ] Colour is never the sole carrier of meaning
- [ ] `prefers-reduced-motion` respected
- [ ] Zoom never disabled (`maximumScale: 5`)
- [ ] `lang` and `dir` reflect the *displayed* language, not a server default

## 9. Before a screen is done

- [ ] Tokens only — no raw hex, no arbitrary px
- [ ] Tested at 390px and 1280px
- [ ] Tested in Hebrew **and** English — RTL and LTR break differently
- [ ] Tested in dark **and** light
- [ ] Loading, empty and error states all exist
- [ ] Exactly one `filled` button per screen
- [ ] Numbers that change use `.tabular`; mixed expressions use `.ltr-nums`
- [ ] Nothing hides behind the tab bar or nav bar
- [ ] No horizontal scroll at 390px
