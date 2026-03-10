# Mobile Layout Implementation Plan

## Overview
Add a mobile-native layout to Hudai, accessible via `?layout=mobile` URL param (following existing `?layout=density|classic` pattern). 4-tab bottom-nav interface: Pulse, Plan, Stream, Controls. PWA-ready.

## File Structure

```
packages/client/src/components/Mobile/
  MobileShell.tsx           -- Root: header + active tab + bottom nav + prompt overlay
  MobileHeader.tsx          -- Status dot, project name, prompt trigger icon
  BottomNav.tsx             -- 4-tab bottom navigation
  PromptOverlay.tsx         -- Slide-up prompt input sheet
  tabs/
    PulseTab.tsx            -- Status ring + swipeable action cards + activity feed
    PlanTab.tsx             -- Progress hero + step list + file list
    StreamTab.tsx           -- Chat timeline + text input
    ControlsTab.tsx         -- Steering buttons + permission toggles + templates
  pulse/
    StatusRing.tsx          -- Animated SVG ring (adapted from GlanceMode/TaskRing)
    ActionCard.tsx          -- Swipeable approve/reject card
    ActionCardStack.tsx     -- Stack manager for multiple cards
    ActivityFeed.tsx        -- Compact event list
  plan/
    ProgressHero.tsx        -- Large percentage ring
    StepList.tsx            -- Vertical steps with status indicators
    FileList.tsx            -- Collapsible file paths per step
  stream/
    StreamMessage.tsx       -- Single message (adapted from CommanderChat patterns)
    ToolDot.tsx             -- Colored circle for tool type
    StreamInput.tsx         -- Bottom-anchored text input
  controls/
    SteeringButtons.tsx     -- Large touch-friendly pause/resume/cancel
    PermissionToggles.tsx   -- Auto-approve toggles
    QuickTemplates.tsx      -- Preset prompt buttons

packages/client/src/hooks/
  useMobileTab.ts           -- Active tab state
  useSwipeGesture.ts        -- Touch swipe detection hook
```

## Wiring into App.tsx

```tsx
// Add to useLayoutParam return type: 'density' | 'classic' | 'mobile'
// Add auto-detection fallback:
const isMobileDevice = window.innerWidth < 768 && 'ontouchstart' in window;
// Render MobileShell when layout === 'mobile' or auto-detected
```

No changes needed to useWebSocket — it already wires all stores at the App level. Mobile components just read from existing stores.

## Store Dependencies

| Component | Stores Used |
|-----------|-------------|
| MobileHeader | `useSessionStore`, `useNotificationStore` |
| BottomNav | `useNotificationStore` (badge on Pulse when waiting_permission) |
| StatusRing | `useSessionStore`, `usePlanStore` |
| ActionCard | `useChatStore` (actionable/respondable messages) |
| ActivityFeed | `useJourneyStore`, `useEventStore` |
| ProgressHero | `usePlanStore` |
| StepList | `usePlanStore` |
| StreamTab | `useChatStore`, `useEventStore` |
| SteeringButtons | `useSessionStore` |
| PermissionToggles | `useConfigStore` |
| QuickTemplates | — (sends via wsClient directly) |
| PromptOverlay | — (sends via wsClient directly) |

## Touch Gestures

### useSwipeGesture hook
- Tracks touchstart/touchmove/touchend
- Fires onSwipeLeft/onSwipeRight when horizontal delta > threshold (50px) and > vertical delta
- Returns ref to attach to swipeable element
- Used in: MobileShell (tab switching), ActionCard (approve/reject)

### ActionCard swipe
- Real-time translateX transform during touchmove
- Green tint swiping right (approve), red tint swiping left (reject)
- Snap back below threshold, animate off-screen above
- Sends `wsClient.send({ kind: 'command', command: { type: 'approve'|'reject' } })`

### Touch targets
All interactive elements ≥ 44x44px per Apple HIG.

## PWA Setup

### manifest.json (packages/client/public/)
```json
{
  "name": "Hudai — Commander's View",
  "short_name": "Hudai",
  "start_url": "/?layout=mobile",
  "display": "standalone",
  "background_color": "#0a0e17",
  "theme_color": "#c96f3c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### index.html additions
```html
<meta name="theme-color" content="#c96f3c">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<!-- Update viewport: add viewport-fit=cover for safe-area-insets -->
```

No service worker — app requires live WebSocket, offline is meaningless.

## Implementation Phases

### Phase 1: Skeleton
- Create MobileShell, BottomNav, MobileHeader
- Tab routing with useMobileTab hook
- Wire into App.tsx with `?layout=mobile` param + auto-detection
- Safe-area-inset padding on header/nav

### Phase 2: Pulse Tab
- StatusRing (adapt from TaskRing.tsx SVG)
- ActionCard + ActionCardStack with swipe gestures
- ActivityFeed (adapt from JourneyPanel)

### Phase 3: Stream Tab
- Merge chat + event stores into timeline
- StreamMessage (adapt from CommanderChat bubbles)
- StreamInput with command dispatch

### Phase 4: Plan Tab
- ProgressHero with percentage ring
- StepList with status indicators
- FileList collapsible sections

### Phase 5: Controls Tab
- SteeringButtons (same dispatch as ControlButtons.tsx)
- PermissionToggles
- QuickTemplates

### Phase 6: Prompt Overlay
- Slide-up sheet with text input
- Quick-send chips (Approve, Reject, Continue)

### Phase 7: PWA
- manifest.json, meta tags, icons
- viewport-fit=cover

### Phase 8: Polish
- useSwipeGesture for tab switching
- Animations and transitions
- Test on iOS Safari + Chrome Android

## Key Reference Files
- `packages/client/src/components/GlanceMode/TaskRing.tsx` — SVG ring pattern
- `packages/client/src/components/GlanceMode/StatusHero.tsx` — Status text/color mapping
- `packages/client/src/ws/ws-client.ts` — WebSocket send patterns
- `packages/client/src/theme/tokens.ts` — All design tokens
- `packages/client/src/stores/` — All 21 Zustand stores
