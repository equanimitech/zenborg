# Zenborg

> A garden for your attention. Plant what you want to grow, grow it with the people and
> places you care about, fence out the weeds, and return to tend it every day.

**You are the gardener.** Your garden is your habit ecosystem, digital and physical. You
are responsible for tending it, and you already do. Zenborg is the toolshed: it helps you
tend with more consistency, and return with more resilience when something wilts.

*What will I tend to today?*

**[equanimi.tech/zenborg](https://equanimi.tech/zenborg)**

## Four gestures

- 🌱 **Plant**: areas of your life, habits, moments of 1–3 words, cycles
- 🤝 **Companion**: people and places, each held with an intention
- 🚧 **Fence**: fence out the weeds (sites, feeds)
- 🪴 **Tend**: sunrise, sunset, weather, season. Phases, not hours.

It is not a habit tracker, not a task manager, not a screen-time app, not a platform. No
streaks, no scores, no notifications, no accounts. Your garden lives on your machine.

## Install

- **App (macOS):** download the latest release from
  [GitHub Releases](https://github.com/equanimitech/zenborg/releases/latest).
- **Claude (optional):** the Claude Code plugin in [`plugin/`](plugin/README.md) opens and
  closes the day with you, and the MCP server in [`mcp-server/`](mcp-server/) lets any
  agent read and tend the same garden.
- **Browser (optional):** the extension in [`extension/`](extension/) puts your fences
  around the browser.

## Develop

```bash
pnpm install
pnpm dev          # web build at http://localhost:3000
pnpm tauri dev    # desktop app
pnpm test
```

## License

MIT. See [LICENSE](./LICENSE).
