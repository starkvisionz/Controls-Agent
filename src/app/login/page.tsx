import { authMode } from "@/lib/auth";
import { LoginForm } from "@/components/shell/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const mode = authMode();

  return (
    <div className="flex h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[320px]">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold tracking-[0.16em] text-ink">HERMES</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
            Project Controls
          </div>
        </div>

        {mode.kind === "misconfigured" ? (
          <div className="panel p-4">
            <h1 className="text-xs font-medium text-bad">Not configured for access</h1>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">{mode.reason}</p>
          </div>
        ) : (
          // Only ever accept a same-site path, so the redirect cannot be aimed
          // at another origin.
          <LoginForm redirectTo={next?.startsWith("/") && !next.startsWith("//") ? next : "/"} />
        )}
      </div>
    </div>
  );
}
