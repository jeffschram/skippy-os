import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skippy OS",
  description: "Second brain, project manager and life task manager.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The Convex address is public: the browser connects to it directly.
  const convexUrl = process.env.CONVEX_URL;
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {convexUrl ? (
          <ClerkProvider telemetry={false}>
            <ConvexClientProvider url={convexUrl} fallback={<Shell>Loading…</Shell>}>
              {children}
            </ConvexClientProvider>
          </ClerkProvider>
        ) : (
          <Shell>
            Not configured: <code className="font-mono text-sm">CONVEX_URL</code> is missing.
          </Shell>
        )}
      </body>
    </html>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Skippy OS</h1>
      <p className="mt-3 text-base leading-7">{children}</p>
    </main>
  );
}
