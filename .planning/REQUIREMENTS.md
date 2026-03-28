# Requirements: YouTube AI Studio

**Defined:** 2026-03-27
**Core Value:** The upload-to-publish flow must feel like a natural extension of YouTube Creator Studio — visually indistinguishable from the real thing, with a functional AI editor in the middle.

## v1 Requirements

Requirements for hackathon demo. Each maps to roadmap phases.

### Design Tokens

- [x] **DTKN-01**: YouTube Studio color palette is defined as `--yt-*` CSS custom properties in globals.css (backgrounds, text, accents, borders, status)
- [x] **DTKN-02**: YouTube Studio spacing scale (8px base grid) and border-radius values are defined as CSS custom properties
- [x] **DTKN-03**: Tailwind utility classes (`bg-yt-surface`, `text-yt-secondary`, `rounded-yt-button`) are generated via `@theme inline` from `--yt-*` tokens
- [x] **DTKN-04**: Roboto font is loaded via `next/font/google` and scoped to YouTube Studio components
- [x] **DTKN-05**: Material Icons Outlined are available as React components via `@material-symbols-svg/react`
- [x] **DTKN-06**: shadcn/ui primitives (Dialog, Select, RadioGroup, Accordion, Tabs) are installed and restyled with `--yt-*` tokens

### Global Shell

- [x] **SHEL-01**: Top bar renders YouTube Studio header — logo, search bar, create button, notifications icon, user avatar
- [x] **SHEL-02**: Top bar is 56px height with `#0f0f0f` background and bottom border
- [x] **SHEL-03**: Sidebar renders all YouTube Studio nav items (Dashboard, Content, Analytics, Community, Subtitles, Content detection, Earn, Customization, Audio library, Settings, Send feedback)
- [x] **SHEL-04**: Sidebar is 240px wide with profile avatar and channel name at top
- [x] **SHEL-05**: Sidebar "Content" item is active/highlighted; other items are non-functional
- [x] **SHEL-06**: Page layout uses sidebar + content area structure matching YouTube Studio

### Channel Content

- [x] **CONT-01**: Channel content page displays "Channel content" heading with horizontal tab navigation (Inspiration, Videos, Shorts, Live, Posts, Playlists, Podcasts, Courses, Promotions, Collaborations)
- [x] **CONT-02**: "Videos" tab is active by default and shows a data table of uploaded videos
- [x] **CONT-03**: Video table has columns: checkbox, Video (thumbnail + title), Visibility, Restrictions, Date, Views, Comments, Likes
- [x] **CONT-04**: Video table rows show thumbnail (120x68px, 4px radius), title, and metadata in YouTube Studio styling
- [x] **CONT-05**: "Create" button in top bar opens upload options; "Upload videos" triggers the upload modal

### Upload Flow

- [x] **UPLD-01**: Upload modal displays drag & drop zone with upload icon and "Select files" button matching YouTube Studio styling (540px wide, 12px radius)
- [x] **UPLD-02**: Dragging or selecting a file triggers the existing upload flow (initiate → Supabase storage → finalize) and navigates to the editor
- [x] **UPLD-03**: Upload modal displays terms of service text at bottom in muted style

### Editor Reskin

- [ ] **EDIT-01**: Editor uses YouTube Studio color tokens (`--yt-*`) instead of current Autocut cyan theme
- [ ] **EDIT-02**: Editor background colors shift from current `#111111`/`#171717` to YouTube Studio `#0f0f0f`/`#181818`
- [ ] **EDIT-03**: Editor accent color shifts from `#21d4ff` (cyan) to `#3ea6ff` (YouTube blue) across all interactive elements
- [ ] **EDIT-04**: All 32+ hardcoded cyan rgba/hex values in editor components are replaced with CSS variable references
- [ ] **EDIT-05**: Editor uses Roboto font for all UI text
- [ ] **EDIT-06**: Editor buttons match YouTube Studio button styles (18px radius, 14px/500 weight text)
- [ ] **EDIT-07**: Editor top bar is restyled to match YouTube Studio top bar
- [ ] **EDIT-08**: Resize handles in editor continue to work correctly after sidebar/top bar layout changes

### Details Stepper

