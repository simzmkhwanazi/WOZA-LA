import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── DataGrows exact brand palette ──────────────────────────────
        // Sampled from high-res logo + marketing images
        teal: {
          DEFAULT: '#2BBCBC',   // brand primary (vibrant backgrounds, CTAs)
          50:  '#E6F8F8',
          100: '#BCECED',
          200: '#88DCDD',
          300: '#55CBCC',
          400: '#2FBFBF',
          500: '#2BBCBC',       // primary
          600: '#1E9898',
          700: '#177373',
          800: '#0F4E4E',
          900: '#082929',
        },
        // Charcoal — nav text, headings (matches DataGrows logo text)
        navy: {
          DEFAULT: '#2D3748',
          50:  '#F0F1F3',
          100: '#D2D5DA',
          200: '#A6ABB5',
          300: '#7A8190',
          400: '#4E576B',
          500: '#374151',
          600: '#2D3748',
          700: '#1F2937',
          800: '#111827',
          900: '#030712',
        },
        // Logo slice accent colours (used in the SVG + subtle UI accents)
        'dg-light': '#82CFD0',  // top-left pie slice (light cyan-teal)
        'dg-mid':   '#2DB5B5',  // bottom-right slice + leaf
        'dg-dark':  '#0D7B7B',  // large left+bottom slice
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
