import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const font = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "GE EASY — Gestão Especializada EASY", template: "%s · GE EASY" },
  description: "Sistema de gestão da EASY Consórcio & Seguros: clientes, consórcios, seguros, agenda, comissões e consultores.",
  robots: { index: false, follow: false },
  applicationName: "GE EASY",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2D2D83" },
    { media: "(prefers-color-scheme: dark)", color: "#11113A" },
  ],
};

// Aplica o tema antes da pintura para evitar "flash"
const themeScript = `try{var t=localStorage.getItem('ge-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={font.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
