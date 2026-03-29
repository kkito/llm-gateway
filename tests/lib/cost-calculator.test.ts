import { describe, it, expect } from 'vitest';
import { calculateCost, hasValidPricing, type Pricing, type TokenUsage } from '../../src/lib/cost-calculator.js';

describe('cost-calculator', () => {
  describe('calculateCost', () => {
    const pricing: Pricing = {
      inputPricePer1M: 10.0,
      outputPricePer1M: 30.0,
      cachedPricePer1M: 0
    };

    it('should calculate cost for input tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(10.0);
    });

    it('should calculate cost for output tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(30.0);
    });

    it('should calculate cost for mixed usage', () => {
      const usage: TokenUsage = {
        inputTokens: 500_000,
        outputTokens: 200_000,
        cachedTokens: 100_000
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(5.0 + 6.0 + 0); // 5 + 6 + 0 = 11
    });

    it('should handle cached tokens with discount', () => {
      const pricingWithCache: Pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 2.5
      };
      
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 1_000_000
      };
      
      const cost = calculateCost(usage, pricingWithCache);
      expect(cost).toBe(2.5);
    });

    it('should handle zero usage', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(0);
    });

    it('should handle small token amounts', () => {
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0
      };
      
      const cost = calculateCost(usage, pricing);
      expect(cost).toBeCloseTo(0.001 + 0.0015, 5); // 0.0025
    });
  });

  describe('hasValidPricing', () => {
    it('should return true for valid pricing', () => {
      const pricing: Pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      };
      
      expect(hasValidPricing(pricing)).toBe(true);
    });

    it('should return false for undefined', () => {
      expect(hasValidPricing(undefined)).toBe(false);
    });

    it('should return false for missing fields', () => {
      const pricing = {
        inputPricePer1M: 10.0,
        outputPricePer1M: 30.0
      } as Pricing;
      
      expect(hasValidPricing(pricing)).toBe(false);
    });

    it('should return false for non-number fields', () => {
      const pricing = {
        inputPricePer1M: '10.0',
        outputPricePer1M: 30.0,
        cachedPricePer1M: 0
      } as any;
      
      expect(hasValidPricing(pricing)).toBe(false);
    });
  });
});
