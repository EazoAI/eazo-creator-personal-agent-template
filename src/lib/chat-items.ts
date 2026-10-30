import type { MuseStep, MuseStepUpdate } from "@/shared/muse-events";

export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "progress" | "step" | "thinking";
  text: string;
  /** role === "step": the tool call it renders. */
  step?: MuseStep;
  /** role === "step": seqs of the notes already folded in (replay-safe dedup). */
  noteSeqs?: number[];
}

const stepItemId = (stepId: string) => `step-${stepId}`;

/**
 * Merge a streamed chunk into the text shown so far. Providers differ: some send
 * token deltas, others the whole growing text on every event (same as the Qoni Console).
 */
export function mergeStreamingText(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming || incoming === current || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

export function applyStepUpdate(prev: ChatItem[], update: MuseStepUpdate): ChatItem[] {
  if (update.type === "lifecycle") {
    const { step } = update;
    const id = stepItemId(step.id);
    const idx = prev.findIndex((p) => p.id === id);
    if (idx < 0) return [...prev, { id, role: "step", text: step.label, step, noteSeqs: [] }];
    const existing = prev[idx];
    // A retry (`started X → failed X → started X`) restarts the same entry.
    const restarted = step.status === "running" && existing.step?.status !== "running";
    const copy = [...prev];
    copy[idx] = {
      ...existing,
      text: step.label || existing.text,
      step: {
        ...existing.step,
        ...step,
        label: step.label || existing.step?.label || "",
        notes: restarted ? [] : existing.step?.notes,
      },
      noteSeqs: restarted ? [] : existing.noteSeqs,
    };
    return copy;
  }
  const id = stepItemId(update.stepId);
  const idx = prev.findIndex((p) => p.id === id);
  if (idx < 0) return prev;
  const existing = prev[idx];
  if (existing.noteSeqs?.includes(update.seq)) return prev;
  const copy = [...prev];
  copy[idx] = {
    ...existing,
    step: existing.step ? { ...existing.step, notes: [...(existing.step.notes ?? []), update.note] } : existing.step,
    noteSeqs: [...(existing.noteSeqs ?? []), update.seq],
  };
  return copy;
}
