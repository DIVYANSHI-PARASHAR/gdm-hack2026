const sizeAliases: Record<string, string> = {
  xs: 'XS', 'extra small': 'XS', s: 'S', small: 'S',
  m: 'M', md: 'M', medium: 'M', l: 'L', large: 'L',
  xl: 'XL', 'extra large': 'XL', xxl: 'XXL', 'double extra large': 'XXL',
  xxxs: 'XXXS', 'triple extra small': 'XXXS',
};

export function jacketSize(label: string): string {
  const value = label.trim().toLowerCase().replace(/-/g, ' ');
  const shorthand = value.match(/\(([^)]+)\)$/)?.[1];
  return sizeAliases[shorthand ?? value] ?? value.toUpperCase();
}
