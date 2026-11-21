export const shippingFields = [
  'first_name', 'last_name', 'email', 'street_address',
  'address_locality', 'address_region', 'postal_code', 'address_country',
] as const;

export type JacketShipping = Record<typeof shippingFields[number], string>;

export function readJacketShipping(fields: unknown): JacketShipping | undefined {
  if (!fields || typeof fields !== 'object') return;
  const input = fields as Record<string, unknown>;
  const shipping = Object.fromEntries(shippingFields.map((key) => [
    key, typeof input[key] === 'string' ? input[key].trim() : '',
  ])) as JacketShipping;
  if (shippingFields.some((key) => !shipping[key] || shipping[key].length > 254)) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipping.email)) return;
  shipping.address_country = shipping.address_country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(shipping.address_country)) return;
  return shipping;
}


export const defaultJacketAddress = {
  street_address: '270 7th Ave',
  address_locality: 'New York',
  address_region: 'NY',
  postal_code: '10001',
  address_country: 'US',
} satisfies Partial<JacketShipping>;
