import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Social Backup",
  description: "Never lose your tweets, followers, or content again",
  icons: {
    icon: [
      { url: "/social-backup.svg?v=2", type: "image/svg+xml" },
    ],
    shortcut: [{ url: "/social-backup.svg?v=2", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Script
          id="theme-preference-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const root = document.documentElement;
                  const storedTheme = window.localStorage.getItem('theme');
                  if (storedTheme === 'dark') {
                    root.classList.add('dark');
                    return;
                  }
                  if (storedTheme === 'light') {
                    root.classList.remove('dark');
                    return;
                  }
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  root.classList.toggle('dark', prefersDark);
                } catch {}
              })();
            `,
          }}
        />
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
