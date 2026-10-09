# 04 — Design System

KProctor reuses the Kodeversity LMS design language. It doesn't introduce a new one.

## Sources reused from the LMS

| Item | Source in LMS |
|---|---|
| Base tokens (radius, neutrals, fonts) | `kodeversity/src/styles.css` |
| Button, Card, Dialog, AlertDialog, DropdownMenu, Slider, Tooltip, Checkbox | `kodeversity/src/components/ui/*` |
| Logo assets | `kodeversity/src/components/layout/Logo.tsx` |
| Header proportions (64px, white, subtle border) | `AdminNavbar.tsx` |
| Sidebar width (256px) and mint active state | `AdminSidebar.tsx` |
| Card treatment (`rounded-2xl`, `border-slate-200/70`, `shadow-sm`) | Admin pages |
| Button treatment (`rounded-xl`, `text-xs font-bold`, 40px) | Admin pages |

## KProctor scope (`.kp`)

All exam colours are defined on a `.kp` wrapper in `src/styles.css`, so they don't affect the LMS:

| Token | Value | Use |
|---|---|---|
| `--brand` / `--primary` | `oklch(0.45 0.16 160)` (Kodeversity green) | Buttons, active states, icons |
| `--brand-strong` | `oklch(0.35 0.15 160)` | Green text |
| `--brand-soft` | `oklch(0.96 0.035 160)` | Mint backgrounds, icon tiles |
| `--navy` | `#111e38` | Headings, important text |
| `--surface` | `#f8fafc` | Page background |
| `--destructive` | red | End Exam, errors (the LMS was missing this token) |

Tailwind utilities: `bg-brand`, `text-brand-strong`, `bg-brand-soft`, `text-navy`, `bg-surface`.

Content rendered in portals (dialogs, dropdowns) adds the `kp` class itself, because portals mount outside the wrapper.

## Status colours

Status is always shown with **icon + text + colour**, never colour alone.

| Status | Colour | Example |
|---|---|---|
| Passed | Green | ✓ Working Properly |
| Checking / idle | Neutral slate | ⟳ Checking camera… |
| Warning / not available | Amber | ⚠ No Camera |
| Failed | Red | ⓘ Permission Required |

## Layout rules

- Desktop-first. Below **1024px** the exam UI is replaced with *"Please use a desktop or laptop to take this examination."*
- Tested at **1280×800**, **1440×900**, **1536×1024** and **1920×1080**.
- A custom `short:` variant (`@media (max-height: 860px)`) tightens vertical spacing on laptop screens.
- Visible keyboard focus: a 2px green outline on every interactive element inside `.kp`.
- `prefers-reduced-motion` disables animations.
