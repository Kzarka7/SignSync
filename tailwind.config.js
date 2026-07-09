/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14213D',
        trust: '#1B4B66',
        signal: '#2D7FF9',
        'signal-light': '#EAF3FB',
        'signal-light-active': '#e3f1ff',
        sky: '#F5F9FD',
        success: '#1FAA59',
        'success-light': '#E7F7EE',
        amber: '#F2A93B',
        'amber-light': '#FDF3E1',
        danger: '#E0554C',
        'danger-light': '#FCEAE9',
        border: '#cbd0d6',
        'text-2': '#5B6B82',
        'text-3': '#8C9AAF',
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: { xl2: '14px' },
    },
  },
  plugins: [],
}
