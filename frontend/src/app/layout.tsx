import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Autonomous GitHub PR & Code Reviewer Agent",
  description: "Enterprise multi-agent code reviewer built with LangGraph, FastAPI, and pgvector.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-background text-foreground flex flex-col`}>
        <Header />
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
