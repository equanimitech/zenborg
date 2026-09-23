import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  // React for the extension PAGES (popup, manage). Content scripts stay vanilla.
  modules: ["@wxt-dev/module-react"],
  // Tailwind v4 for page entrypoints; per-entrypoint CSS scopes utilities.
  // Cast: @tailwindcss/vite resolves vite@7 types while wxt bundles vite@6 —
  // the Plugin shapes differ only in an internal `hotUpdate` `this` type
  // (harmless at runtime). A global vite override would break desktop (vite@7).
  vite: () => ({
    plugins: [tailwindcss()] as never,
    build: {
      // Extension pages load from disk, so a modulepreload hides no network
      // round-trip — it buys nothing. Chromium also resolves the preload in a
      // different "world" than the module import, so every one of them logs a
      // cross-world mismatch plus an unused-preload warning, burying real
      // errors in the console. Off is both quieter and no slower.
      modulePreload: false,
    },
    // Pin the dep-optimizer to source entrypoints. Without this, Vite's dev
    // scanner also globs the build output (outDir "dist") and ENOENTs on stale
    // dist/*.html mid-rebuild (regression from adding @tailwindcss/vite).
    optimizeDeps: {
      entries: ["entrypoints/**/*.html"],
    },
  }),
  manifest: {
    name: "Zenborg",
    // Stable extension ID: Chromium derives a deterministic ID from this
    // public key, so chrome.storage contents and granted permissions survive
    // every rebuild, reload, and browser restart. Public key is safe to commit;
    // private key lives gitignored at .keys/zenborg.pem (originally kairos.pem).
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr4PXcGQDz4++ZW7uNr5Y+T1GCHEid5cwAReGiiLBNyjhO5bhM1PqzZ4fYrrzhMY21N1I7htN1Pp/bhuoqgcl0W+fvtzMicQjrQSaCM4PmSPlZbxg1mETT1EPLGWSKiy1NRj8NXAm6QxKGQNVaNNLH+raMz7zJL58K8lB1VLiwkPpKdAp0qMZbHfjlXBr/qoVlCrZwpQ30kWB1TtEj0x0GXISOjAOEIIXu8PHzf4pjnAy9AeWJxsBRSr0WxekdsWGLYn8Do5HEVM42WWRUERn7eMjrauDLEcaoXZh4mVjBPCrzF76/Inby6cltdZCIBLiHJBfPrtPWjYeF3SU4pM6cwIDAQAB",
    description:
      "A garden for your attention. Fence out the weeds, see where your attention goes, return to what you tend. Private, on your device.",
    // Sovereignty by permission-minimalism (the manifest IS the privacy
    // statement). Note what is DELIBERATELY absent:
    //   • no host_permissions — zenborg injects no scripts via host grants
    //   • declarativeNetRequest, NOT declarativeNetRequestWithHostAccess and
    //     NOT webRequest — zenborg blocks by static rule and literally cannot read
    //     request contents, URLs-as-data, or page bodies.
    //   • storage is local (chrome.storage.local) — no sync, no server.
    // Only egress anywhere in zenborg is the user's own BYOK authoring call.
    // "idle" powers the activity writer's browser_idle/browser_active
    // events (120s detection interval) — still no host permissions.
    //   • nativeMessaging connects ONLY to the zenborg native host registered in
    //     the OS, gated to this extension by the host manifest's
    //     allowed_origins. It relays domains and timings to ~/.zenborg/keel/log, never
    //     page content or URLs, and grants no web access. It is the relay that
    //     lets the browser writer reach the shared substrate.
    //   • favicon reads Chromium's OWN icon cache via /_favicon/. No network
    //     request, no host access — the alternative (a third-party favicon
    //     service) would ship every domain you visit to someone else, which is
    //     the one thing this manifest exists to prevent.
    //   • `history` was added and REMOVED on 2026-08-06. It fed an all-time
    //     visit count beside each domain; the history view replaced that with
    //     runs from the extension's own log, so the permission had nothing left to
    //     justify it. An unused permission on a manifest that calls itself the
    //     privacy statement is worse than a missing feature.
    permissions: [
      "storage",
      "tabs",
      "activeTab",
      "declarativeNetRequest",
      "idle",
      "alarms",
      "nativeMessaging",
      "favicon",
    ],
    // A keyboard path to the cooldown, so reaching for the lock costs less
    // than reaching for the temptation. No popup to open, no menu to find.
    commands: {
      cooldown: {
        suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
        description: "Take a 2-hour break from your fenced sites",
      },
    },
    // Single shared instance in incognito so the porn Drogue's block holds
    // there too (where porn is most often browsed). The user must still flip
    // "Allow in incognito" once — see README. Shared storage = one source of
    // truth for shields/cooldowns across normal + incognito.
    incognito: "spanning",
    // WXT auto-discovers `entrypoints/newtab/index.html` and would register it
    // on its own, but the mapped filename depends on how the dev server names
    // hashed page bundles — spelling it out here is the one line that survives
    // that either way and says explicitly what surface owns the new tab.
    chrome_url_overrides: {
      newtab: "newtab.html",
    },
    // The zenborg block page must be reachable as a redirect target from the
    // porn Drogue's DNR rules.
    web_accessible_resources: [
      {
        resources: ["block.html"],
        matches: ["<all_urls>"],
      },
    ],
    // No static rulesets. The blocklist Drogue uses DNR *dynamic* rules synced
    // from chrome.storage.local (modules/drogues/blocklist + background.ts) —
    // user- and Claude-editable, fully legible. The `declarativeNetRequest`
    // permission above is what those dynamic rules need.
    icons: {
      "16": "/icons/icon-16.png",
      "32": "/icons/icon-32.png",
      "48": "/icons/icon-48.png",
      "128": "/icons/icon-128.png",
    },
  },
});
