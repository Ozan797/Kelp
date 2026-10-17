import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { blockWebMenu } from "./lib/webMenu";
import "./app.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

blockWebMenu(document);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
