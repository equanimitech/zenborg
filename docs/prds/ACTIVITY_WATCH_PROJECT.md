# ActivityWatch Integration - Semantic Attention Guardrails

**Status**: Draft
**Target**: MVP Extension (Phase 1)
**Philosophy**: Reduce the distance from intent to action through ambient awareness

---

## Vision

**The Problem**: We allocate consciousness to "Product Spec" but spend 90 minutes on Twitter. The gap between intention and action is invisible until reflection time - by then, the day is spent.

**The Solution**: Integrate ActivityWatch as a bundled extension to provide **semantic attention guardrails** - AI-powered ambient feedback that gently closes the gap between stated intention and observed activity.

**Core Principle**:
> "Technology as a mirror for consciousness, not a taskmaster."

This is not time tracking. This is **attention alignment detection** using AI to understand the semantic relationship between what you committed to doing and what you're actually doing.

---

## What This Is

A **passive ambient awareness system** that:
1. Observes computer activity via ActivityWatch
2. Classifies alignment with current moment using local LLM
3. Provides **peripheral feedback** (ambient compass indicator)

**Not**: Performance tracking, productivity metrics, nagging notifications, guilt-inducing dashboards, or granular time summaries.

**Is**: A gentle, intelligent mirror that helps you notice drift in the moment, not hours later.

---

## User Experience

### The Ambient Indicator (Passive, Real-time)

A small compass indicator in the corner of Zenborg:

```
Current: "Product Spec" ☕ Morning

[Compass widget - collapsed state]
🧭 ↑  (aligned)

[Compass widget - drift detected]
🧭 ↙  (drifting)
```

**Behavior**:
- Updates every 5-10 minutes
- Lives in peripheral vision (top-right corner, can collapse/hide)
- No modal takeovers, no sounds, no badges
- Clicking shows brief summary: "Currently aligned with product work theme"
- Can be dismissed entirely (respects user agency)

**States**:
- **Aligned** (↑): Activity matches moment's semantic theme
- **Neutral** (↔): Ambiguous (email, Slack, quick searches)
- **Drifting** (↙): Clear misalignment detected
- **Untracked** (○): No digital activity (reading, meetings, thinking)

---

## Technical Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────┐
│           Zenborg Core (Phase 1)                 │
│  - Moments with Area associations                │
│  - Areas define semantic themes                  │
│  - Current moment awareness                      │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│      ActivityWatch Extension Bundle              │
│  - aw-watcher-window (desktop apps)              │
│  - aw-watcher-web (browser tabs/URLs)            │
│  - aw-watcher-afk (idle detection)               │
│  - Local SQLite database                         │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│         Activity Collector Service               │
│  - Polls AW database every 5-10 min              │
│  - Aggregates recent events (last 15 min)        │
│  - Filters: apps, window titles, URLs, duration  │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│       Semantic Classifier (Local LLM)            │
│  - Ollama/llama.cpp (3B-7B param model)          │
│  - Input: current moment + observed activity     │
│  - Output: alignment classification + confidence │
│  - Understands work themes semantically          │
└─────────────────┬────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────┐
│          Ambient Feedback Layer                  │
│  - Compass indicator (real-time UI)              │
│  - Alignment history (stored in IndexedDB)       │
└──────────────────────────────────────────────────┘
```

### Data Model Extensions

**Note on Areas vs Moments**:
- **Areas** are life domains (Wellness, Craft, Social, Joyful, Introspective) per CLAUDE.md
- **Moments** are specific intentions like "Product Spec", "Data Analysis", "Morning Run"
- Classification matches activity → **current moment**, not area
- Moment names provide semantic context (e.g., "Product Spec" implies Linear/Notion/specs)

**AlignmentEvent** (new entity):
```typescript
interface AlignmentEvent {
  id: string                    // UUID
  momentId: string              // FK to Moment
  timestamp: string             // ISO timestamp
  classification: AlignmentType // "aligned" | "neutral" | "drifting" | "untracked"
  confidence: number            // 0.0-1.0
  observedActivities: ActivitySummary[]
  createdAt: string
}

interface ActivitySummary {
  app: string
  windowTitle: string
  url?: string
  duration: number              // seconds
}

