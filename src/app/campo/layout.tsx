import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Campo",
  manifest: "/campo.webmanifest",
  appleWebApp: { capable: true, title: "EASY Campo", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#2D2D83", width: "device-width", initialScale: 1, viewportFit: "cover" };

/** App de campo (PWA): tela cheia, sem o menu lateral, pensado para uso com uma mão. */
export default function CampoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg">{children}</div>;
}
