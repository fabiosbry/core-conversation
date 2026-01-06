import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "peoplemakethings",
  description: "Voice AI conversation agent",
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

