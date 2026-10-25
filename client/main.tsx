import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LeftRoot, RightRoot } from "./app/roots";
import { mapStore } from "./lib/use-map";
import "./index.css";

function mount(id: string, node: ReactNode) {
  const el = document.getElementById(id);
  if (el) createRoot(el).render(<StrictMode>{node}</StrictMode>);
}

mount("left-pane-root", <LeftRoot />);
mount("right-pane-root", <RightRoot />);
mapStore.start();
