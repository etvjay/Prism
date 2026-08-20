import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prism",
  description: "One Prism ID. One home across chains.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
