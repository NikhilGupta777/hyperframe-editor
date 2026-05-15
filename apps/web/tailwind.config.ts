import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f17",
        paper: "#f5f7fb",
        accent: "#ff3df8",
        muted: "#7c8aa6",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Archivo Black", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