type AlignmentType = "aligned" | "neutral" | "drifting" | "untracked"
```

### Semantic Classification Service (Transformer.js)

**Model Choice**: **Transformer.js** with zero-shot classification

**Why Transformer.js**:
- ✅ Zero external dependencies (no Ollama/llama.cpp install)
- ✅ Runs in browser or Node.js (WASM + WebGPU)
- ✅ Auto-downloads models on first use (cached locally)
- ✅ Fast inference for classification tasks (< 500ms)
- ✅ Reusable for journal note semantic annotation
- ✅ Works offline immediately after first model download

**Model Options** (ranked by preference):
1. **`facebook/bart-large-mnli`** - Zero-shot classification (best accuracy)
2. **`MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`** - Faster, still accurate
3. **Sentence transformers** + cosine similarity (ultra-fast, good enough)

**Classification Approach**:

```typescript
import { pipeline } from '@xenova/transformers'

// Load zero-shot classifier (once, cached)
const classifier = await pipeline(
  'zero-shot-classification',
  'facebook/bart-large-mnli'
)

// Build activity description from AW events
const activityDescription = `
Current intention: "${moment.name}" (${moment.area.name})
Context: User committed to working on this during ${phase}.

Recent activity (last 15 min):
${activity.map(a => `- ${a.app}: ${a.windowTitle} (${a.duration}s)`).join('\n')}
`

// Classify alignment using moment name as semantic anchor
const result = await classifier(activityDescription, [
  `working on: ${moment.name}`,          // e.g., "working on: Product Spec"
  'distracted or browsing unrelated content',
  'transitional activity like email or chat',
  'no significant activity observed'
])

// Map to AlignmentType
const classification = mapToAlignment(result.labels[0], result.scores[0])
// { classification: "aligned", confidence: 0.89 }
```

**Alternative: Semantic Similarity** (faster, simpler):

```typescript
import { pipeline } from '@xenova/transformers'

// Load sentence transformer (faster than zero-shot)
const embedder = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
)

// Embed intention (just the moment name - it's self-descriptive)
const intentionEmbedding = await embedder(moment.name)
// e.g., "Product Spec" or "Morning Run"

// Embed observed activity
const activityEmbedding = await embedder(
  activity.map(a => `${a.app} ${a.windowTitle}`).join('. ')
)

// Compute cosine similarity
const similarity = cosineSimilarity(intentionEmbedding, activityEmbedding)

// Classify based on threshold
const classification =
  similarity > 0.7 ? 'aligned' :
  similarity > 0.4 ? 'neutral' :
  similarity > 0.2 ? 'drifting' :
  'untracked'
```

**Response Format**:
```typescript
interface ClassificationResult {
  classification: AlignmentType // "aligned" | "neutral" | "drifting" | "untracked"
  confidence: number // 0.0-1.0 (from model scores)
  method: 'zero-shot' | 'similarity' // which approach was used
}

// Store in IndexedDB as AlignmentEvent (linked to moment via momentId)
```

---

## Implementation Phases

### Phase 1a: ActivityWatch Bundling (Week 1)
**Goal**: Ship Zenborg with AW pre-configured, zero user setup

**Tasks**:
1. Bundle AW binaries for macOS/Linux/Windows
2. Auto-start AW server on Zenborg launch (background process)
3. Install default watchers (window, web, afk)
4. Health check: verify AW is running, show status in settings
5. Graceful fallback: if AW fails, hide extension UI (no crash)

**Acceptance**:
- User installs Zenborg → AW runs automatically
- No manual AW installation required
- Settings page shows "ActivityWatch: Running ✓"

---

### Phase 1b: Activity Collection (Week 1)
**Goal**: Poll AW database and aggregate recent activity

**Tasks**:
1. AW SQLite database reader (or REST API client)
2. Service: poll every 5-10 min for last 15 min of events
3. Aggregate by app/window/URL with durations
4. Filter noise (< 10 sec interactions, system processes)
5. Store raw events temporarily (in-memory, not persisted)

**Acceptance**:
- Console logs show aggregated activity every 5 min
- Events correctly grouped by app/window
- Idle time excluded from aggregation

---

### Phase 1c: Semantic Classification (Week 2)
**Goal**: Classify alignment using Transformer.js

**Tasks**:
1. Install `@xenova/transformers` (npm package)
2. Load zero-shot classification model (BART or DeBERTa)
3. Build activity description from AW events
4. Classify alignment with candidate labels
5. Map scores to AlignmentType + confidence
6. Store classifications in IndexedDB (not raw activity)

**Acceptance**:
- Classification runs in-browser/Node.js, no external dependencies
- First-run downloads model (100-500MB), then cached
- Response time < 1 second (after model loaded)
- Confidence scores calibrated (>0.7 for aligned/drifting)
- Errors gracefully handled (show "untracked" if classification fails)

---

### Phase 1d: Ambient Compass Indicator (Week 2)
**Goal**: Show real-time alignment in peripheral vision

**UI Component**:
```tsx
<AlignmentCompass
  classification="aligned"
  confidence={0.85}
  canCollapse={true}
  position="top-right"
