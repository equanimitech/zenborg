/**
 * zenborg block page — shown when the porn Drogue (block notch, f=1, no skip)
 * redirects a main_frame navigation. The page never loaded; nothing here
 * unblocks it. Calm, structural, not punitive (strategy Part VI: nudge > block,
 * meta-awareness not guilt).
 */
import "@/styles/tokens.css";
import "@/styles/fonts.css";

// zenborg-owned theme root (system-aware) so the design tokens resolve.
document.documentElement.setAttribute(
  "data-kairos-theme",
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
);

const back = document.getElementById("back") as HTMLButtonElement | null;
const foot = document.getElementById("foot");

// "go back" walks history past the blocked nav; if there's nowhere to go
// (porn opened in a fresh tab), close the tab instead.
back?.addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});

// Remind that the block holds in incognito too (where porn is most often
// browsed) — but only once it's been allowed there.
async function noteIncognito(): Promise<void> {
  if (!foot) {
    return;
  }
  try {
    const allowed = await browser.extension.isAllowedIncognitoAccess();
    foot.textContent = allowed
      ? "this fence holds in incognito too."
      : "tip: allow zenborg in incognito so this fence holds there too.";
  } catch {
    foot.textContent = "";
  }
}

void noteIncognito();
