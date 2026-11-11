import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";
import { installStaleChunkReload } from "./lib/app/staleChunkReload";

installStaleChunkReload();

const container = document.getElementById("root");
if (!container) throw new Error("#root missing in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
