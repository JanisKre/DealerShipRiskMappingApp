import { uiLocale } from "./format";

/** Local date of a hail replay moment. */
export function replayDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(uiLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Local clock time of a hail replay moment. */
export function replayClockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(uiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
