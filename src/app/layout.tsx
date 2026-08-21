import type { Metadata, Viewport } from "next";
import { DesktopShell } from "@/components/shell/DesktopShell";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <DesktopShell>{children}</DesktopShell>
      </body>
    </html>
  );
}
