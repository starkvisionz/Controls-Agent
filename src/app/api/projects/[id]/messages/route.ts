import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { run } from "@/lib/db";
import { getOrCreateConversation, getProject, listMessages } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The transcript quotes the project's figures back, so reading it needs the
  // same permission as asking in the first place.
  const guard = requirePermission(req, "agent:use", id);
  if (!guard.ok) return guard.response;

  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const conversationId = getOrCreateConversation(project.id);
  return NextResponse.json({ conversationId, messages: listMessages(conversationId) });
}

/** Clears the thread — the panel's "new conversation" action. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = requirePermission(req, "agent:use", id);
  if (!guard.ok) return guard.response;

  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const conversationId = getOrCreateConversation(project.id);
  run(`DELETE FROM chat_messages WHERE conversation_id = ?`, [conversationId]);
  return NextResponse.json({ conversationId, messages: [] });
}
