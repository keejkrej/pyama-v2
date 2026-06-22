import type { ComponentProps } from "react";
import { useCallback, useEffect, useId, useState } from "react";

import { getLiscaWebSocketUrl } from "../host/liscaHostPorts";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { cn } from "../ui/utils";
import { showErrorToast } from "./toast";

export type LiscaServerConnectionButtonProps = {
  className?: string;
  /** When set, used as-is. Otherwise matches navbar “Tools”: outline when idle, default while the dialog is open. */
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  /** When true, stretch to container width (e.g. Studio nav rail). */
  block?: boolean;
};

const LISCA_WS_URL_PARAM = "liscaWsUrl";

function isWsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

export function LiscaServerConnectionButton({
  className,
  variant,
  size = "sm",
  block,
}: LiscaServerConnectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [draftWsUrl, setDraftWsUrl] = useState("");
  const fieldId = useId();

  const triggerVariant = variant ?? (open ? "default" : "outline");

  useEffect(() => {
    if (!open) return;
    setDraftWsUrl(getLiscaWebSocketUrl());
  }, [open]);

  const apply = useCallback(() => {
    const trimmed = draftWsUrl.trim();
    if (trimmed !== "" && !isWsUrl(trimmed)) {
      showErrorToast("Enter a valid ws:// or wss:// URL, or clear to use the default");
      return;
    }

    const next = new URL(window.location.href);
    if (trimmed === "") {
      next.searchParams.delete(LISCA_WS_URL_PARAM);
    } else {
      next.searchParams.set(LISCA_WS_URL_PARAM, trimmed);
    }
    window.location.assign(next.toString());
  }, [draftWsUrl]);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={size}
        className={cn(!block && "min-w-[5.5rem]", block && "w-full", className)}
        onClick={() => setOpen(true)}
      >
        Server
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Backend server</DialogTitle>
            <DialogDescription>Reloads after apply. Blank clears the override.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-2 px-4 py-3">
            <Label htmlFor={fieldId} className="text-muted-foreground">
              WebSocket URL
            </Label>
            <Input
              id={fieldId}
              value={draftWsUrl}
              onChange={(e) => setDraftWsUrl(e.target.value)}
              placeholder="ws://127.0.0.1:3412"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void apply()}>
              Apply
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