/>
```

**States**:
- **Aligned**: 🧭 ↑ (green tint)
- **Neutral**: 🧭 ↔ (gray)
- **Drifting**: 🧭 ↙ (amber, not red - no guilt)
- **Untracked**: 🧭 ○ (faded)

**Interactions**:
- Click → expand brief reason ("Aligned with product work theme")
- Double-click → hide for 1 hour (respects user agency)
- Settings toggle: disable entirely

**Design**:
- Monochrome base (stone-200 border)
- Subtle color accent (area color, low opacity)
- Small: 48px × 48px collapsed, 200px × 80px expanded
- No animations (calm tech)

**Acceptance**:
- Updates within 10 seconds of classification
- No performance impact (< 1% CPU)
- Can be dismissed/hidden
- Accessible (ARIA labels, keyboard nav)

---

### Phase 1e: Settings & Privacy (Week 2-3)
**Goal**: User control over data collection and feedback

**Settings Panel** (`:settings` command):
```
┌─────────────────────────────────────────────────┐
│ ActivityWatch Integration                       │
├─────────────────────────────────────────────────┤
│ ☑ Enable attention guardrails                   │
│ ☑ Show ambient compass indicator                │
│                                                  │
│ Classification interval: [5 min] [10 min] [15]  │
│ Model: [BART (accurate)] [DeBERTa (fast)]       │
│                                                  │
│ Privacy:                                         │
│ ☑ Process data locally only (in-browser)        │
│                                                  │
│ Data Retention:                                  │
│ Keep alignment history: [7 days] [30] [Forever] │
│ [Clear all ActivityWatch data]                  │
│                                                  │
│ Status:                                          │
│ ActivityWatch: Running ✓                        │
│ Transformer.js: Loaded ✓ (BART-large-mnli)      │
│ Last classification: 2 minutes ago              │
└─────────────────────────────────────────────────┘
```

**Privacy Guarantees**:
- Raw AW events never leave the machine (unless user opts into cloud LLM)
- Only classification results stored (not window titles/URLs)
- User can clear all data anytime
- AW can be disabled entirely (extension becomes dormant)

**Acceptance**:
- All toggles functional
- Data deletion works (verified in IndexedDB)
- Ollama connection status accurate
- Works without internet (local-only mode)

---

## User Flows

### Flow 1: First-Time Setup (Zero Config)
```
1. User installs Zenborg
2. ActivityWatch auto-starts in background
3. First classification triggers model download (progress: "Loading classifier...")
4. BART model downloads (400MB, one-time, cached)
5. Settings show: "ActivityWatch: Running ✓, Transformer.js: Loaded ✓"
6. Compass indicator appears (faded, no moment allocated yet)
```

**Fallback**: If model download fails (offline, no space), extension stays dormant until next launch.

---

### Flow 2: Morning Routine with Ambient Feedback
```
1. User allocates "Product Spec" to Today Morning (:t1)
2. Morning starts (6am), phase active
3. User opens Linear, starts writing spec
4. After 5 min → AW collects events, LLM classifies
5. Compass shows: 🧭 ↑ (aligned)
6. User switches to Twitter for 20 min
7. After 10 min → LLM reclassifies
8. Compass shifts: 🧭 ↙ (drifting)
9. User notices (peripheral vision), self-corrects
10. Back to Linear → compass returns to 🧭 ↑
```

**Key**: No interruption, no modal. Just ambient awareness.

---

### Flow 3: Disable Extension (User Agency)
```
1. User types :settings
2. Unchecks "Enable attention guardrails"
3. ActivityWatch stops collecting data
4. Compass indicator disappears
5. Zenborg continues working normally (core features unaffected)
```

**Key**: Extension is opt-out, not forced.

---

## Technical Constraints

### Performance
- **Classification latency**: < 1 second (Transformer.js, after model loaded)
- **UI update latency**: < 500ms (compass indicator)
- **CPU overhead**: < 3% average (AW watchers + inference)
- **Memory**: < 150MB (AW + Transformer.js model in-memory)
- **Battery impact**: Negligible (10-min polling, not continuous)

### Privacy
- **Default**: All data processed locally (AW SQLite + Transformer.js in-browser)
- **No telemetry**: Classification results stay on device
- **No cloud required**: Models downloaded once, cached locally
- **Data retention**: Default 7 days, user-configurable
- **GDPR compliance**: Full data export/deletion support

### Compatibility
- **Platforms**: macOS, Linux, Windows (AW supports all three)
- **Browsers**: Chrome (recommended), Firefox, Safari (aw-watcher-web)
- **Editors**: VS Code, Cursor, Vim/Neovim (window title detection)
- **Transformer.js**: Requires 2GB RAM minimum, WebGPU recommended for speed

---

## Success Metrics

**Qualitative** (user interviews):
- "Did the compass help you notice drift before it became hours?"
- "Was setup truly zero-config, or did you struggle?"
- "Do you trust that data stays local?"
- "Does the ambient feedback feel helpful or distracting?"

**Quantitative** (optional telemetry, opt-in):
- % of moments with aligned classification (target: >60%)
- Average time-to-notice drift (compass shown → user action)
- Extension disable rate (failure if >20% disable within 1 week)

**Technical Health**:
- AW uptime (target: >99%)
- LLM classification success rate (target: >95%)
- UI responsiveness (compass updates <500ms)
- Zero data loss on Zenborg restart

---

## Non-Goals (MVP)

**Explicitly excluded from Phase 1**:
- ❌ Cloud sync of ActivityWatch data
- ❌ Mobile app integration (AW is desktop-only)
- ❌ Productivity metrics / dashboards / charts
- ❌ Gamification (streaks, scores, achievements)
- ❌ Social features (compare with others)
- ❌ AI suggestions ("you should work on X next")
- ❌ Calendar integration (infer intentions from events)
- ❌ Pomodoro timers or time-boxing
- ❌ Automatic moment creation based on observed activity
- ❌ Notifications/reminders/alerts (calm tech only)
- ❌ Browser extension (watch via aw-watcher-web is sufficient)

**Future Phases** (not MVP):
- Phase 2: Longer-term reflection patterns (weekly/monthly, not immediate)
- Phase 3: Custom theme taxonomy (beyond Area keywords)
- Phase 4: Multi-device correlation (phone + desktop)
- Phase 5: Shared themes for teams (opt-in collaboration)

---

## Open Questions

**Technical**:
1. Which Transformer.js model: BART (accurate) or DeBERTa (faster)?
   - **Recommendation**: Start with BART, add DeBERTa as fast mode option

2. Polling interval: 5 min, 10 min, or user-configurable?
   - **Recommendation**: Default 10 min, configurable down to 5 min

3. How to handle rapid context switching (10+ app switches in 5 min)?
   - **Recommendation**: Classify as NEUTRAL (transitional state)

4. Should we show compass when no moment allocated?
   - **Recommendation**: Show as UNTRACKED (○), remind user to allocate

5. Use zero-shot classification or semantic similarity?
   - **Recommendation**: Zero-shot for better accuracy, similarity as fallback/fast mode

**UX**:
1. Should compass show confidence score, or just direction?
   - **Recommendation**: Hide confidence (too metric-y), just show state

2. What if user has multiple monitors? Where to show compass?
   - **Recommendation**: Let user drag/position, persist preference

3. Should alignment history be queryable/viewable?
   - **Recommendation**: Future phase - keep MVP focused on real-time awareness only

**Privacy**:
1. Should we offer data export (JSON dump of AlignmentEvents)?
   - **Recommendation**: Yes, via `:export-data` command

2. How to handle sensitive window titles (e.g., "Therapy Notes - Google Docs")?
   - **Recommendation**: Hash or redact in stored data, only use for real-time classification

---

## Philosophy Alignment Check

**Does this maintain Zenborg's core principles?**

✅ **Orchestration, not elimination**: Accepts drift, helps you notice and reallocate
✅ **Consciousness as currency**: Mirrors where attention actually goes vs. where you said it would
✅ **Presence over outcomes**: No "productivity score", just alignment awareness
✅ **Vim-inspired efficiency**: Minimal UI, peripheral vision, no interruptions
✅ **Calm technology**: Ambient indicators, not notifications; reflection, not real-time guilt
✅ **Local-first**: IndexedDB + local LLM, cloud is opt-in only
✅ **Privacy-first**: Raw activity never persisted, only classifications

**Potential Tensions**:
⚠️ **"No time tracking"** → We're tracking, but not exposing raw time (only alignment)
⚠️ **"No metrics"** → Classifications are a form of metric, but qualitative (aligned/drifting)
⚠️ **"Mindful tech is boring"** → AI classification could feel "smart" vs. boring

**Resolution**:
- Frame as **awareness tool**, not performance tracker
- Never show percentages, scores, or comparisons
- Make compass dismissible/disableable (user agency)
- Keep UI monochrome and calm (no red alerts, no urgency)

---

## Next Steps

**Immediate**:
1. ✅ PRD approval (this document)
2. Create technical spike: bundle AW binaries for Next.js app
3. Test Transformer.js integration (model loading, inference speed)
4. Design compass component (Figma mockup)
5. Set up Vitest tests for classification service

**Week 1 Deliverables**:
- AW auto-start on Zenborg launch
- Activity collection service (polling AW database)
- Console logging of aggregated events

**Week 2 Deliverables**:
- Transformer.js integration (zero-shot classification)
- Compass indicator UI component
- Real-time classification display

**Week 2-3 Deliverables**:
- Settings panel (privacy controls)
- Data retention & deletion
- E2E test: full flow from moment allocation → drift detection → self-correction

---

## Appendix: Example Moment-to-Activity Mappings

**How Semantic Classification Works**:

Moment names are self-descriptive. The classifier matches observed activity against the moment name semantically:

**Example 1: "Product Spec" (Area: Craft)**
```
Moment: "Product Spec"
Observed: Linear, Notion, Slack #product-team
Classification: ✓ Aligned (semantic match with spec/planning work)

