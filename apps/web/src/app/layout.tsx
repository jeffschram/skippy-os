import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skippy OS",
  description: "Second brain, project manager and life task manager.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
