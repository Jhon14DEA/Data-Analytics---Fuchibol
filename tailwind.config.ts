import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: {
          950: "#07100d",
          900: "#0b1712",
          850: "#102119",
          800: "#14291f"
        },
        signal: {
          green: "#2ee88a",
          yellow: "#f4d35e",
          orange: "#ff9f43",
          red: "#ff4d5d"
        }
      }
    }
  },
  plugins: []
};

export default config;
