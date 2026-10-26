import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { boot } from "./boot";

const root = createRoot(document.getElementById("app")!);
boot().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (error) => {
    const box = document.createElement("div");
    box.className = "p-4 text-danger";
    box.textContent = "SJMR Cheque Writer cannot start: " + (error instanceof Error ? error.message : String(error));
    document.getElementById("app")!.replaceChildren(box);
  },
);
