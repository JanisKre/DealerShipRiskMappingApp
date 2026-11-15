import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n"; // first: the studio's texts (and the shared dialogs' close label)
import { App } from "./App";
import "./studio.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
