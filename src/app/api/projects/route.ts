import { NextResponse } from "next/server";
import { listProjects, projectMetrics } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Portfolio list, each row carrying enough EVM to render the switcher. */
export async function GET() {
  const projects = listProjects();
  return NextResponse.json({
    projects: projects.map((p) => ({ ...p, metrics: projectMetrics(p) })),
  });
}
