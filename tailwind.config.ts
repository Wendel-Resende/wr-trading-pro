import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          pink: '#ff00ff',
          cyan: '#00ffff',
          purple: '#9d00ff',
          blue: '#0066ff',
          dark: '#0a0a0f',
          darker: '#050508',
          card: '#12121a',
          border: '#1a1a2e',
        },
      },
      fontFamily: {
        orbitron: ['var(--font-orbitron)', 'sans-serif'],
        space: ['var(--font-space)', 'monospace'],
        jetbrains: ['var(--font-jetbrains)', 'monospace'],
      },
      boxShadow: {
        'neon-pink': '0 0 5px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ff',
        'neon-cyan': '0 0 5px #00ffff, 0 0 20px #00ffff, 0 0 40px #00ffff',
        'neon-purple': '0 0 5px #9d00ff, 0 0 20px #9d00ff, 0 0 40px #9d00ff',
      },
      textShadow: {
        'neon-pink': '0 0 5px #ff00ff, 0 0 10px #ff00ff',
        'neon-cyan': '0 0 5px #00ffff, 0 0 10px #00ffff',
        'neon-purple': '0 0 5px #9d00ff, 0 0 10px #9d00ff',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'cyber-grid': 'linear-gradient(rgba(0, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 255, 0.03) 1px, transparent 1px)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00ffff, 0 0 10px #00ffff' },
          '100%': { boxShadow: '0 0 20px #00ffff, 0 0 40px #00ffff' },
        },
      },
    },
  },
  plugins: [],
};
export default config;