- [ ] **STEP-01**: After export completes, user can navigate to a Details modal that overlays the channel content page
- [ ] **STEP-02**: Stepper shows 4 steps: Details, Video Elements, Initial Check, Visibility — with progress dots and connecting track
- [ ] **STEP-03**: Details step shows title input (floating label), description textarea, thumbnail section, playlists dropdown — all styled with YouTube Studio tokens (visual only, no persistence)
- [ ] **STEP-04**: Details step shows Audience section with "made for kids" radio buttons and Age Restriction accordion (visual only)
- [ ] **STEP-05**: Video Elements step shows "Add related video" and "Add subtitles" list items with "Add" buttons (visual only)
- [ ] **STEP-06**: Initial Check step shows Copyright and Community Guidelines status rows with "See details" button (visual only)
- [ ] **STEP-07**: Visibility step shows Private/Unlisted/Public radio buttons and Schedule accordion (visual only)
- [ ] **STEP-08**: Modal has right-side column showing video preview player, video link, and filename
- [ ] **STEP-09**: Modal footer shows "Back" and "Next"/"Save" buttons; navigation between steps works
- [ ] **STEP-10**: Modal header shows video title and "Saved as private" status badge

### Micro-Interactions

- [ ] **MICR-01**: Text inputs have floating label animation (label moves above on focus, color changes to `#3ea6ff`)
- [ ] **MICR-02**: Stepper progress track fills between completed steps
- [ ] **MICR-03**: Hover states use subtle background color shifts (`#3d3d3d`)
- [ ] **MICR-04**: Accordion chevrons rotate 180° with `200ms ease` transition
- [ ] **MICR-05**: Modals fade in with scrim overlay (`rgba(0, 0, 0, 0.6)`)
- [ ] **MICR-06**: `prefers-reduced-motion` is respected — animations disabled when set

## v2 Requirements

### Published Dialog

- **PUBL-01**: Video Published dialog shows share icons (WhatsApp, Facebook, X, Email, Reddit, Pinterest)
- **PUBL-02**: Video Published dialog shows video link with copy-to-clipboard button
- **PUBL-03**: Close button on Published dialog returns to channel content page

### Additional Polish

- **POLH-01**: "Saved as private" badge reactively updates when visibility radio buttons change
- **POLH-02**: Video table supports row selection via checkboxes
- **POLH-03**: Filter bar above video table with filter chips

## Out of Scope

| Feature | Reason |
|---------|--------|
| Functional sidebar pages (Dashboard, Analytics, etc.) | YouTube already has these; we're not rebuilding them |
| Functional publish flow (upload to YouTube) | Demo only — not a production integration |
| Light theme | YouTube Studio creator tools are dark-only |
| Mobile responsive layout | Demo is desktop-only |
| Backend for Details stepper (saving form data) | Visual scaffolding only |
| Rebuilding editor functionality | Editor works; only the skin changes |
| Real video preview in stepper | Would require re-upload; use placeholder or thumbnail |
| OAuth / Google login | Existing Supabase email auth is sufficient for demo |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DTKN-01 | Phase 1 | Complete |
| DTKN-02 | Phase 1 | Complete |
| DTKN-03 | Phase 1 | Complete |
| DTKN-04 | Phase 1 | Complete |
| DTKN-05 | Phase 1 | Complete |
| DTKN-06 | Phase 1 | Complete |
| SHEL-01 | Phase 1 | Complete |
| SHEL-02 | Phase 1 | Complete |
| SHEL-03 | Phase 1 | Complete |
| SHEL-04 | Phase 1 | Complete |
| SHEL-05 | Phase 1 | Complete |
| SHEL-06 | Phase 1 | Complete |
| CONT-01 | Phase 2 | Complete |
| CONT-02 | Phase 2 | Complete |
| CONT-03 | Phase 2 | Complete |
| CONT-04 | Phase 2 | Complete |
| CONT-05 | Phase 2 | Complete |
| UPLD-01 | Phase 2 | Complete |
| UPLD-02 | Phase 2 | Complete |
| UPLD-03 | Phase 2 | Complete |
| EDIT-01 | Phase 3 | Pending |
| EDIT-02 | Phase 3 | Pending |
| EDIT-03 | Phase 3 | Pending |
| EDIT-04 | Phase 3 | Pending |
| EDIT-05 | Phase 3 | Pending |
| EDIT-06 | Phase 3 | Pending |
| EDIT-07 | Phase 3 | Pending |
| EDIT-08 | Phase 3 | Pending |
| STEP-01 | Phase 3 | Pending |
| STEP-02 | Phase 3 | Pending |
| STEP-03 | Phase 3 | Pending |
| STEP-04 | Phase 3 | Pending |
| STEP-05 | Phase 3 | Pending |
| STEP-06 | Phase 3 | Pending |
| STEP-07 | Phase 3 | Pending |
| STEP-08 | Phase 3 | Pending |
| STEP-09 | Phase 3 | Pending |
| STEP-10 | Phase 3 | Pending |
| MICR-01 | Phase 3 | Pending |
| MICR-02 | Phase 3 | Pending |
| MICR-03 | Phase 3 | Pending |
| MICR-04 | Phase 3 | Pending |
| MICR-05 | Phase 3 | Pending |
| MICR-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after roadmap creation*
