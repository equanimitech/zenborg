"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The week reads back in Harvest, which opens on it. */
export default function WeekPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/harvest");
  }, [router]);

  return null;
}
