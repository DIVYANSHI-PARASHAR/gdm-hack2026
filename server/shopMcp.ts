import { jacketSize } from '../src/shared/jacketSizes';
import { randomUUID } from 'node:crypto';

export const GUCCI_URL = 'https://www.gucci.com/us/en/pr/men/ready-to-wear-for-men/outerwear-for-men/bombers-for-men/reversible-gg-canvas-jacket-p-722511ZALX21043';

const context = { address_country: 'US', currency: 'USD' };
const protocol = '2026-07-28';
export type Selection = { name: string; label: string };
type ShopMedia = { type: string; url: string; alt_text?: string };
export type ShopProduct = {
  id: string;
  title: string;
  media?: ShopMedia[];
  options?: { name: string; values: { label: string; available?: boolean; exists?: boolean }[] }[];
  variants: {
    id: string;
    url?: string;
    media?: ShopMedia[];
    price: { amount: number; currency: string };
    availability?: { available: boolean };
    seller: { name: string; domain: string };
    options?: Selection[];
    inputs?: { id: string }[];
  }[];
};
export type Checkout = {
  continue_url: string;
  currency?: string;
  totals?: { type: string; amount: number; display_text?: string }[];
  messages?: { type: string; content?: string }[];
  links?: { type: string; url: string; title?: string }[];
};
type Catalog = { products: ShopProduct[]; messages?: { type: string; content?: string }[] };

export function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export class ShopMcp {
  constructor(private request: typeof fetch = fetch) {}

  private async call<T>(name: string, args: object): Promise<T> {
    const response = await this.request('https://mcp.shop.com/', {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': protocol,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name, arguments: args, _meta: {
          'io.modelcontextprotocol/protocolVersion': protocol,
          'io.modelcontextprotocol/clientInfo': { name: 'Iron Pulse', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        } },
      }),
    });
    if (!response.ok) throw new Error('Shop MCP request failed.');
    const { result, error } = await response.json();
    if (error || result?.isError || !result?.structuredContent) {
      throw new Error('Shop MCP could not complete the request.');
    }
    return result.structuredContent as T;
  }

  async discover(query?: string, size?: string) {
    if (!query) {
      const lookup = await this.call<Catalog>('lookup_catalog', {
        catalog: { ids: [GUCCI_URL], context },
      });
      const exact = lookup.products.filter((product) => product.variants.some(
        (variant) => variant.availability?.available && variant.inputs?.some((input) => input.id === GUCCI_URL)
      ));
      if (exact.length) return { match: 'exact', products: exact, messages: lookup.messages };

      const styleSearch = await this.search('Gucci Reversible GG Canvas Jacket 722511 ZALX2 1043');
      const exactStyle = styleSearch.products.filter((product) =>
        [product.title, ...product.variants.map((variant) => variant.url ?? '')].some(
          (value) => value.replace(/[^a-z0-9]/gi, '').toUpperCase().includes('722511ZALX21043')
        )
      );
      if (exactStyle.length) return { ...styleSearch, match: 'exact', products: exactStyle };
    }

    const result = await this.search(query || 'reversible monogram canvas zip bomber jacket beige brown', size);
    return { ...result, match: query ? 'search' : 'similar' };
  }

  private async search(query: string, size?: string): Promise<Catalog> {
    const result = await this.call<Catalog>('search_catalog', {
      catalog: { query, context, pagination: { limit: 5 },
        ...(size && { filters: { attributes: [{ name: 'Size', values: [size] }] } }),
      },
    });
    return {
      ...result,
      products: result.products.filter((product) =>
        product.variants.some((variant) => variant.availability?.available &&
          (!size || variant.options?.some((option) => option.name.toLowerCase() === 'size' && jacketSize(option.label) === jacketSize(size))))
      ),
    };
  }

  async checkout(id: string, selected: Selection[], idempotencyKey: string = randomUUID()): Promise<Checkout> {
    const { product } = await this.call<{ product: ShopProduct }>('get_product', {
      catalog: { id, selected, context },
    });
    const variant = product?.variants.find((offer) => offer.availability?.available &&
      (product.options ?? []).filter((option) => option.values.length > 1)
        .every((option) => selected.some((choice) => choice.name === option.name)) &&
      selected.every((choice) => offer.options?.some(
        (option) => option.name === choice.name && option.label === choice.label
      )));
    if (!variant) throw new RangeError('Choose available options for this jacket before checkout.');

    const checkout = await this.call<Checkout>('create_checkout', {
      shop: variant.seller.domain,
      checkout: { line_items: [{ item: { id: variant.id }, quantity: 1 }], context },
      meta: { 'idempotency-key': idempotencyKey },
    });
    if (!httpsUrl(checkout.continue_url)) throw new Error('The merchant did not return a checkout link.');
    return checkout;
  }
}
