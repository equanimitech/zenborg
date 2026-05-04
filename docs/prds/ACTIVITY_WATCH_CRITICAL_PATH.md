# ActivityWatch Integration - Critical Path Validation

**Purpose**: Validate the core hypothesis before building the full system
**Timeline**: 2-3 days
**Goal**: Answer the question: "Does semantic AI classification + ambient feedback actually help reduce attention drift?"

---

## The Core Hypothesis

> **"An ambient compass indicator showing real-time semantic alignment between stated intention and observed activity will help users notice and correct attention drift faster than passive reflection alone."**

### What We're Testing

1. **Can a local LLM accurately classify alignment** between a stated work intention and observed computer activity?
2. **Is the classification fast enough** for real-time feedback (< 2 seconds)?
3. **Does ambient feedback feel helpful** or intrusive/distracting?
4. **Do users actually self-correct** when they notice drift, or ignore it?

### What We're NOT Testing (Yet)

- Full Zenborg integration
- Multi-phase day planning
- Zero-config setup
- Settings/privacy controls
- Historical tracking

---

## Minimal Viable Test (MVT)

### What to Build

**A standalone CLI tool** that:
1. Polls ActivityWatch for last 15 minutes of activity
2. Prompts user for current intention (e.g., "Product Spec")
3. Classifies alignment using Ollama (local LLM)
4. Prints result to terminal in real-time

**No UI. No persistence. Just the core loop.**

### Technical Stack

- **Language**: TypeScript/Node.js
- **ActivityWatch Client**: REST API calls to `http://localhost:5600`
- **Classifier**: Transformer.js with BART or DeBERTa (zero-shot classification)
- **Output**: Terminal only (colored text for states)

### Implementation (4-6 hours)

```typescript
import { pipeline } from '@xenova/transformers'

// Load classifier once (auto-downloads model on first run)
const classifier = await pipeline(
  'zero-shot-classification',
  'facebook/bart-large-mnli'
)

while (true) {
  // 1. Get current intention from user (just the moment name)
  const momentName = await promptUser("What are you working on?")
  // e.g., "Product Spec", "Data Analysis", "Morning Run"

  // 2. Poll ActivityWatch every 5 minutes
  await sleep(5 * 60 * 1000)

  // 3. Fetch recent activity (last 15 min)
  const activity = await fetchActivityWatch({
    start: now - 15min,
    end: now
  })

  // 4. Aggregate events
  const summary = aggregateActivity(activity)
  // { "Chrome - Linear": 480s, "Chrome - Twitter": 120s, ... }

  // 5. Build activity description
  const activityText = Object.entries(summary)
    .map(([key, duration]) => `${key} (${duration}s)`)
    .join(', ')

  const description = `
    Current intention: ${momentName}
    Recent activity: ${activityText}
  `

  // 6. Classify with Transformer.js (moment name is semantic anchor)
  const result = await classifier(description, [
    `working on: ${momentName}`,  // e.g., "working on: Product Spec"
    'distracted or browsing unrelated content',
    'neutral or transitional activity',
    'no significant activity'
  ])

  const classification = result.labels[0]
  const confidence = result.scores[0]

  // 7. Print to terminal
  printCompass(classification) // 🧭 ↑ or 🧭 ↙
  console.log(`Confidence: ${(confidence * 100).toFixed(0)}%`)
}
```

---

## Test Protocol

### Setup (Day 0)

1. Install ActivityWatch (manual setup is fine for MVT)
2. `npm install @xenova/transformers` (auto-downloads BART on first run)
3. Build CLI tool (2-4 hours - simpler than Ollama approach)
4. Verify: Run tool, confirm it fetches AW data and classifies with Transformer.js

### Day 1: Personal Dogfooding

**Morning Session (3 hours)**:
- Set intention: "Product Spec" (just the moment name)
- Work normally for 3 hours
- Observe compass updates every 5 min
- Note: When did you notice drift? Did you self-correct?

**Questions to Answer**:
- Was classification accurate? (subjective)
- Did you notice the compass updates?
- Did seeing "drifting" cause you to refocus?
- Was 5-min polling too slow/too fast?

**Afternoon Session (3 hours)**:
- Set intention: "Data Analysis"
- Intentionally drift to Twitter/email after 30 min
- Observe: How long until compass shows "drifting"?
- Self-correct: Does returning to Jupyter change compass back to "aligned"?

**Questions to Answer**:
- How quickly did the classifier detect drift?
- Was the feedback helpful or annoying?
- Did you feel guilt, or just awareness?

### Day 2: Shared Testing

**Recruit 1-2 colleagues**:
- Give them the CLI tool
- Ask them to set intentions for their work (product/data/ux/strategy)
- Run for 4-6 hours
- Debrief: Interview about experience

**Interview Questions**:
1. "On a scale of 1-10, how accurate was the classification?"
2. "Did you notice drift earlier than you normally would?"
3. "Did the compass feel like a gentle mirror or an annoying nag?"
4. "Would you use this daily if it was built into Zenborg?"
5. "What would make this more useful?"

