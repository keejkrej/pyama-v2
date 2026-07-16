import type { Selection, WorkspaceScan } from "@/lib/contracts";

/** Smallest position, channel 0 when present, first z/time. */
export function initialSelection(scan: WorkspaceScan): Selection {
  return {
    pos: scan.positions[0] ?? 0,
    channel: scan.channels.includes(0) ? 0 : (scan.channels[0] ?? 0),
    z: scan.zSlices[0] ?? 0,
    time: scan.times[0] ?? 0,
  };
}
