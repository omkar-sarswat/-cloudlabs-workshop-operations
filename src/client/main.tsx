import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./tokens.css";
import "./styles.css";
import "./atoms.css";

const root = createRoot(document.getElementById("root")!);
if (import.meta.env.DEV && window.location.pathname === "/styleguide") {
  void Promise.all([import("./styleguide.css"), import("./Styleguide.tsx")]).then(([, { Styleguide }]) => {
    root.render(<React.StrictMode><Styleguide /></React.StrictMode>);
  });
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
