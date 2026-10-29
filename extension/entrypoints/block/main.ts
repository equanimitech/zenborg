/**
 * zenborg block page. The background sends a DNR-blocked top-level load here.
 *
 * It shows what holds (the unlock note) and, on a time block, a pass: one line
 * of why, then "Use a pass, N of 4 left in <month>". The page decides nothing
 * and writes nothing; it asks the background, which checks and records.
 */
import "@/styles/fonts.css";
import { ENTRY, pickQuestion } from "@/modules/fence/questions";
import { passLabel, returnTarget, type PassAllowance } from "@/modules/fence/lifts";

interface Info {
  readonly open: boolean;
  readonly notes: readonly string[];
  readonly pass: (PassAllowance & { readonly left: number; readonly month: string }) | null;
}

const params = new URLSearchParams(location.search);
const host = params.get("host") ?? "";
const blockedUrl = params.get("u");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("pass");
const why = $<HTMLInputElement>("why");
const use = $<HTMLButtonElement>("use");
const none = $<HTMLParagraphElement>("none");

$("host").textContent = host;
if (host) $("why-label").textContent = pickQuestion(ENTRY, host, Date.now());

const goOn = (): void => location.replace(returnTarget(blockedUrl, host));

function render(info: Info): void {
  if (info.open) return goOn(); // already open: this page never shows
  $("note").textContent = info.notes.join("\n");
  if (info.pass === null) return;
  if (info.pass.left <= 0) {
    none.hidden = false;
    return;
  }
  use.textContent = passLabel(info.pass.left, info.pass.perMonth, info.pass.month);
  form.hidden = false;
}

why.addEventListener("input", () => {
  use.disabled = why.value.trim() === "";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const reason = why.value.trim();
  if (reason === "") return;
  use.disabled = true;
  why.disabled = true;
  void browser.runtime
    .sendMessage({ type: "zenborg-use-pass", host, reason })
    .then((raw: unknown) => {
      const res = raw as { ok?: boolean; error?: string } | undefined;
      if (res?.ok) return goOn();
      if (res?.error === "none_left") {
        form.hidden = true;
        none.hidden = false;
        return;
      }
      why.disabled = false;
      use.disabled = false;
    })
    .catch(() => {
      why.disabled = false;
      use.disabled = false;
    });
});

// Back skips the blocked entry behind this page (going there would only block
// again). With nothing before it, the background closes the tab.
$("back").addEventListener("click", () => {
  if (history.length > 2) history.go(-2);
  else void browser.runtime.sendMessage({ type: "kairos-gate-leave" }).catch(() => window.close());
});

void browser.runtime
  .sendMessage({ type: "zenborg-block-info", host })
  .then((info: unknown) => {
    if (info) render(info as Info);
  })
  .catch(() => {});

async function noteIncognito(): Promise<void> {
  try {
    const allowed = await browser.extension.isAllowedIncognitoAccess();
    $("foot").textContent = allowed
      ? "holds here and in incognito."
      : "tip: enable zenborg in incognito so this holds there too.";
  } catch {
    $("foot").textContent = "";
  }
}

void noteIncognito();