Moment: "Product Spec"
Observed: Twitter, Hacker News
Classification: ✗ Drifting (no semantic connection)
```

**Example 2: "Data Analysis" (Area: Craft)**
```
Moment: "Data Analysis"
Observed: Jupyter Notebook, pgAdmin, Python
Classification: ✓ Aligned (semantic match with data/analysis work)

Moment: "Data Analysis"
Observed: Figma, Design System Docs
Classification: ✗ Drifting (different domain - design vs. data)
```

**Example 3: "Morning Run" (Area: Wellness)**
```
Moment: "Morning Run"
Observed: No digital activity
Classification: ? Untracked (expected for physical activity)

Moment: "Morning Run"
Observed: Strava, Spotify
Classification: ✓ Aligned (related apps for running)
```

**Key Insight**: No hardcoded keywords needed. The model understands semantic relationships:
- "Product Spec" → Linear, Notion, planning tools
- "Data Analysis" → Jupyter, SQL, Python
- "UX Prototype" → Figma, design tools
- "Morning Run" → fitness apps or no digital activity

---

**Document Version**: 1.0
**Last Updated**: 2025-10-25
**Author**: Thopiax (with Claude)
**Status**: Ready for implementation

---

*"Reduce the distance from intent to action. Technology as a mirror, not a master."*
