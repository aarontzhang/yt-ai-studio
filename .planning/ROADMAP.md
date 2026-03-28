# Roadmap: YouTube AI Studio

## Overview

A brownfield reskin: the existing AutoCut video editor gets a YouTube Creator Studio shell layered on top, delivering an upload-to-publish demo flow that is visually indistinguishable from the real YouTube Studio. Three phases follow the strict dependency chain — tokens must exist before shell, shell before content, content before the full editor-to-stepper demo flow.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - CSS token system, dependencies, and global shell that wraps every page
- [ ] **Phase 2: Content and Upload** - Channel content page and upload modal that launch the editor
- [ ] **Phase 3: Editor and Stepper** - Editor reskin, post-export stepper, micro-interactions, and end-to-end wiring

## Phase Details

### Phase 1: Foundation
**Goal**: The visual language and persistent chrome of YouTube Studio are established — every subsequent surface inherits correct colors, typography, spacing, icons, and layout structure
**Depends on**: Nothing (first phase)
**Requirements**: DTKN-01, DTKN-02, DTKN-03, DTKN-04, DTKN-05, DTKN-06, SHEL-01, SHEL-02, SHEL-03, SHEL-04, SHEL-05, SHEL-06
**Success Criteria** (what must be TRUE):
  1. Opening any page in the app shows a 56px dark top bar with YouTube logo, search bar, create button, and avatar, plus a 240px sidebar with all YouTube Studio nav items and the Content item highlighted
  2. All YouTube Studio colors (`--yt-*`) are available as Tailwind utility classes (`bg-yt-surface`, `text-yt-secondary`, etc.) and visible on any new component using them
  3. Roboto font renders on all YouTube Studio shell surfaces (top bar, sidebar, nav items)
  4. Material Icons Outlined render correctly in the sidebar and top bar without CDN requests
  5. Editor resize handles (media panel, timeline height, chat panel) continue to work correctly after the sidebar and top bar are introduced to the layout
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 01-01-PLAN.md — CSS tokens + Roboto font + tw-animate-css (DTKN-01, 02, 03, 04)
- [x] 01-02-PLAN.md — Material icons + shadcn primitives install + restyle (DTKN-05, 06)
- [x] 01-03-PLAN.md — YTTopBar, YTSidebar, YTCreateMenu, YTShell, /content page (SHEL-01–06)

### Phase 2: Content and Upload
**Goal**: Users land on the channel content page and can initiate a real video upload that navigates into the editor
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, UPLD-01, UPLD-02, UPLD-03
**Success Criteria** (what must be TRUE):
  1. Navigating to `/content` shows a "Channel content" page with horizontal tab navigation, "Videos" tab active by default, and a video table with correct columns (thumbnail, title, Visibility, Restrictions, Date, Views, Comments, Likes)
  2. Video table rows show 120x68px thumbnails, titles, and metadata in YouTube Studio styling with hover states
  3. Clicking "Create" in the top bar and then "Upload videos" opens a 540px upload modal with a drag-and-drop zone and terms of service text
  4. Dropping or selecting a video file triggers the existing upload flow and navigates to the editor
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md — Shell wiring + ChannelContentPage with tabs and VideoTable (CONT-01, 02, 03, 04, 05)
- [x] 02-02-PLAN.md — YTUploadModal with drag-drop upload flow and ToS text (UPLD-01, 02, 03, CONT-05)

### Phase 3: Editor and Stepper
**Goal**: The editor looks like YouTube Studio and the full demo flow runs end-to-end — from upload through AI editing, export, the 4-step post-export stepper, and the published dialog
**Depends on**: Phase 2
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-06, EDIT-07, EDIT-08, STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06, STEP-07, STEP-08, STEP-09, STEP-10, MICR-01, MICR-02, MICR-03, MICR-04, MICR-05, MICR-06
**Success Criteria** (what must be TRUE):
  1. The editor uses YouTube Studio's blue accent (`#3ea6ff`) and dark backgrounds (`#0f0f0f`/`#181818`) with no visible cyan (`#21d4ff`) anywhere in the UI
  2. After export completes, the user is navigated to `/content` and a Details modal opens automatically with a 4-step progress stepper (Details, Video Elements, Initial Check, Visibility)
  3. Stepping through all 4 steps works — Back/Next navigation advances the progress track, each step shows its correct form content (title/description/thumbnail/playlists, add-video/subtitles, copyright/community check, visibility radio buttons)
  4. Title and description inputs show floating label animation; accordions animate chevron rotation; modals fade in with scrim overlay
  5. All editor resize handles continue to work correctly after the token and layout changes
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete |  |
| 2. Content and Upload | 0/2 | Ready | - |
| 3. Editor and Stepper | 0/TBD | Not started | - |
