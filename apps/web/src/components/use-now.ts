"use client";

import { useEffect, useState } from "react";

const STEP_MS = 5 * 60_000;
const roundedNow = () => Math.floor(Date.now() / STEP_MS) * STEP_MS;

/** The time, in five-minute steps. The queries take it so "today" rolls over at midnight. */
export function useNow(): number {
  const [now, setNow] = useState(roundedNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(roundedNow()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
