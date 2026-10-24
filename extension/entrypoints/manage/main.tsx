/**
 * Manage page bootstrap — the fence dashboard.
 *
 * Replaces the vanilla-TS "areas" page (history + watchlist) with a React
 * app. History moves to zenborg harvest; watchlist management retires because
 * observe is now derived from fences ∪ area-map (Task 1). What is left is
 * read-mostly: fences, area-map assignment, activity export.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { Manage } from "./Manage";
import "./style.css";

// kairos theme on the document root (system-aware). Manage is kairos-owned, so
// it carries kairos's own light/dark via [data-kairos-theme] (see
// ../../styles/tokens.css).
const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (dark: boolean) =>
  document.documentElement.setAttribute(
    "data-kairos-theme",
    dark ? "dark" : "light"
  );
applyTheme(media.matches);
media.addEventListener("change", (e) => applyTheme(e.matches));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Manage />
  </React.StrictMode>
);
