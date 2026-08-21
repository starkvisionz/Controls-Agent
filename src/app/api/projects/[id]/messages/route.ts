import { NextResponse } from "next/server";
import { run } from "@/lib/db";
import { getOrCreateConversation, getProject, listMessages } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const conversationId = getOrCreateConversation(project.id);
  return NextResponse.json({ conversationId, messages: listMessages(conversationId) });
}

/** Clears the thread — the panel's "new conversation" action. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const conversationId = getOrCreateConversation(project.id);
  run(`DELETE FROM chat_messages WHERE conversation_id = ?`, [conversationId]);
  return NextResponse.json({ conversationId, messages: [] });
}
