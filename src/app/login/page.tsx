import { authMode, needsBootstrap } from "@/lib/auth";
import { LoginForm } from "@/components/shell/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const mode = authMode();
  // There is no sign-up page on purpose: the first account is created by
  // somebody who already has the host, not by whoever reaches the URL first.
  const bootstrap = needsBootstrap();

  return (
    <div className="flex h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[320px]">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold tracking-[0.16em] text-ink">STARKVISIONZ</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
            Project Controls
          </div>
        </div>

        {mode.kind === "misconfigured" ? (
          <div className="panel p-4">
            <h1 className="text-xs font-medium text-bad">Not configured for access</h1>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">{mode.reason}</p>
          </div>
        ) : bootstrap ? (
          <div className="panel p-4">
            <h1 className="text-xs font-medium text-ink">No accounts yet</h1>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">
              Create the first administrator on the host, then sign in here.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-sm border border-line bg-raised px-2 py-1.5 font-mono text-[10px] leading-relaxed text-ink-dim">
{`npm run user -- add \\
  --email you@example.com \\
  --name 'Your Name' \\
  --role admin`}
            </pre>
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
