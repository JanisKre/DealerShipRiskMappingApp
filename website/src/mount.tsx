import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { LangProvider } from "@/lib/i18n";

/**
 * The page renders after the browser has tried to jump to the URL's anchor,
 * so links like docs/installation/#unsigned-builds would otherwise land at
 * the top. Repeat the jump once the content exists.
 */
function ScrollToHash(): null {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
  }, []);
  return null;
}

/** Shared bootstrap for every HTML entry (index.html and the docs pages). */
export function mount(page: React.ReactNode): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <LangProvider>
        {page}
        <ScrollToHash />
      </LangProvider>
    </StrictMode>,
  );
}
