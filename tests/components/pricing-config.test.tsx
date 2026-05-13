import { describe, it, expect } from 'vitest';
import { PricingConfig } from '../../src/admin/components/PricingConfig.js';

describe('PricingConfig', () => {
  it('should render without errors when no props are provided', () => {
    const html = String(<PricingConfig />);
    expect(html).toContain('价格配置');
    expect(html).toContain('inputPricePer1M');
    expect(html).toContain('outputPricePer1M');
    expect(html).toContain('cachedPricePer1M');
  });

  it('should render with provided price values', () => {
    const html = String(
      <PricingConfig 
        inputPricePer1M={0.15}
        outputPricePer1M={0.30}
        cachedPricePer1M={0.05}
      />,
    );
    expect(html).toContain('0.15');
    expect(html).toContain('0.30');
    expect(html).toContain('0.05');
  });

  it('should have number inputs with min="0"', () => {
    const html = String(<PricingConfig />);
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('step="any"');
  });
});
