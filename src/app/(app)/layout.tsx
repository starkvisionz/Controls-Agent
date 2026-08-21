import { DesktopShell } from "@/components/shell/DesktopShell";
import { isAuthEnforced } from "@/lib/auth";

/** Everything behind the session gate renders inside the desktop shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <DesktopShell authEnforced={isAuthEnforced()}>{children}</DesktopShell>;
}
