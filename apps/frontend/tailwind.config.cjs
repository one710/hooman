const path = require("path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "src/**/*.{js,ts,jsx,tsx}"),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "DM Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      colors: {
        hooman: {
          bg: "#0a0a0f",
          "bg-elevated": "#0f0f18",
          surface: "#14141f",
          "surface-hover": "#1a1a28",
          border: "#2a2a3a",
          "border-focus": "#3d3d52",
          muted: "#8b8b9e",
          "muted-bright": "#a1a1b5",
          accent: "#a78bfa",
          "accent-bright": "#c4b5fd",
          "accent-glow": "rgba(167, 139, 250, 0.4)",
          cyan: "#22d3ee",
          "cyan-dim": "#0891b2",
          coral: "#fb7185",
          green: "#34d399",
          "green-glow": "rgba(52, 211, 153, 0.35)",
          red: "#f87171",
          "red-glow": "rgba(248, 113, 113, 0.35)",
          amber: "#fbbf24",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-mesh":
          "radial-gradient(at 40% 20%, rgba(167, 139, 250, 0.12) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(34, 211, 238, 0.08) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(251, 113, 133, 0.06) 0px, transparent 50%)",
        "gradient-accent":
          "linear-gradient(135deg, #a78bfa 0%, #c084fc 50%, #e879f9 100%)",
        "gradient-accent-subtle":
          "linear-gradient(135deg, rgba(167, 139, 250, 0.25) 0%, rgba(232, 121, 249, 0.2) 100%)",
      },
      boxShadow: {
        glow: "0 0 20px -5px var(--tw-shadow-color)",
        "glow-lg": "0 0 32px -8px var(--tw-shadow-color)",
        "glow-accent": "0 0 24px -4px rgba(167, 139, 250, 0.5)",
        "glow-green": "0 0 20px -4px rgba(52, 211, 153, 0.4)",
        "glow-red": "0 0 20px -4px rgba(248, 113, 113, 0.4)",
        inner: "inset 0 1px 2px 0 rgb(0 0 0 / 0.2)",
        card: "0 4px 24px -4px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04)",
        "card-hover":
          "0 8px 32px -8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "fade-in-up": "fadeInUp 0.4s ease-out",
        "slide-in-right": "slideInRight 0.25s ease-out",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseGlow: {
          "0%, 100%": {
            opacity: "1",
            boxShadow: "0 0 20px -4px rgba(167, 139, 250, 0.4)",
          },
          "50%": {
            opacity: "0.9",
            boxShadow: "0 0 28px -4px rgba(167, 139, 250, 0.6)",
          },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      transitionDuration: {
        400: "400ms",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
