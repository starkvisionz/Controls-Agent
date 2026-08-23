"use client";

import { useResource } from "@/lib/use-resource";
import type { AuditEvent } from "@/lib/audit";
import { ChangeList, describeAction, when } from "./ChangeList";

/**
 * The last few changes to one record, for the inspectors.
 *
 * Loaded on its own rather than with the record, because it is the part of the
 * panel nobody scrolls to first — and because a record with no history should
 * cost nothing to show.
 */
export function EntityHistory({
  entityType,
  entityId,
  limit = 5,
}: {
  entityType: "task" | "risk" | "document" | "change_order";
  entityId: string;
  limit?: number;
}) {
  const { data, error } = useResource<{ events: AuditEvent[] }>(
    `/api/audit?entity=${entityType}&id=${encodeURIComponent(entityId)}`
  );

  // Silent on failure. History is context, and a record whose log could not be
  // read is not a reason to put an error in front of somebody editing it.
  if (error) return null;

  const events = (data?.events ?? []).slice(0, limit);
  if (events.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-2.5">
      <div className="label mb-1.5">History</div>
      <ol className="flex flex-col gap-1.5">
        {events.map((e) => (
          <li key={e.id} className="text-[10px] leading-relaxed">
            <div className="flex items-baseline gap-1.5">
              <span className="text-ink-dim">{e.actor_name}</span>
              <span className="text-ink-faint">{describeAction(e.action)}</span>
              <span className="ml-auto shrink-0 font-mono text-ink-faint" title={e.at}>
                {when(e.at)}
              </span>
            </div>
            {e.changes.length > 0 ? (
              <div className="mt-0.5 text-ink-mute">
                <ChangeList changes={e.changes} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
