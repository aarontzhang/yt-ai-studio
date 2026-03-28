---
phase: 01-foundation
plan: 03
subsystem: shell-layout
tags: [shell, top-bar, sidebar, youtube-studio, layout, radix-ui]
dependency_graph:
  requires: [01-01-SUMMARY, 01-02-SUMMARY]
  provides: [YTTopBar, YTSidebar, YTCreateMenu, YTShell, content-route]
  affects: [phase-02, phase-03]
tech_stack:
  added:
    - "@radix-ui/react-dropdown-menu — Create button dropdown (YTCreateMenu)"
    - "lucide-react — icon dependency for shadcn accordion, checkbox, dialog, select components"
  patterns:
    - "YTShell opt-in wrapper pattern — studio pages import YTShell; editor page is excluded"
    - "Inline SVG icons for sidebar nav items — avoids @material-symbols-svg/react import uncertainty"
    - "CSS custom property layout sizing — --yt-topbar-height and --yt-sidebar-width drive all offsets"
key_files:
  created:
    - components/shell/YTCreateMenu.tsx
    - components/shell/YTTopBar.tsx
    - components/shell/YTSidebar.tsx
    - components/shell/YTShell.tsx
    - app/content/page.tsx
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Used @radix-ui/react-dropdown-menu for YTCreateMenu (installed separately; not in unified radix-ui package)"
  - "Used inline SVG paths for all sidebar and top bar icons rather than @material-symbols-svg/react imports — eliminates import path uncertainty at runtime"
  - "YTShell is opt-in wrapper only — editor page (/editor) continues to use EditorLayout directly with full 100vh"
  - "Radix DropdownMenu.Portal used in YTCreateMenu so dropdown renders outside any overflow:hidden containers"
metrics:
  duration: "4 minutes"
  completed_date: "2026-03-28T08:17:00Z"
  tasks_completed: 2
  files_changed: 5
---

# Phase 01 Plan 03: YouTube Studio Shell Components Summary

Four YouTube Studio shell components built in `components/shell/` (YTTopBar, YTSidebar, YTCreateMenu, YTShell) and `/content` route stub created; navigating to `/content` now renders a 56px top bar + 240px sidebar layout visually matching YouTube Creator Studio chrome, while `/editor` remains completely unaffected.

## What Was Done

### Task 1: YTTopBar, YTSidebar, YTCreateMenu

**YTTopBar** (`components/shell/YTTopBar.tsx`):
- Fixed 56px top bar (`var(--yt-topbar-height)`), `bg-yt-base`, `border-b border-yt-border`, `z-50`
- Left: non-functional hamburger button + YouTube logo (red rect/white triangle SVG) + "Studio" wordmark linked to `/content`
- Center: non-functional search bar — 40px height, `rounded-[20px]`, `border-yt-border-input`, `bg-yt-overlay`, placeholder text
- Right: Info icon button, Notifications icon button, YTCreateMenu, 32px avatar circle

**YTSidebar** (`components/shell/YTSidebar.tsx`):
- Fixed 240px sidebar (`var(--yt-sidebar-width)`), positioned at `top: var(--yt-topbar-height)`, `height: calc(100vh - var(--yt-topbar-height))`
- Profile section: 80px avatar circle, "Your Channel" name, "@yourchannel" handle, "View channel" link
- 11 nav items in correct YouTube Studio order; "Content" is the active item (`bg-yt-overlay`, `text-yt-primary`, `opacity-100` icon)
- All non-active items have no click handler — they do nothing when clicked
- All icons are inline SVG Material Symbols paths (20x20, `viewBox="0 0 24 24"`)

**YTCreateMenu** (`components/shell/YTCreateMenu.tsx`):
- Radix `DropdownMenu.Root` with "Create" button trigger (36px height, `rounded-yt-button`, `border border-yt-border`)
- Dropdown via `DropdownMenu.Portal` — renders at body level, `z-[200]`, `bg-yt-elevated`, `rounded-yt-dropdown`
- Two items: "Upload videos" (wired via `onUploadClick` prop — Phase 2 will connect this) and "Go live" (non-functional)

### Task 2: YTShell and app/content/page.tsx

**YTShell** (`components/shell/YTShell.tsx`):
- Renders `<YTTopBar />` and `<YTSidebar />` with a `<main>` content area offset via CSS vars:
  - `marginTop: var(--yt-topbar-height)`, `marginLeft: var(--yt-sidebar-width)`, `padding: 24px 32px`
