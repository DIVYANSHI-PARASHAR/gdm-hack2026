export type BossStrategyId =
  | 'pressure'
  | 'delayed_strike'
  | 'bait_and_counter'
  | 'defensive_reset';

export const BOSS_STRATEGIES: readonly BossStrategyId[] = [
  'pressure',
  'delayed_strike',
  'bait_and_counter',
  'defensive_reset',
] as const;

export type StrategySource = 'gemini' | 'local';

export interface ExchangeSummaryPayload {
  matchId: string;
  exchangeIndex: number;
  round: number;
  recentLeftPunches: number;
  recentRightPunches: number;
  recentLeanLeftCount: number;
  recentLeanRightCount: number;
  earlyDodgeCount: number;
  playerLandedHits: number;
  playerBlockedOrWhiffed: number;
  bossLandedHits: number;
  playerDodgedStrikes: number;
  playerHealthPct: number;
  bossHealthPct: number;
  lastStrategy: BossStrategyId;
}

export interface StrategyDecisionResponse {
  matchId: string;
  exchangeIndex: number;
  strategy: BossStrategyId;
  source: StrategySource;
  confidence?: number;
  latencyMs?: number;
  reason?: string;
}

export type MatchPhase =
  | 'READY'
  | 'CALIBRATING'
  | 'FIGHTING'
  | 'PAUSED_TRACKING'
  | 'VICTORY'
  | 'DEFEAT';

export type PlayerActionState =
  | 'NEUTRAL'
  | 'LEAN_LEFT'
  | 'LEAN_RIGHT'
  | 'PUNCH_LEFT'
  | 'PUNCH_RIGHT'
  | 'HIT_STUN';

export type BossAttackSide = 'LEFT' | 'RIGHT' | 'CENTER';

export type BossState =
  | 'IDLE'
  | 'BAIT_GUARD'
  | 'WINDUP'
  | 'STRIKE_ACTIVE'
  | 'RECOVERY'
  | 'DODGING'
  | 'HIT_REACT'
  | 'KO'
  | 'VICTORY_POSE';

export type CombatEventType =
  | 'PLAYER_PUNCH_THROW'
  | 'PLAYER_PUNCH_HIT'
  | 'PLAYER_PUNCH_COUNTER_HIT'
  | 'PLAYER_PUNCH_DODGED_BY_BOSS'
  | 'PLAYER_PUNCH_BAITED'
  | 'BOSS_WINDUP_START'
  | 'BOSS_STRIKE_START'
  | 'BOSS_STRIKE_HIT_PLAYER'
  | 'PLAYER_DODGE_SUCCESS'
  | 'BOSS_RECOVERY_OPEN'
  | 'STRATEGY_APPLIED'
  | 'MATCH_VICTORY'
  | 'MATCH_DEFEAT';

export interface CombatEvent {
  type: CombatEventType;
  timestampMs: number;
  side?: 'LEFT' | 'RIGHT' | 'CENTER';
  damage?: number;
  strategy?: BossStrategyId;
  strategySource?: StrategySource;
  label?: string;
}

export type HeartRateStatus =
  | 'unsupported'
  | 'idle'
  | 'pairing'
  | 'connected'
  | 'stale'
  | 'disconnected';

export type HeartRateSourceType = 'none' | 'fitbit_ble' | 'demo';

export interface HeartRateSample {
  bpm: number;
  is16Bit: boolean;
  sensorContactSupported: boolean;
  sensorContactDetected: boolean;
  timestampMs: number;
  isDemo: boolean;
}

export type SyncedCaloriesStatus =
  | 'unconfigured'
  | 'disconnected'
  | 'idle'
  | 'loading'
  | 'synced'
  | 'awaiting_sync'
  | 'unavailable';

export interface SyncedCaloriesResponse {
  status: SyncedCaloriesStatus;
  kcal?: number;
  coveredRatio?: number;
  matchDurationSec?: number;
  message: string;
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  size: string;
  color: string;
  price: {
    amount: string;
    currencyCode: string;
  };
  availableForSale: boolean;
  quantityAvailable?: number;
  image?: { url: string; altText?: string };
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  featuredImage: { url: string; altText?: string };
  sizes: string[];
  colors: string[];
  variants: ShopifyProductVariant[];
  onlineStoreUrl?: string;
}

export interface ShoppingChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface ShoppingAgentResponse {
  reply: string;
  selectedVariant: ShopifyProductVariant | null;
  alternatives?: ShopifyProductVariant[];
  clarificationNeeded?: boolean;
  modelUsed?: string;
  source?: 'gemini' | 'local_agent';
}

export interface ShopifyCartHandoff {
  cartId: string;
  checkoutUrl: string;
  totalAmount: string;
  currencyCode: string;
  lines: Array<{
    variantId: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface SelectedOutfitReview {
  merchant: string;
  item: string;
  size: string;
  color: string;
  price: string;
  variantId: string;
  productId: string;
}

export interface ShopifyBuyerProfile {
  name: string;
  email: string;
  shippingAddress: string;
  paymentLabel: string;
  storeDomain: string;
}

export interface ShopifyPurchaseReceipt {
  orderNumber: string;
  status: 'purchased';
  cartId: string;
  checkoutUrl: string;
  merchant: string;
  itemTitle: string;
  variantId: string;
  variantTitle: string;
  size: string;
  color: string;
  totalAmount: string;
  currencyCode: string;
  buyer: ShopifyBuyerProfile;
  purchasedAtIso: string;
  source: 'live_shopify' | 'fallback_cache';
}

export interface ReferenceLuxuryItem {
  title: string;
  brand: string;
  styleCode: string;
  retailPrice: string;
  url: string;
  description: string;
  imageUrl: string;
  keyDetails: string[];
}

export interface ShopifySimilarProductMatch {
  product: ShopifyProduct;
  shopifyPageUrl: string;
  matchScore: number;
  badge: string;
  matchReason: string;
}

export interface SimilarProductsResponse {
  referenceItem: ReferenceLuxuryItem;
  matches: ShopifySimilarProductMatch[];
  topShopifyUrl: string;
  agentSummary: string;
  modelUsed: string;
  source: 'gemini' | 'local_agent';
}


