import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes — Project Controls",
  description:
    "Desktop cockpit for EPC project controls: earned value, schedule, cost, risk and document control, with an agent that reads the register.",
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  width: "device-width",
  initialScale: 1,
};

/**
 * Deliberately thin. The application chrome lives in the `(app)` route group so
 * that `/login` — which a signed-out visitor must be able to render — is not
 * wrapped in a shell that immediately tries to load project data it has no
 * session for.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
