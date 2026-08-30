import type { Config } from "tailwindcss"
import plugin from "tailwindcss/plugin"

export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundColor: {
        primary: "rgba(var(--bg-primary))",
        secondary: "rgba(var(--bg-secondary))",
        tertiary: "rgba(var(--bg-tertiary))",
        disabled: "rgba(var(--bg-disabled))",
        // Deals and markdowns. Amber carries dark text only — white on amber
        // is 3.19:1 and fails AA.
        deal: "rgba(var(--bg-deal))",
        chrome: {
          DEFAULT: "rgba(var(--bg-chrome))",
          sub: "rgba(var(--bg-chrome-sub))",
          hover: "rgba(var(--bg-chrome-hover))",
        },
        "deal-subtle": "rgba(var(--bg-deal-subtle))",
        sale: "rgba(var(--bg-sale))",
        component: {
          DEFAULT: "rgba(var(--bg-component-primary))",
          hover: "rgba(var(--bg-component-primary-hover))",
          secondary: {
            DEFAULT: "rgba(var(--bg-component-secondary))",
            hover: "rgba(var(--bg-component-secondary-hover))",
          },
        },
        action: {
          DEFAULT: "rgba(var(--bg-action-primary))",
          hover: "rgba(var(--bg-action-primary-hover))",
          pressed: "rgba(var(--bg-action-primary-pressed))",
          secondary: {
            DEFAULT: "var(--bg-action-secondary)",
            hover: "var(--bg-action-secondary-hover)",
            pressed: "var(--bg-action-secondary-pressed)",
          },
          tertiary: {
            DEFAULT: "var(--bg-action-tertiary)",
            hover: "var(--bg-action-tertiary-hover)",
            pressed: "var(--bg-action-tertiary-pressed)",
          },
        },
        positive: {
          DEFAULT: "rgba(var(--bg-positive-primary))",
          hover: "rgba(var(--bg-positive-primary-hover))",
          pressed: "rgba(var(--bg-positive-primary-pressed))",
          secondary: {
            DEFAULT: "rgba(var(--bg-positive-secondary))",
            hover: "rgba(var(--bg-positive-secondary-hover))",
            pressed: "rgba(var(--bg-positive-secondary-pressed))",
          },
        },
        negative: {
          DEFAULT: "rgba(var(--bg-negative-primary))",
          hover: "rgba(var(--bg-negative-primary-hover))",
          pressed: "rgba(var(--bg-negative-primary-pressed))",
          secondary: {
            DEFAULT: "rgba(var(--bg-negative-secondary))",
            hover: "rgba(var(--bg-negative-secondary-hover))",
            pressed: "rgba(var(--bg-negative-secondary-pressed))",
          },
        },
        warning: {
          DEFAULT: "rgba(var(--bg-warning-primary))",
          hover: "rgba(var(--bg-warning-primary-hover))",
          pressed: "rgba(var(--bg-warning-primary-pressed))",
          secondary: {
            DEFAULT: "rgba(var(--bg-warning-secondary))",
            hover: "rgba(var(--bg-warning-secondary-hover))",
            pressed: "rgba(var(--bg-warning-secondary-pressed))",
          },
        },
      },
      colors: {
        primary: "rgba(var(--content-primary))",
        secondary: "rgba(var(--content-secondary))",
        tertiary: "rgba(var(--content-tertiary))",
        disabled: "rgba(var(--content-disabled))",
        price: "rgba(var(--content-price))",
        action: {
          DEFAULT: "rgba(var(--content-action-primary))",
          hover: "rgba(var(--content-action-primary-hover))",
          pressed: "rgba(var(--content-action-primary-pressed))",
          on: {
            primary: "rgba(var(--content-action-on-primary))",
            secondary: "rgba(var(--content-action-on-secondary))",
            tertiary: "rgba(var(--content-action-on-tertiary))",
          },
        },
        positive: {
          DEFAULT: "rgba(var(--content-positive-primary))",
          on: {
            primary: "rgba(var(--content-positive-on-primary))",
            secondary: "rgba(var(--content-positive-on-secondary))",
          },
        },
        negative: {
          DEFAULT: "rgba(var(--content-negative-primary))",
          on: {
            primary: "rgba(var(--content-negative-on-primary))",
            secondary: "rgba(var(--content-negative-on-secondary))",
          },
        },
        warning: {
          DEFAULT: "rgba(var(--content-warning-primary))",
          on: {
            primary: "rgba(var(--content-warning-on-primary))",
            secondary: "rgba(var(--content-warning-on-secondary))",
          },
        },
      },
      borderColor: {
        DEFAULT: "rgba(var(--border-primary))",
        primary: "rgba(var(--border-primary))",
        secondary: "rgba(var(--border-secondary))",
        action: "rgba(var(--border-action))",
        negative: {
          DEFAULT: "rgba(var(--border-negative-primary))",
          secondary: "rgba(var(--border-negative-secondary))",
        },
        positive: {
          DEFAULT: "rgba(var(--border-positive-primary))",
          secondary: "rgba(var(--border-positive-secondary))",
        },
        warning: {
          DEFAULT: "rgba(var(--border-warning-primary))",
          secondary: "rgba(var(--border-warning-secondary))",
        },
        disabled: "rgba(var(--border-disabled))",
        // Anything that BOUNDS a control. Clears the 3:1 that WCAG 1.4.11
        // requires, unlike the hairline --border-primary used for dividers.
        input: "rgba(var(--border-input))",
      },
      // Tighter than the original 4/8/16. Cards at 16px read soft and toy-like
      // at product-grid density; 12px still feels crafted but keeps the grid
      // serious.
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        full: "1000px",
      },
      boxShadow: {
        // Warm-tinted. Pure-black shadows over warm neutrals go grey and muddy;
        // matching the hue keeps surfaces looking lit rather than dirty.
        xs: "0 1px 2px rgba(28, 24, 21, 0.05)",
        sm: "0 1px 3px rgba(28, 24, 21, 0.08), 0 1px 2px rgba(28, 24, 21, 0.04)",
        md: "0 4px 12px rgba(28, 24, 21, 0.08), 0 2px 4px rgba(28, 24, 21, 0.04)",
        lg: "0 12px 28px rgba(28, 24, 21, 0.10), 0 4px 8px rgba(28, 24, 21, 0.05)",
        // For the sticky mobile buy-bar, which must read as "above" the page.
        up: "0 -4px 16px rgba(28, 24, 21, 0.08)",
        focus: "0 0 0 3px rgba(var(--brand-300), 0.5)",
      },
      fill: {
        primary: "rgba(var(--content-action-on-primary))",
        secondary: "rgba(var(--content-action-on-secondary))",
        disabled: "rgba(var(--content-disabled))",
      },
    },
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          /* Firefox */
          'scrollbar-width': 'none',
          /* Safari and Chrome */
          '&::-webkit-scrollbar': {
            display: 'none'
          }
        }
      })
    })
  ],
} satisfies Config
