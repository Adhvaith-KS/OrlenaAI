import type { Metadata } from "next";
import { Outfit, Inter, Syne } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orlena AI | Universal Translation Layer",
  description: "Real-time, private, and universal translation for seamless global conversations.",
  metadataBase: new URL('https://orlena.ai'), // Replace with actual URL if different
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [
      { url: "/icon.png", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Orlena AI | Universal Translation Layer",
    description: "Real-time, private, and universal translation for seamless global conversations.",
    url: "https://orlena.ai",
    siteName: "Orlena AI",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "Orlena AI Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Orlena AI | Universal Translation Layer",
    description: "Real-time, private, and universal translation for seamless global conversations.",
    images: ["/icon.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${outfit.variable} ${inter.variable} ${syne.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
