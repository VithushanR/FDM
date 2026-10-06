import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/print.css";
import "./styles/app.css";
import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The page has no #root element.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
