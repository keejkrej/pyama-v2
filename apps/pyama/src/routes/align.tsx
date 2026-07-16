import { createFileRoute } from "@tanstack/react-router";
import { ViewerApp } from "@/viewer/react";

export const Route = createFileRoute("/align")({
  component: AlignRoute,
});

function AlignRoute() {
  const { dataPort, hostPort } = Route.useRouteContext();

  return <ViewerApp dataPort={dataPort} hostPort={hostPort} />;
}
