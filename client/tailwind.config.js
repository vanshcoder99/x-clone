/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'obsidian': '#000000',
        'surface-primary': '#13171f',
        'surface-secondary': '#1e2430',
        'surface-card': '#13171f',
        'surface-hover': '#181d27',
        'surface-input': '#1a1f2c',
        'accent-blue': '#1d9bf0',
        'accent-blue-hover': '#1a8cd8',
        'accent-glow': 'rgba(29, 155, 240, 0.25)',
        'premium-violet': '#c084fc',
        'premium-purple': '#8b5cf6',
        'border-dark': '#242b35',
        'text-primary': '#f3f4f6',
        'text-secondary': '#8b949e',
        'text-muted': '#71767b',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

