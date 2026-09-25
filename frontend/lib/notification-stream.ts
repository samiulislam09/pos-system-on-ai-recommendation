"use client";

import { useEffect, useRef } from "react";
import { API_URL } from "@/lib/api";

export interface StreamEvent {
  /** Text of a new notification, or null when something only changed. */
  message: string | null;
}

const MAX_BACKOFF_MS = 30_000;

export interface StreamSource {
  /** API path of the SSE endpoint. */
  path: string;
  getToken: () => string | null;
  /** Returns a fresh access token, or null when the session is over. */
  refresh: () => Promise<string | null>;
}

/**
 * Keeps a Server-Sent Events connection to a notification feed open while
 * mounted, reconnecting with backoff. Uses fetch rather than EventSource so
 * the token travels in the Authorization header instead of the URL. `source`
 * must be a stable (module-level) object.
 */
export function useNotificationStream(source: StreamSource, onEvent: (event: StreamEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const abort = new AbortController();
    let backoff = 1000;
    let connectedBefore = false;

    const connect = async (): Promise<void> => {
      const token = source.getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}${source.path}`, {
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (res.status === 401) {
        if (await source.refresh()) return connect();
        return; // Session is over; the next API call sends the user to login.
      }
      if (!res.ok || !res.body) throw new Error(`Stream failed with status ${res.status}`);

      backoff = 1000;
      // Anything sent while we were disconnected was missed; catch up once.
      if (connectedBefore) handler.current({ message: null });
      connectedBefore = true;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          dispatch(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
      throw new Error("Stream closed");
    };

    const dispatch = (frame: string) => {
      let type = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (type !== "notification") return; // e.g. heartbeat pings
      try {
        const parsed = JSON.parse(data.join("\n")) as Partial<StreamEvent>;
        handler.current({ message: parsed.message ?? null });
      } catch {
        handler.current({ message: null });
      }
    };

    (async () => {
      while (!abort.signal.aborted) {
        try {
          await connect();
          if (!source.getToken()) return;
        } catch {
          if (abort.signal.aborted) return;
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    })();

    return () => abort.abort();
  }, [source]);
}
