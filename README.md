# Zenborg

> A garden for your attention. Plant what you want to grow, with the people and places
> you care about. Cultivate it every day: tend what matters, fence out the weeds. Harvest
> what it teaches you, and tune the next season.

**You are the gardener.** Your garden is your habit ecosystem, digital and physical. You
are responsible for tending it, and you already do. Zenborg is the toolshed: it helps you
tend with more consistency, and return with more resilience when something wilts.

*What will I tend to today?*

**[equanimi.tech/zenborg](https://equanimi.tech/zenborg)**

## Three tabs

- 🌱 **Plant**: habits, people, places. What you grow, with whom, and where.
- 🪴 **Cultivate**: tend and fence. Every day, tend what matters and fence out the weeds.
- 🌾 **Harvest**: reflect and tune. What it taught you; retune for the next season.

It is not a habit tracker, not a task manager, not a screen-time app, not a platform. No
streaks, no scores, no notifications, no accounts. Your garden lives on your machine.

## Install

- **App (macOS):** download the latest release from
  [GitHub Releases](https://github.com/equanimitech/zenborg/releases/latest).
- **Claude (optional):** the Claude Code plugin in [`plugin/`](plugin/README.md) walks the
  same three tabs with you (Plant: `onboarding`; Cultivate: `sunrise`, `tend`, `sunset`,
  `close-up` and the fence hook; Harvest: `weather`, `weekly-moments-review`, `season`),
  and the MCP server in [`mcp-server/`](mcp-server/) lets any
  agent read and tend the same garden.
- **Browser (optional):** the extension in [`extension/`](extension/) puts your fences
  (which live in Cultivate) around the browser.

## Develop

```bash
pnpm install
pnpm dev          # web build at http://localhost:3000
pnpm tauri dev    # desktop app
pnpm test
```

## License

MIT. See [LICENSE](./LICENSE).