- Children render inside the offset content area — editor page excluded entirely

**app/content/page.tsx**:
- Phase 1 stub wrapped in `<YTShell>` — renders "Channel content" heading and Phase 2 placeholder text
- Phase 2 will replace the inner content with the full `ChannelContentPage` component

## Layout Description (/content)

Opening `/content` shows:
- A 56px dark top bar spanning the full viewport width, fixed at top, with YouTube play button logo on left, search bar in center, and Create/avatar on right
- A 240px dark sidebar fixed on the left (below top bar, full remaining height), with profile section at top followed by 11 nav items; "Content" is highlighted in `#282828` with full-opacity icon
- The main content area is offset 240px from left and 56px from top, with 24px/32px padding, showing the "Channel content" heading stub

## Verification Results

```
All shell files: YTCreateMenu.tsx YTShell.tsx YTSidebar.tsx YTTopBar.tsx
Shell leak into /editor: 0 occurrences
Content page uses YTShell: ✓
Nav items (label count): 17 (> 11 minimum)
Upload videos in CreateMenu: ✓
No YTShell in editor page: ✓ (empty — correct)
TypeScript: ✓ Compiled successfully in 3.6s
```

## Build Status

TypeScript compilation succeeded (`✓ Compiled successfully`). The `supabaseUrl is required` error during `next build` page data collection is a pre-existing issue with the `/api/waitlist` route requiring Supabase env vars at build time — unrelated to shell components and present before this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @radix-ui/react-dropdown-menu**
- **Found during:** Task 1, before writing YTCreateMenu.tsx
- **Issue:** `@radix-ui/react-dropdown-menu` was not in `node_modules/@radix-ui/` (only the 7 packages installed by Plan 02 were present)
- **Fix:** `npm install @radix-ui/react-dropdown-menu`
- **Files modified:** package.json, package-lock.json

**2. [Rule 1 - Bug] Installed lucide-react to fix shadcn component compilation failure**
- **Found during:** Task 2 build verification
- **Issue:** 4 shadcn components (`accordion.tsx`, `checkbox.tsx`, `dialog.tsx`, `select.tsx`) import from `lucide-react`, which was not installed. TypeScript compilation failed with "Cannot find module 'lucide-react'"
- **Fix:** `npm install lucide-react`
- **Files modified:** package.json, package-lock.json
- **Note:** This was a pre-existing bug from Plan 02's shadcn installation — `lucide-react` is a transitive shadcn dependency that was not explicitly installed

**3. [Rule 2 - Missing] Used inline SVG instead of @material-symbols-svg/react for icons**
- **Found during:** Task 1 planning
- **Issue:** Plan noted "import path uncertainty" for @material-symbols-svg/react in shell components; plan itself recommended using inline SVGs to avoid runtime uncertainty
- **Fix:** Used inline SVG paths (Material Symbols Outlined style) for all 11 sidebar icons and top bar icons — matches the plan's own recommendation
- **Files modified:** components/shell/YTSidebar.tsx, components/shell/YTTopBar.tsx

## Known Stubs

- `app/content/page.tsx` — Inner content is a placeholder heading. Phase 2 will replace with `ChannelContentPage` component (video list table with tabs).
- `YTSidebar` — Avatar is a static grey circle, channel name/handle are hardcoded "Your Channel" / "@yourchannel". Phase 2+ will wire real channel data.
- `YTCreateMenu` — "Upload videos" `onUploadClick` prop is not connected in `ContentPage`. Phase 2 will pass the upload modal trigger.

## Commits

- `fe73c5a` — feat(01-03): build YTTopBar, YTSidebar, and YTCreateMenu shell components
- `c466a5c` — feat(01-03): build YTShell wrapper and app/content route

## Self-Check: PASSED

Files verified:
- `components/shell/YTCreateMenu.tsx` — FOUND (2193 bytes)
- `components/shell/YTTopBar.tsx` — FOUND (4886 bytes)
- `components/shell/YTSidebar.tsx` — FOUND (6495 bytes)
- `components/shell/YTShell.tsx` — FOUND
- `app/content/page.tsx` — FOUND

Commits verified:
- `fe73c5a` — FOUND in git log
- `c466a5c` — FOUND in git log
