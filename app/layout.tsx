import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folder to GitHub",
  description: "Safely review a browser-selected folder and create a GitHub pull request."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