---

## Success Criteria

### Must Pass (Go/No-Go)

✅ **Classification accuracy > 70%** (subjective, user agreement with classifier)
✅ **Response time < 1 second** (Transformer.js inference completes quickly)
✅ **Users self-correct at least once** when shown "drifting"
✅ **No one says "this is annoying/distracting"** (neutral or positive feedback only)

### Nice to Have

⭐ Classification accuracy > 85%
⭐ Users proactively check compass (not just passive glances)
⭐ Users request "show me when I've been aligned for 2+ hours" (positive reinforcement)

### Failure Modes (Stop/Rethink)

❌ **Classification < 60% accurate** → Zero-shot not working, try semantic similarity instead
❌ **Response time > 2 seconds** → Too slow for real-time, switch to smaller/faster model
❌ **Users ignore compass entirely** → Ambient feedback ineffective, try different UI
❌ **Users feel guilt/shame** → Messaging is wrong, need gentler framing

---

## Example Test Session (User POV)

```bash
$ npm run test-compass

🧭 Attention Compass - ActivityWatch Integration Test
Loading classifier... (first run downloads BART model ~400MB)
✓ Classifier ready (facebook/bart-large-mnli)

What are you working on? (moment name, 1-3 words)
> Product Spec

✓ Monitoring ActivityWatch every 5 minutes...
  Press Ctrl+C to stop or change intention

[5 minutes pass]

─────────────────────────────────────────
🧭 ↑ ALIGNED (confidence: 82%)

Recent activity:
- Linear - Product Roadmap (4m 20s)
- Chrome - Notion PRD (3m 10s)
- Slack - #product-team (1m 30s)
─────────────────────────────────────────

[10 minutes pass]

─────────────────────────────────────────
🧭 ↙ DRIFTING (confidence: 91%)

Recent activity:
- Chrome - Twitter (8m 40s)
- Chrome - Hacker News (4m 20s)
- Linear - Product Roadmap (2m 00s)
─────────────────────────────────────────

[User sees "drifting", closes Twitter, returns to Linear]

[15 minutes pass]

─────────────────────────────────────────
🧭 ↑ ALIGNED (confidence: 88%)

Recent activity:
- Linear - Product Roadmap (12m 30s)
- Chrome - Notion PRD (2m 30s)
─────────────────────────────────────────
```

---

## Decision Points

### After Day 1 (Personal Test)

