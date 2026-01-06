import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EVI Conversational Agent",
  description: "A clean conversational voice AI agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased grid-pattern">
        {children}
      </body>
    </html>
  );
}

