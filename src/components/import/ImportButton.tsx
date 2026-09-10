"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useProjects } from "@/components/shell/ProjectContext";
import { useSession } from "@/components/shell/SessionContext";
import type { Permission } from "@/lib/rbac";
import { ImportDialog } from "./ImportDialog";

/**
 * The toolbar control that opens an import.
 *
 * Hidden from an account that could not make the same change by hand — an
 * import is an edit to the register, whatever door it comes through. The API
 * checks the same permission, so this is tidiness rather than the control.
 */
export function ImportButton({
  register,
  label,
  permission,
  onImported,
}: {
  register: "tasks" | "risks" | "documents" | "change-orders";
  label: string;
  permission: Permission;
  onImported: () => void;
}) {
  const { activeProject } = useProjects();
  const { can } = useSession();
  const [open, setOpen] = useState(false);

  if (!activeProject || !can(permission, activeProject.id)) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Update ${label.toLowerCase()} from a spreadsheet or a P6 export`}
        className="flex h-6 items-center gap-1.5 rounded-sm border border-line bg-raised px-2 text-2xs text-ink-mute transition-colors hover:border-line-strong hover:text-ink-dim"
      >
        <FileUp className="h-3 w-3" />
        Import
      </button>

      {open ? (
        <ImportDialog
          register={register}
          label={label}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      ) : null}
    </>
  );
}