**If positive** → Proceed to Day 2 (shared testing)
**If mixed** → Iterate on prompt/polling interval, test again
**If negative** → Stop, rethink approach (maybe ambient feedback doesn't work)

### After Day 2 (Shared Test)

**If 2/2 users positive** → Greenlight full Zenborg integration (PRD implementation)
**If 1/2 users positive** → Iterate on UX, test with 2 more users
**If 0/2 users positive** → Stop, fundamental issue with approach

---

## What We Learn

### On Classification Quality

- **Is semantic understanding working?** (e.g., "Slack #product-team" correctly classified as aligned)
- **Are edge cases handled?** (e.g., research on Twitter for product spec)
- **Is zero-shot classification too strict or too lenient?**
- **Does BART work well, or should we try DeBERTa/semantic similarity?**

### On User Behavior

- **Do users notice drift earlier?** (vs. discovering at end of day)
- **Do they self-correct when shown "drifting"?**
- **Do they feel empowered or guilty?**

### On Technical Feasibility

- **Is 5-min polling the right interval?** (or 10 min? 15 min?)
- **Is Transformer.js fast enough for real-time feedback?** (< 1 second?)
- **Does ActivityWatch data quality hold up?** (window titles, URLs accurate?)

---

## Pivot Options (If Hypothesis Fails)

### If Classification Is Inaccurate

**Option A**: Switch from zero-shot to semantic similarity
- Pro: Faster, simpler, often more accurate for narrow domains
- Con: Requires tuning similarity thresholds

**Option B**: Use keyword matching (no ML at all)
- Pro: Fastest, most predictable
- Con: Misses semantic nuance entirely

**Option C**: Let user correct classifications (feedback loop)
- Pro: Improves over time, user feels in control
- Con: Adds friction, doesn't improve model

**Option D**: Try different zero-shot model (DeBERTa instead of BART)
- Pro: May have better accuracy for intent classification
- Con: Still relatively slow compared to similarity

### If Ambient Feedback Is Ineffective

**Option A**: Only show compass on request (`:align` command)
- Pro: Less intrusive
- Con: Defeats real-time awareness goal

**Option B**: Remove real-time feedback, only weekly summaries
- Pro: Aligns with "less granular" philosophy
- Con: Too late to notice drift in the moment

**Option C**: Add gentle sound/haptic (for users who want it)
- Pro: Harder to ignore
- Con: Violates "calm tech" principle

### If Users Feel Guilt/Shame

**Option A**: Reframe language (drop "drifting", use "exploring")
- Pro: Gentler tone
- Con: May feel less truthful

**Option B**: Add positive reinforcement ("You've been aligned for 2 hours!")
- Pro: Balances negative with positive
- Con: Risks gamification

**Option C**: Make compass optional/hideable at all times
- Pro: Respects user agency
- Con: Users may just hide it when uncomfortable

---

## Timeline

**Day 0 (Setup)**: 4-6 hours
- Build CLI tool
- Test AW + Ollama integration
- Verify basic flow works

**Day 1 (Personal Test)**: 6-8 hours of work with compass running
- Morning: aligned work
- Afternoon: intentional drift test
- Evening: notes & reflection

**Day 2 (Shared Test)**: 4-6 hours
- Recruit 1-2 colleagues
- Run sessions
- Debrief interviews (30 min each)

**Day 3 (Decision)**: 2 hours
- Synthesize findings
- Make go/no-go decision
- Document learnings

**Total**: 2-3 days end-to-end

---

## Deliverables

1. **CLI tool** (open-source, can share with testers)
2. **Test notes** (markdown doc with observations)
3. **Interview summaries** (anonymized quotes/themes)
4. **Go/No-Go decision doc** (based on success criteria)
5. **Learnings** (what worked, what didn't, what to change)

---

## Next Steps After Validation

### If "Go" (Hypothesis Validated)

1. Proceed with full PRD implementation
2. Integrate into Zenborg (Phases 1a-1e)
3. Design compass UI component (not just CLI)
4. Add settings/privacy controls
5. Ship as opt-in beta to users

### If "No-Go" (Hypothesis Failed)

1. Document failure mode(s)
2. Explore pivot options (see above)
3. Consider alternative approaches:
   - Manual check-ins (`:align` command on demand)
   - Weekly reflection only (no real-time)
   - Simple keyword matching (no AI)
4. Re-test with pivoted approach

---

## Philosophy Check

**Does this test maintain Zenborg principles?**

✅ **Calm technology**: CLI output is passive, not intrusive
✅ **Local-first**: All processing local (AW + Ollama)
✅ **Privacy-first**: No data sent to cloud
✅ **User agency**: Can stop test anytime (Ctrl+C)
✅ **No metrics**: Shows alignment state, not scores/percentages

**Does it test the right thing?**

✅ **Core value prop**: Does semantic awareness reduce drift?
✅ **Technical feasibility**: Is LLM fast/accurate enough?
✅ **User experience**: Does ambient feedback feel helpful?
✅ **Minimal viable**: No over-engineering, just essentials

---

## Key Questions to Answer

1. **Does it work?** (technically: AW → LLM → classification)
2. **Is it fast?** (< 2-3 seconds end-to-end)
3. **Is it accurate?** (> 70% user agreement with classification)
4. **Is it useful?** (users self-correct when shown drift)
5. **Is it calm?** (no guilt, no distraction)

**If all 5 are "yes" → Build the full thing.**
**If any are "no" → Pivot or stop.**

---

## Bonus: Journal Note Semantic Annotation

Since we're already loading Transformer.js models for ActivityWatch classification, **the same models can power semantic journal features**:

### Use Cases

**1. Semantic Search**
```typescript
// Find journal entries related to current moment
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')

const momentEmbedding = await embedder("Product Spec: prioritizing roadmap")
const noteEmbeddings = await embedder(journalNotes.map(n => n.content))

const similarities = cosineSimilarity(momentEmbedding, noteEmbeddings)
const relatedNotes = journalNotes
  .map((note, i) => ({ note, score: similarities[i] }))
  .filter(({ score }) => score > 0.6)
  .sort((a, b) => b.score - a.score)
```

**2. Auto-Linking Notes to Moments**
```typescript
// Find which moment this journal note relates to
const classifier = await pipeline('zero-shot-classification', 'facebook/bart-large-mnli')

// Get all active moments
const moments = ["Product Spec", "Data Analysis", "Morning Run", "Deep Reading"]

const result = await classifier(journalNote.content, moments)

journalNote.relatedMoment = result.labels[0]  // Most likely moment
journalNote.confidence = result.scores[0]
```

**3. Find Similar Past Moments**
```typescript
// When creating moment "Product Spec", show related past moments
const currentEmbedding = await embedder("Product Spec")
const pastEmbeddings = await embedder(pastMoments.map(m => m.name))

const similar = pastMoments
  .map((m, i) => ({ moment: m, score: similarities[i] }))
  .filter(({ score }) => score > 0.8)
```

### Integration Points

- **Moment creation**: Suggest related journal notes based on moment name
- **Journal writing**: Auto-link notes to the current moment you're working on
- **Reflection**: "Show me notes from when I worked on similar moments"
- **Search**: Semantic search across all notes and moments by name/content

**Advantage**: One model download, multiple features. Zero-config semantic intelligence across the whole app. No need to manually tag or categorize anything.

---

**Status**: Ready to build
**Owner**: Thopiax
**Timeline**: Start ASAP, decide by end of Week 1

---

*"Test the riskiest assumption first. If semantic awareness works, build it. If not, save weeks of implementation."*
