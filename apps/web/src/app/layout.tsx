import type { Metadata } from "next";
import { BrandingProvider } from "@/components/providers/BrandingProvider";
import { ThemeProvider, ThemeScript } from "@/components/providers/ThemeProvider";
import "./globals.css";
import "./operational-ui.css";

export const metadata: Metadata = {
  title: "Avidity IT Management Tool",
  description: "Modular IT management platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ThemeProvider>
          <BrandingProvider>{children}</BrandingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
