import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { bootstrapSession } from "@v3/state/session/bootstrap";
import { store } from "@v3/state/store";
import { AppProviders } from "./providers";
import { getRouter } from "./router";
import { registerAppState } from "./state/register";
import "./styles.css";

registerAppState();
bootstrapSession(store);

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
