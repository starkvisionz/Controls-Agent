"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Eraser, Square, User } from "lucide-react";
import { Markdown } from "./Markdown";
import { IconButton } from "@/components/ui/Controls";
import { useProjects } from "@/components/shell/ProjectContext";
import type { ChatMessage } from "@/lib/types";

type Msg = Pick<ChatMessage, "id" | "role" | "content">;

const SUGGESTIONS = [
  "Where does the project stand?",
  "Break down the cost variance",
  "What's driving the schedule slip?",
  "Which risks need attention?",
  "What should I do about it?",
];

export function AgentPanel({
  onSourceChange,
}: {
  onSourceChange?: (source: "claude" | "local" | null) => void;
}) {
  const { activeProject } = useProjects();
  const projectId = activeProject?.id ?? null;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load the thread whenever the shell points at a different project.
  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      return;
    }
    let cancelled = false;

    fetch(`/api/projects/${projectId}/messages`)
      .then((res) => res.json() as Promise<{ messages: Msg[] }>)
      .then((json) => {
        if (!cancelled) setMessages(json.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Keep the newest content in view as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, partial]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || !projectId || streaming) return;

      setDraft("");
      setError(null);
      setStreaming(true);
      setPartial("");
      setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: question }]);

      const controller = new AbortController();
      abortRef.current = controller;

      let assembled = "";

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, message: question }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error((await res.json().catch(() => ({}))).error ?? "The agent is unreachable");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Parse the SSE frames as they arrive; frames are separated by a blank line.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(7).trim();
            const payload = JSON.parse(dataLine.slice(6));

            if (event === "start") {
              onSourceChange?.(payload.source);
            } else if (event === "delta") {
              assembled += payload.text;
              setPartial(assembled);
            } else if (event === "done") {
              setMessages((prev) => [
                ...prev,
                { id: payload.id, role: "assistant", content: payload.content },
              ]);
              setPartial("");
            } else if (event === "error") {
              setError(payload.message);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "The request failed");
        }
        // Keep whatever streamed before the failure rather than discarding it.
        if (assembled) {
          setMessages((prev) => [
            ...prev,
            { id: `partial-${Date.now()}`, role: "assistant", content: assembled },
          ]);
        }
        setPartial("");
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [projectId, streaming, onSourceChange]
  );

  const stop = () => abortRef.current?.abort();

  const clear = async () => {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/messages`, { method: "DELETE" });
    setMessages([]);
    setPartial("");
    setError(null);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface">
      <header className="panel-head">
        <Bot className="h-3.5 w-3.5 text-accent" />
        <h2 className="text-2xs font-medium text-ink-dim">Controls Agent</h2>
        {activeProject ? (
          <span className="truncate font-mono text-[10px] text-ink-faint tabular">
            {activeProject.code}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {streaming ? (
            <IconButton onClick={stop} title="Stop generating">
              <Square />
            </IconButton>
          ) : null}
          <IconButton onClick={clear} title="Clear conversation" disabled={messages.length === 0}>
            <Eraser />
          </IconButton>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !partial ? (
          <Welcome onPick={send} disabled={!projectId} />
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} />
            ))}
            {partial ? <Bubble role="assistant" content={partial} streaming /> : null}
            {streaming && !partial ? (
              <div className="flex items-center gap-2 text-2xs text-ink-faint">
                <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                Reading the register…
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <div className="mt-3 rounded-sm border border-bad/30 bg-bad-wash px-2.5 py-2 text-2xs text-bad">
            {error}
          </div>
        ) : null}
      </div>

      <Composer
        ref={textareaRef}
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        disabled={!projectId || streaming}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------

function Bubble({
  role,
  content,
  streaming = false,
}: {
  role: string;
  content: string;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="animate-in flex justify-end">
        <div className="flex max-w-[92%] items-start gap-2">
          <div className="rounded-panel rounded-tr-sm border border-line-strong bg-raised px-2.5 py-1.5 text-xs text-ink">
            {content}
          </div>
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-line bg-chrome text-ink-faint">
            <User className="h-3 w-3" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent-wash text-accent">
        <Bot className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <Markdown source={content} />
        {streaming ? <span className="stream-caret" /> : null}
      </div>
    </div>
  );
}

function Welcome({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="flex h-full flex-col justify-end gap-3">
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-medium text-ink">Hermes</span>
        </div>
        <p className="text-xs leading-relaxed text-ink-mute">
          I read this project&apos;s schedule, cost, risk and document registers directly. Ask me
          anything grounded in them — I quote figures from the tables, not from memory.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="label mb-0.5">Try</div>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-sm border border-line bg-raised px-2 py-1.5 text-left text-2xs text-ink-dim transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  ref,
  value,
  onChange,
  onSend,
  disabled,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex-none border-t border-line bg-chrome p-2">
      <div className="flex items-end gap-1.5 rounded-panel border border-line bg-raised p-1.5 focus-within:border-accent/40">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Grow with the content, up to a ceiling.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask about cost, schedule, risk or documents…"
          className="max-h-[140px] min-h-[20px] flex-1 resize-none bg-transparent px-1 text-xs leading-5 text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          title="Send (Enter)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
