import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@renderer/i18n"; // the shared dialog/sheet components use i18next for their close labels
import { App } from "./App";
import "./studio.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
