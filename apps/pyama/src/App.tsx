import {
  RouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";
import { createHostPorts } from "@/viewer/host";
import type { ViewerDataPort, ViewerHostPort } from "@/shared/contracts";
import { useMemo } from "react";

import { routeTree } from "./routeTree.gen";

const ports = createHostPorts();

export interface ViewerRouterContext {
  dataPort: ViewerDataPort;
  hostPort: ViewerHostPort;
}

export function createViewerRouter(context: ViewerRouterContext) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context,
  });
}

export type ViewerRouter = ReturnType<typeof createViewerRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: ViewerRouter;
  }
}

export default function App() {
  const router = useMemo(
    () => createViewerRouter({ dataPort: ports.dataPort, hostPort: ports.hostPort }),
    [],
  );

  return <RouterProvider router={router} />;
}
