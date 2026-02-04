/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      colors: {
        hooman: {
          bg: "#0f0f12",
          surface: "#18181c",
          border: "#2a2a2e",
          muted: "#71717a",
          accent: "#a78bfa",
          green: "#34d399",
          red: "#f87171",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
