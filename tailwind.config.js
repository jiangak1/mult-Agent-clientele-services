/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        glass: {
          bg: "rgba(255, 255, 255, 0.08)",
          border: "rgba(255, 255, 255, 0.12)",
          surface: "rgba(18, 18, 22, 0.85)",
        },
        accent: {
          primary: "#6c8cff",
          secondary: "#a78bfa",
        },
      },
      backdropBlur: {
        glass: "16px",
      },
      animation: {
        "fade-in-up": "fadeInUp 0.3s ease-out forwards",
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
  ],
};
