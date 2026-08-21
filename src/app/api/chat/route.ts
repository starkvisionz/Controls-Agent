import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { run } from "@/lib/db";
import { AGENT_SYSTEM_PROMPT, buildProjectBriefing } from "@/lib/agent-context";
import { localAnswer } from "@/lib/agent-local";
import { getOrCreateConversation, getProject, listMessages } from "@/lib/queries";
import type { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5";

/** How many prior turns to replay to the model. */
const HISTORY_TURNS = 12;

type ChatRequest = { projectId?: string; message?: string };

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const question = body.message?.trim();
  if (!question) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const project = body.projectId ? getProject(body.projectId) : undefined;
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const conversationId = getOrCreateConversation(project.id);
  const history = listMessages(conversationId);

  // Persist the question before answering, so a dropped stream still leaves a
  // coherent thread behind.
  const userMessageId = randomUUID();
  run(
    `INSERT INTO chat_messages (id, conversation_id, project_id, role, content)
     VALUES (?, ?, ?, 'user', ?)`,
    [userMessageId, conversationId, project.id, question]
  );

  const assistantMessageId = randomUUID();
  const usingClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";

      const emit = (text: string) => {
        answer += text;
        controller.enqueue(sse("delta", { text }));
      };

      try {
        controller.enqueue(
          sse("start", {
            id: assistantMessageId,
            userMessageId,
            conversationId,
            source: usingClaude ? "claude" : "local",
            model: usingClaude ? MODEL : "hermes-local-analyst",
          })
        );

        if (usingClaude) {
          await streamFromClaude(project, question, history, emit);
        } else {
          await streamLocally(project, question, emit);
        }

        run(
          `INSERT INTO chat_messages (id, conversation_id, project_id, role, content)
           VALUES (?, ?, ?, 'assistant', ?)`,
          [assistantMessageId, conversationId, project.id, answer]
        );
        run(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [conversationId]);

        controller.enqueue(sse("done", { id: assistantMessageId, content: answer }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(sse("error", { message: detail }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops proxies from buffering the stream into a single chunk.
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------

async function streamFromClaude(
  project: Project,
  question: string,
  history: { role: string; content: string }[],
  emit: (text: string) => void
) {
  const client = new Anthropic();

  const priorTurns: Anthropic.MessageParam[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const briefing = buildProjectBriefing(project);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: AGENT_SYSTEM_PROMPT,
        // The instruction set is byte-stable across every request; the briefing
        // and the question that follow are not, so the breakpoint goes here.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      ...priorTurns,
      {
        role: "user",
        content: `<project_briefing>\n${briefing}\n</project_briefing>\n\n${question}`,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      emit(event.delta.text);
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    emit("\n\n_The model declined to answer this request._");
  }
}

/**
 * Replays the offline answer at a readable pace so the panel behaves
 * identically whether or not an API key is configured.
 */
async function streamLocally(project: Project, question: string, emit: (text: string) => void) {
  const text = localAnswer(project, question);
  const chunks = text.match(/\S+\s*/g) ?? [text];

  for (let i = 0; i < chunks.length; i += 3) {
    emit(chunks.slice(i, i + 3).join(""));
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}
