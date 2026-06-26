import type { Config } from "tailwindcss";

/** NEXCODE tasarım sistemi — logodan türetildi (elektrik mavisi + krom, koyu premium). */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e8f6ff",
          100: "#c9e9ff",
          200: "#94d3ff",
          300: "#5cb8ff",
          400: "#2ba6ff",
          500: "#1e9bf0",
          600: "#137bd4",
          700: "#0f60a8",
          800: "#114e85",
          900: "#13426e",
        },
        ink: {
          950: "#070a0f",
          900: "#0b0e14",
          850: "#0e121a",
          800: "#121826",
          700: "#1a2233",
          600: "#26303f",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(43,166,255,0.25), 0 0 24px -6px rgba(43,166,255,0.45)",
        "glow-sm": "0 0 14px -4px rgba(43,166,255,0.5)",
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "brand-grad": "linear-gradient(135deg, #38bdf8 0%, #1e9bf0 45%, #1268c9 100%)",
        "chrome-grad":
          "linear-gradient(180deg, #f4f7fb 0%, #cfd6e0 38%, #9aa6b4 62%, #e7ecf2 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
