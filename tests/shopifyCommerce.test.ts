import { describe, expect, it } from 'vitest';
import {
  GeminiShoppingAgent,
  sanitizeShoppingInput,
} from '../server/geminiShopping';
import {
  GUCCI_REVERSIBLE_GG_JACKET,
  ShopifyMcpService,
  VERIFIED_JACKET_FALLBACK,
} from '../server/shopifyMcp';

describe('Shopify Agentic Commerce & MCP Tools', () => {
  it('retrieves live product details for Kai the Brawler outfit jacket', async () => {
    const service = new ShopifyMcpService();
    const { product } = await service.getProductDetails();

    expect(product.id).toBe(VERIFIED_JACKET_FALLBACK.id);
    expect(product.title).toBe('Puffer Jacket');
    expect(product.vendor).toBe('Mock.shop');
    expect(product.sizes).toEqual(['Small', 'Medium', 'Large']);
    expect(product.colors).toContain('Olive');
    expect(product.variants.length).toBeGreaterThanOrEqual(15);
  });

  it('matches exact available variant when requested size and color are in stock', async () => {
    const service = new ShopifyMcpService();
    const result = await service.checkVariantAvailability(
      VERIFIED_JACKET_FALLBACK.id,
      'Medium',
      'Olive'
    );

    expect(result.available).toBe(true);
    expect(result.exactMatch).toBe(true);
    expect(result.variant).toBeDefined();
    expect(result.variant?.size).toBe('Medium');
    expect(result.variant?.color).toBe('Olive');
    expect(result.variant?.price.amount).toBe('90.0');
    expect(result.variant?.id).toBe('gid://shopify/ProductVariant/43696967680022');
  });

  it('honestly reports unavailable color and provides clearly labeled alternatives', async () => {
    const service = new ShopifyMcpService();
    const result = await service.checkVariantAvailability(
      VERIFIED_JACKET_FALLBACK.id,
      'Medium',
      'Black'
    );

    expect(result.available).toBe(false);
    expect(result.exactMatch).toBe(false);
    expect(result.message).toContain('Black is not an available color');
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives!.length).toBeGreaterThan(0);
    // Olive (Kai's outfit) should be among the alternatives
    const hasOlive = result.alternatives!.some((a) => a.color === 'Olive');
    expect(hasOlive).toBe(true);
  });

  it('honestly reports unavailable size (e.g. XL)', async () => {
    const service = new ShopifyMcpService();
    const result = await service.checkVariantAvailability(
      VERIFIED_JACKET_FALLBACK.id,
      'XL',
      'Olive'
    );

    expect(result.available).toBe(false);
    expect(result.message).toContain('Size XL is not available');
    expect(result.availableSizes).toEqual(['Small', 'Medium', 'Large']);
  });

  it('detects ambiguous queries missing color and asks for clarification', async () => {
    const service = new ShopifyMcpService();
    const result = await service.checkVariantAvailability(
      VERIFIED_JACKET_FALLBACK.id,
      'Medium',
      undefined
    );

    expect(result.ambiguous).toBe(true);
    expect(result.missingField).toBe('color');
    expect(result.message).toContain('Size Medium is available');
    expect(result.availableColors).toContain('Olive');
  });

  it('creates cart and generates hosted checkout URL', async () => {
    const service = new ShopifyMcpService();
    const variantId = 'gid://shopify/ProductVariant/43696967680022';
    const cart = await service.createOrUpdateCart(variantId, 1);

    expect(cart.cartId).toBeDefined();
    expect(cart.checkoutUrl).toContain('checkout');
    expect(cart.totalAmount).toBe('90.0');
    expect(cart.currencyCode).toBe('CAD');
    expect(cart.lines.length).toBe(1);
    expect(cart.lines[0].variantId).toBe(variantId);
  });

  it('strictly rejects payloads containing webcam video or health telemetry', () => {
    const cleanPayload = {
      message: 'Do you have this in black, medium?',
      productId: 'gid://shopify/Product/7983594340374',
    };
    expect(sanitizeShoppingInput(cleanPayload)).not.toBeNull();

    const dirtyPayloadWithBpm = {
      message: 'Do you have this in black, medium?',
      bpm: 145,
    };
    expect(sanitizeShoppingInput(dirtyPayloadWithBpm)).toBeNull();

    const dirtyPayloadWithLandmarks = {
      message: 'Do you have this in black, medium?',
      landmarks: [{ x: 0.5, y: 0.5 }],
    };
    expect(sanitizeShoppingInput(dirtyPayloadWithLandmarks)).toBeNull();

    const dirtyPayloadWithImage = {
      message: 'I want this',
      image: 'data:image/jpeg;base64,...',
    };
    expect(sanitizeShoppingInput(dirtyPayloadWithImage)).toBeNull();
  });

  it('shopping agent handles natural language "Do you have this in black, medium?" honestly', async () => {
    const agent = new GeminiShoppingAgent();
    const res = await agent.handleMessage({
      message: 'Do you have this in black, medium?',
    });

    expect(res.selectedVariant).toBeNull();
    expect(res.reply.toLowerCase()).toContain('black');
    expect(res.reply.toLowerCase()).toContain('not');
    expect(res.alternatives).toBeDefined();
    expect(res.alternatives!.length).toBeGreaterThan(0);
  });

  it('shopping agent selects variant for "Do you have this in olive, medium?"', async () => {
    const agent = new GeminiShoppingAgent();
    const res = await agent.handleMessage({
      message: 'Do you have this in olive, medium?',
    });

    expect(res.selectedVariant).not.toBeNull();
    expect(res.selectedVariant?.size).toBe('Medium');
    expect(res.selectedVariant?.color).toBe('Olive');
    expect(res.selectedVariant?.id).toBe('gid://shopify/ProductVariant/43696967680022');
    expect(res.reply).toContain('$90.0');
  });

  it('calls Gemini with MCP context when API key is provided and falls back safely', async () => {
    let capturedPrompt = '';
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedPrompt = String(init?.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Black is not in stock, but Kai is wearing Olive in Medium which is available for $90.00 CAD!',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const agent = new GeminiShoppingAgent({
      apiKey: 'test-gemini-key',
      fetchImpl: mockFetch,
    });

    const res = await agent.handleMessage({
      message: 'Do you have this in black, medium?',
    });

    expect(capturedPrompt).toContain('Black');
    expect(res.source).toBe('gemini');
    expect(res.reply).toContain('Kai is wearing Olive');
  });

  it('executes instant 1-click purchase using connected Shopify buyer details when user says Yes', async () => {
    const service = new ShopifyMcpService();
    service.updateConnection({
      storeDomain: 'mock.shop',
      email: 'fighter@shopify-demo.ca',
      shippingAddress: '150 Elgin St, Ottawa, ON',
    });

    const receipt = await service.purchaseVariant(
      'gid://shopify/ProductVariant/43696967680022',
      1
    );

    expect(receipt.status).toBe('purchased');
    expect(receipt.orderNumber).toMatch(/^#SP-/);
    expect(receipt.itemTitle).toBe('Puffer Jacket');
    expect(receipt.size).toBe('Medium');
    expect(receipt.color).toBe('Olive');
    expect(receipt.totalAmount).toBe('90.0');
    expect(receipt.currencyCode).toBe('CAD');
    expect(receipt.buyer.email).toBe('fighter@shopify-demo.ca');
    expect(receipt.buyer.shippingAddress).toContain('Ottawa');
  });

  it('finds similar Shopify products for Kai\'s Gucci Reversible GG Canvas Jacket (722511 ZALX2 1043)', async () => {
    const agent = new GeminiShoppingAgent();
    const sim = await agent.findSimilarProducts();

    expect(sim.referenceItem.url).toBe(
      'https://www.gucci.com/us/en/pr/men/ready-to-wear-for-men/outerwear-for-men/bombers-for-men/reversible-gg-canvas-jacket-p-722511ZALX21043'
    );
    expect(sim.referenceItem.styleCode).toBe(GUCCI_REVERSIBLE_GG_JACKET.styleCode);
    expect(sim.matches.length).toBeGreaterThan(0);
    expect(sim.topShopifyUrl).toContain('demostore.hydrogen.mock.shop/products/');
    expect(sim.matches[0].matchScore).toBeGreaterThanOrEqual(80);
  });

  it('uses Gemini to rank similar Shopify outerwear against the Gucci jacket when API key is set', async () => {
    let promptBody = '';
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('generativelanguage.googleapis.com')) {
        promptBody = String(init?.body);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        agentSummary:
                          'Gemini matched Kai\'s Gucci Reversible GG Bomber to Shopify\'s Puffer Jacket for its zip-front nylon silhouette.',
                        picks: [
                          {
                            handle: 'puffer-jacket',
                            matchScore: 95,
                            badge: '#1 Best Bomber Match',
                            matchReason: 'Zip-front weather-resistant nylon shell with Olive colorway.',
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Offline Shopify mock');
    };

    const mcp = new ShopifyMcpService({ fetchImpl: mockFetch });
    const agent = new GeminiShoppingAgent({
      mcpService: mcp,
      apiKey: 'test-gemini-key',
      fetchImpl: mockFetch,
    });

    const sim = await agent.findSimilarProducts();
    expect(promptBody).toContain('722511 ZALX2 1043');
    expect(sim.source).toBe('gemini');
    expect(sim.matches[0].product.handle).toBe('puffer-jacket');
    expect(sim.topShopifyUrl).toBe(
      'https://demostore.hydrogen.mock.shop/products/puffer-jacket'
    );
  });
});
