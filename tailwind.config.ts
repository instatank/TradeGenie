import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          ink: "#1b1f23",
          muted: "#65717c",
          line: "#d7dee4",
          panel: "#f7f9fa",
          green: "#0d8f72",
          red: "#c2413d",
          gold: "#b98318",
          blue: "#1f6feb",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(27,31,35,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
