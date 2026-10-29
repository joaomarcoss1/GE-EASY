import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: v("brand-50"), 100: v("brand-100"), 200: v("brand-200"), 300: v("brand-300"), 400: v("brand-400"),
          500: v("brand-500"), 600: v("brand-600"), 700: v("brand-700"), 800: v("brand-800"), 900: v("brand-900"), 950: v("brand-950"),
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
        "glow-brand": "0 10px 30px -8px rgb(45 45 131 / 0.55)",
        lift: "0 2px 4px rgb(16 16 60 / 0.04), 0 18px 40px -12px rgb(16 16 60 / 0.22)",
        inset: "inset 0 1px 0 rgb(255 255 255 / 0.18)",
      },
      transitionTimingFunction: { spring: "cubic-bezier(.2,.9,.3,1.15)", smooth: "cubic-bezier(.22,.8,.2,1)" },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "pop-in": { from: { opacity: "0", transform: "scale(.97) translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
        "toast-in": { from: { opacity: "0", transform: "translateX(24px) scale(.96)" }, to: { opacity: "1", transform: "none" } },
        float: { "0%,100%": { transform: "translate3d(0,0,0)" }, "50%": { transform: "translate3d(0,-18px,0)" } },
        drift: { "0%,100%": { transform: "translate3d(0,0,0) scale(1)" }, "50%": { transform: "translate3d(30px,-24px,0) scale(1.08)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "gradient-pan": { "0%,100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        "route-progress": { "0%": { transform: "scaleX(0)" }, "70%": { transform: "scaleX(.85)" }, "100%": { transform: "scaleX(.95)" } },
        "pulse-ring": { "0%": { boxShadow: "0 0 0 0 rgb(225 79 38 / .45)" }, "100%": { boxShadow: "0 0 0 14px rgb(225 79 38 / 0)" } },
        shrink: { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "slide-in": "slide-in .25s cubic-bezier(.2,.8,.2,1)",
        "pop-in": "pop-in .18s ease-out",
        "fade-up": "fade-up .55s cubic-bezier(.22,.8,.2,1) both",
        "toast-in": "toast-in .35s cubic-bezier(.2,.9,.3,1.15) both",
        float: "float 9s ease-in-out infinite",
        "float-slow": "float 14s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        "gradient-pan": "gradient-pan 8s ease infinite",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
