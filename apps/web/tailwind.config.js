/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: 0 },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: 0 },
                },
                "shimmer-slide": {
                    from: { transform: "translateX(-100%)" },
                    to: { transform: "translateX(100%)" },
                },
                "spin-around": {
                    from: { transform: "rotate(0deg)" },
                    to: { transform: "rotate(360deg)" },
                },
                "float": {
                    "0%": { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
                    "100%": { transform: "translate(-50%, -150%) scale(0)", opacity: 0 },
                },
                "pulse": {
                    "0%, 100%": { opacity: 1 },
                    "50%": { opacity: 0.5 },
                },
                "pulse-delayed": {
                    "0%, 100%": { opacity: 1, transform: "scale(1)" },
                    "50%": { opacity: 0.5, transform: "scale(0.85)" }
                }
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "shimmer-slide": "shimmer-slide 3s linear infinite",
                "spin-around": "spin-around 3s linear infinite",
                "float": "float 1s ease-out forwards",
                "pulse": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                "pulse-delayed": "pulse-delayed 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            },
            typography: {
                DEFAULT: {
                    css: {
                        maxWidth: '100%',
                        color: 'var(--tw-prose-body)',
                        a: {
                            color: 'var(--tw-prose-links)',
                            textDecoration: 'underline',
                            fontWeight: '500',
                        },
                        strong: {
                            color: 'var(--tw-prose-bold)',
                            fontWeight: '600',
                        },
                        code: {
                            color: 'var(--tw-prose-code)',
                            backgroundColor: 'var(--tw-prose-code-bg)',
                            borderRadius: '0.25rem',
                            paddingTop: '0.125rem',
                            paddingRight: '0.25rem',
                            paddingBottom: '0.125rem',
                            paddingLeft: '0.25rem',
                        },
                        'code::before': {
                            content: 'none',
                        },
                        'code::after': {
                            content: 'none',
                        },
                        blockquote: {
                            borderLeftColor: 'var(--tw-prose-quote-borders)',
                            borderLeftWidth: '4px',
                            fontStyle: 'italic',
                            paddingLeft: '1rem',
                        },
                        hr: {
                            borderColor: 'var(--tw-prose-hr)',
                            borderTopWidth: 1,
                        },
                        h1: {
                            color: 'var(--tw-prose-headings)',
                            fontWeight: '800',
                            fontSize: '2.25em',
                            marginTop: '1.5em',
                            marginBottom: '0.5em',
                            lineHeight: '1.1111111',
                        },
                        h2: {
                            color: 'var(--tw-prose-headings)',
                            fontWeight: '700',
                            fontSize: '1.5em',
                            marginTop: '1.75em',
                            marginBottom: '0.5em',
                            lineHeight: '1.3333333',
                        },
                        h3: {
                            color: 'var(--tw-prose-headings)',
                            fontWeight: '600',
                            fontSize: '1.25em',
                            marginTop: '1.5em',
                            marginBottom: '0.5em',
                            lineHeight: '1.6',
                        },
                    },
                },
            },
        },
    },
    plugins: [
        require("tailwindcss-animate"),
        require('@tailwindcss/typography'),
    ],
}