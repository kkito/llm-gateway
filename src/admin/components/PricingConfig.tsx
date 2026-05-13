import { FC } from 'hono/jsx';

interface Props {
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cachedPricePer1M?: number;
}

export const PricingConfig: FC<Props> = ({ 
  inputPricePer1M, 
  outputPricePer1M, 
  cachedPricePer1M 
}) => {
  const safeValue = (val: number | undefined) => val !== undefined ? val : '';

  return (
    <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
      <h2 style={{ 
        fontFamily: 'system-ui, -apple-system, sans-serif', 
        fontWeight: '700', 
        fontSize: '1.25rem', 
        marginBottom: '1rem' 
      }}>
        价格配置
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        配置模型的 token 计费价格，用于费用统计（单位：元/每百万 token）
      </p>

      <div className="form-group">
        <label className="form-label" for="inputPricePer1M">
          输入 Token 价格
          <input
            className="form-input"
            id="inputPricePer1M"
            name="inputPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.15"
            value={safeValue(inputPricePer1M)}
          />
          <span className="form-hint">每百万输入 token 的价格（元）</span>
        </label>
      </div>

      <div className="form-group">
        <label className="form-label" for="outputPricePer1M">
          输出 Token 价格
          <input
            className="form-input"
            id="outputPricePer1M"
            name="outputPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.30"
            value={safeValue(outputPricePer1M)}
          />
          <span className="form-hint">每百万输出 token 的价格（元）</span>
        </label>
      </div>

      <div className="form-group">
        <label className="form-label" for="cachedPricePer1M">
          缓存 Token 价格
          <input
            className="form-input"
            id="cachedPricePer1M"
            name="cachedPricePer1M"
            type="number"
            min="0"
            step="any"
            placeholder="例如：0.05"
            value={safeValue(cachedPricePer1M)}
          />
          <span className="form-hint">每百万缓存 token 的价格（元）</span>
        </label>
      </div>
    </div>
  );
};
