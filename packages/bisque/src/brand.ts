// Canonical Bisque terminal colors and small text formatters.

export const BISQUE_COLORS = {
	cream: 223,
	tomato: 167,
	charcoal: 235,
	creamWhite: 231,
	sage: 108,
	amber: 179,
	paprika: 130,
} as const;

export function ansi256(code: number, text: string): string {
	return `\x1b[38;5;${code}m${text}\x1b[39m`;
}
