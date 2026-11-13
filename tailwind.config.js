/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./call.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Readable text (docs/progress/ui-enhancement.md U0): rem-based, so the "Larger text" switch
      // (html font-size) scales everything. Smallest normal text is 13px; 2xs (11px) is only for count badges.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
      },
      colors: {
        wa: {
          teal: '#008069',
          dark: '#128C7E',
          green: '#25D366',
          lightGreen: '#D9FDD3',
          chatBg: '#EFEAE2',
          sidebarBg: '#FFFFFF',
          activeChat: '#F0F2F5',
          hoverChat: '#F5F6F6',
          border: '#E9EDEF',
          textPrimary: '#111B21',
          textSecondary: '#667781'
        }
      }
    },
  },
  plugins: [],
}
