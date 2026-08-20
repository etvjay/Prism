import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prism — Your Home Across Chains",
  description: "One Prism ID for your identity, assets, relationships, and activity across networks.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
