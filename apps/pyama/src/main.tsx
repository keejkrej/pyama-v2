import React from "react";
import ReactDOM from "react-dom/client";

import { QueryProvider } from "@/shared/query";
import "./fonts.css";
import "@/viewer/react/app/viewer.css";

import App from "./App";

document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryProvider>
      <App />
    </QueryProvider>
  </React.StrictMode>,
);
