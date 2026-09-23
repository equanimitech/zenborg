import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { LayoutClient } from "@/components/LayoutClient";
import { ThemeColorMeta } from "@/components/ThemeColorMeta";
import { StoreInitializer } from "./StoreInitializer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zenborg",
  description:
    "A garden for your attention. Plant what you want to grow, grow it with the people and places you care about, fence out the weeds, and return to tend it every day.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Zenborg",
  },
  icons: {
    icon: [
      {
        url: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-192-dark.png",
        sizes: "192x192",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-512-dark.png",
        sizes: "512x512",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // Respect safe areas (notch, home bar)
  colorScheme: "light dark", // Enable iOS system theme detection
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script to immediately apply theme before any rendering */}
        {/* Critical for iOS PWA to detect system theme on first-gen devices */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a first-paint theme script must be inline, and its content is a literal with no user input
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const storageKey = 'zenborg-theme';
                  const stored = localStorage.getItem(storageKey);
                  const theme = stored || 'system';

                  let resolvedTheme = theme;
                  if (theme === 'system') {
                    resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }

                  // Apply immediately to prevent flash
                  if (resolvedTheme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }

                  // Set theme-color immediately for PWA
                  const color = resolvedTheme === 'dark' ? '#1c1917' : '#fafaf9';
                  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
                  if (!meta) {
                    meta = document.createElement('meta');
                    meta.setAttribute('name', 'theme-color');
                    document.head.appendChild(meta);
                  }
                  meta.setAttribute('content', color);

                  // Listen for system theme changes in PWA mode
                  if ('matchMedia' in window) {
                    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                    const handleChange = (e) => {
                      if (localStorage.getItem(storageKey) === 'system' || !localStorage.getItem(storageKey)) {
                        const newTheme = e.matches ? 'dark' : 'light';
                        if (newTheme === 'dark') {
                          document.documentElement.classList.add('dark');
                        } else {
                          document.documentElement.classList.remove('dark');
                        }
                        const newColor = newTheme === 'dark' ? '#1c1917' : '#fafaf9';
                        const metaEl = document.querySelector('meta[name="theme-color"]:not([media])');
                        if (metaEl) {
                          metaEl.setAttribute('content', newColor);
                        }
                      }
                    };

                    // Modern API
                    if (mediaQuery.addEventListener) {
                      mediaQuery.addEventListener('change', handleChange);
                    } else {
                      // Fallback for older iOS
                      mediaQuery.addListener(handleChange);
                    }
                  }
                } catch (e) {
                  console.error('Theme initialization error:', e);
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
          storageKey="zenborg-theme"
        >
          <ThemeColorMeta />
          <StoreInitializer />
          <LayoutClient>{children}</LayoutClient>
        </ThemeProvider>
      </body>
    </html>
  );
}
