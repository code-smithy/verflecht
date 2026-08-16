import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verflecht",
  description: "Source-backed political network research platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
