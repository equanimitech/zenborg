// Shared byte-for-byte by extension/modules/domain/ and src/domain/attention/browser/
// (the MCP server cannot import from extension/). The root suite pins the copies
// (src/domain/attention/__tests__/browserVendored.test.ts): change both together.

/**
 * Branded value objects for type safety across the zenborg platform.
 *
 * These use TypeScript's branded types pattern to prevent
 * accidental mixing of semantically different values
 * (e.g., passing a raw number where a Duration is expected).
 *
 * No runtime cost — brands are erased at compile time.
 */

// ── Duration ────────────────────────────────────────────────────

/** Duration in milliseconds, branded for type safety. */
export type Duration = number & { readonly __brand: "Duration" };

export const createDuration = (ms: number): Duration => ms as Duration;

export const fromMinutes = (minutes: number): Duration =>
  createDuration(minutes * 60 * 1000);

export const toMinutes = (duration: Duration): number =>
  duration / (60 * 1000);

// ── Domain ──────────────────────────────────────────────────────

/** A website domain (e.g., "youtube.com"), branded for type safety. */
export type Domain = string & { readonly __brand: "Domain" };

export const createDomain = (domain: string): Domain =>
  domain.toLowerCase().replace(/^www\./, "") as Domain;

// ── AppName ─────────────────────────────────────────────────────

/** A macOS application name (desktop surface only), branded for type safety. */
export type AppName = string & { readonly __brand: "AppName" };

export const createAppName = (name: string): AppName => name as AppName;
