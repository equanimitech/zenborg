"use client";

import { useEffect, useState } from "react";
import { initializeStore } from "@/infrastructure/state/initialize";

/**
 * Client-side component that initializes the Legend State store
 * on first mount. This ensures IndexedDB persistence is set up
 * and default data is seeded if needed.
 *
 * Separated into its own component to keep the main layout
 * as a Server Component while handling client-side state initialization.
 */
export function StoreInitializer() {
  const [_isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeStore()
      .then(() => {
        setIsInitialized(true);
      })
      .catch((error) => {
        console.error("[Zenborg] Failed to initialize store:", error);
      });
  }, []);

  // Don't render anything - this is purely for side effects
  // You could optionally show a loading spinner here if desired
  return null;
}
