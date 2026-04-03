import { startTransition, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  createRoot(document).render(
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
