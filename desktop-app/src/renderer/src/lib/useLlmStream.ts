import { useCallback, useEffect, useRef, useState } from "react";
import type { LlmStreamChunk, LlmStreamRequest } from "@shared/ipc-schema";

interface StreamState {
  text: string;
  streaming: boolean;
  error: string | null;
  /** Only set for NL query: hit IDs from phase 1. */
  matchedIds: string[] | null;
}

/**
 * Wraps an LLM stream over `window.api.llmStream`. `start(req)` begins a
 * new stream (aborting a running one); tokens are accumulated. Cleans up
 * automatically on unmount.
 */
export function useLlmStream(): StreamState & {
  start: (req: LlmStreamRequest) => void;
  cancel: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<StreamState>({
    text: "",
    streaming: false,
    error: null,
    matchedIds: null,
  });
  const stopRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setState((s) => ({ ...s, streaming: false }));
  }, []);

  const reset = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setState({ text: "", streaming: false, error: null, matchedIds: null });
  }, []);

  const start = useCallback((req: LlmStreamRequest) => {
    stopRef.current?.();
    setState({ text: "", streaming: true, error: null, matchedIds: null });

    stopRef.current = window.api.llmStream(req, (chunk: LlmStreamChunk) => {
      setState((s) => {
        switch (chunk.type) {
          case "token":
            return { ...s, text: s.text + chunk.token };
          case "filter":
            return { ...s, matchedIds: chunk.matchedIds };
          case "done":
            return { ...s, streaming: false };
          case "error":
            return { ...s, streaming: false, error: chunk.message };
          default:
            return s;
        }
      });
    });
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  return { ...state, start, cancel, reset };
}
