import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#F4F4FD", 100: "#E8E8FA", 200: "#CFCFF3", 300: "#A9A9E6", 400: "#7B7BD3",
          500: "#4F4FC4", 600: "#3B3BA3", 700: "#2D2D83", 800: "#23236A", 900: "#1A1A50", 950: "#11113A",
        },
        accent: {
          50: "#FFF4EE", 100: "#FDE6DC", 200: "#FAC9B3", 300: "#F6A383", 400: "#F0703F",
          500: "#E14F26", 600: "#C9421D", 700: "#A53417", 800: "#842B16", 900: "#6B2514",
        },
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        line: v("line"),
        fg: v("fg"),
        muted: v("muted"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 16 60 / 0.04), 0 4px 16px -4px rgb(16 16 60 / 0.08)",
        pop: "0 12px 40px -8px rgb(16 16 60 / 0.25)",
        glow: "0 8px 24px -6px rgb(225 79 38 / 0.45)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "pop-in": { from: { opacity: "0", transform: "scale(.97) translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "slide-in": "slide-in .25s cubic-bezier(.2,.8,.2,1)",
        "pop-in": "pop-in .18s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
