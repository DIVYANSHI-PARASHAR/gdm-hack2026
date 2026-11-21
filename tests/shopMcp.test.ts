import { describe, expect, it, vi } from 'vitest';
import { GUCCI_URL, ShopMcp } from '../server/shopMcp';

const productUrl = 'https://example.com/jacket?variant=12&_gsid=shop%2Bkey';
const continueUrl = 'https://shop.app/checkout/test?key=test%2Babc&source=shop';
const product = {
  id: 'gid://shopify/p/AvailableJacket',
  title: 'Canvas bomber',
  options: [{ name: 'Size', values: [{ label: 'M' }, { label: 'L' }] }],
  variants: [{
    id: 'gid://shopify/ProductVariant/12',
    availability: { available: true },
    price: { amount: 10000, currency: 'USD' },
    seller: { domain: 'merchant.myshopify.com', name: 'Merchant' },
    options: [{ name: 'Size', label: 'M' }],
    url: productUrl,
  }],
};

function mockShop(...docs: object[]) {
  const request = vi.fn<typeof fetch>();
  for (const document of docs) {
    request.mockResolvedValueOnce(Response.json({ result: { structuredContent: document } }));
  }
  const shop = new ShopMcp(request);
  const call = (index: number) => {
    const [endpoint, init] = request.mock.calls[index];
    const payload = JSON.parse(String(init?.body));
    expect(endpoint).toBe('https://mcp.shop.com/');
    expect(init?.headers).toMatchObject({ 'Mcp-Name': payload.params.name });
    return payload.params;
  };
  return { shop, request, call };
}

describe('live Shop MCP jacket discovery and checkout', () => {
  it('returns the exact URL match with response URLs intact', async () => {
    const exact = { ...product, variants: [{ ...product.variants[0], inputs: [{ id: GUCCI_URL }] }] };
    const { shop, request, call } = mockShop({ products: [exact] });
    const result = await shop.discover();
    expect(result.match).toBe('exact');
    expect(result.products[0].variants[0].url).toBe(productUrl);
    expect(call(0)).toMatchObject({ name: 'lookup_catalog', arguments: { catalog: { ids: [GUCCI_URL] } } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('recognizes the full Gucci style code from a live retailer listing', async () => {
    const exact = { ...product, title: "Gucci Reversible GG Canvas Jacket 'Black' 722511-ZALX2-1043" };
    const { shop, request } = mockShop({ products: [] }, { products: [product, exact] });
    expect(await shop.discover()).toMatchObject({ match: 'exact', products: [exact] });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns live alternatives after an empty exact lookup', async () => {
    const { shop, call } = mockShop({ products: [] }, { products: [] }, { products: [product, { ...product, variants: [] }] });
    expect(await shop.discover()).toMatchObject({ match: 'similar', products: [product] });
    expect(call(1).arguments.catalog.query).toContain('722511');
    expect(call(2).name).toEqual('search_catalog');
  });

  it('requests the spoken size from Shop and excludes a different featured size', async () => {
    const wrongSize = { ...product, variants: [{
      ...product.variants[0],
      options: [{ name: 'Size', label: 'Triple extra small (XXXS)' }],
    }] };
    const medium = { ...product, variants: [{
      ...product.variants[0],
      options: [{ name: 'Size', label: 'Medium (M)' }],
    }] };
    const { shop, call } = mockShop({ products: [wrongSize, medium] });
    expect(await shop.discover('canvas bomber', 'M')).toMatchObject({ products: [medium] });
    expect(call(0).arguments.catalog.filters.attributes).toEqual([{ name: 'Size', values: ['M'] }]);
  });

  it('validates the chosen variant and returns the untouched merchant checkout URL', async () => {
    const { shop, request, call } = mockShop({ product }, { continue_url: continueUrl });
    const selected = [{ name: 'Size', label: 'M' }];
    const key = 'bd0d14fa-d667-4c63-ad4d-4c97552ffdee';
    expect((await shop.checkout(product.id, selected, key)).continue_url).toBe(continueUrl);
    expect(call(0)).toMatchObject({ name: 'get_product', arguments: { catalog: { id: product.id, selected } } });
    expect(call(1)).toMatchObject({
      name: 'create_checkout',
      arguments: {
        shop: 'merchant.myshopify.com',
        checkout: { line_items: [{ item: { id: 'gid://shopify/ProductVariant/12' }, quantity: 1 }] },
        meta: { 'idempotency-key': key },
      },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([[], [{ name: 'Size', label: 'L' }]])('rejects missing or substituted variant options', async (...choices) => {
    const { shop, request } = mockShop({ product });
    await expect(shop.checkout(product.id, choices)).rejects.toThrow('Choose available options');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
