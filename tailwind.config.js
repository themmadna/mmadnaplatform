/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pulse: {
          bg:        '#0e0e12',
          surface:   '#1a1a22',
          'surface-2': '#24242e',
          red:       '#ef4444',
          blue:      '#3b82f6',
          green:     '#22c55e',
          amber:     '#f59e0b',
          text:      '#f5f5f7',
          'text-2':  '#9898a8',
          'text-3':  '#5a5a6e',
        },
      },
      fontFamily: {
        heading: ['"Barlow Condensed"', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
      borderRadius: {
        badge: '6px',
        btn:   '10px',
        card:  '12px',
        fight: '14px',
        pill:  '20px',
      },
      spacing: {
        'nav': '64px',
      },
      maxWidth: {
        'mobile': '430px',
      },
    },
  },
  plugins: [],
}