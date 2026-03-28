import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';

interface Props {
  error?: string;
  success?: string;
  hasPassword: boolean;
}

export const PasswordPage: FC<Props> = (props) => {
  return (
    <Layout title="修改密码">
      <h1>修改密码</h1>
      
      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}
      
      {props.success && (
        <article aria-label="成功提示" style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
          <strong>成功：</strong> {props.success}
        </article>
      )}
      
      {!props.hasPassword ? (
        <article style={{ backgroundColor: '#fff3cd', color: '#856404' }}>
          <strong>提示：</strong> 当前未设置密码。下方设置新密码后，访问后台需要输入密码。
          <br />
          如需取消密码保护，请删除 config.json 中的 adminPassword 字段。
        </article>
      ) : (
        <article style={{ backgroundColor: '#e0f2fe', color: '#0c4a6e', marginBottom: '1rem' }}>
          <strong>提示：</strong> 当前已设置密码保护。可以修改或删除密码。
        </article>
      )}
      
      <form method="post" action="/admin/password">
        {props.hasPassword && (
          <>
            <label htmlFor="currentPassword">当前密码</label>
            <input 
              type="password" 
              id="currentPassword" 
              name="currentPassword" 
              required 
              placeholder="请输入当前密码"
            />
          </>
        )}
        
        <label htmlFor="newPassword">新密码</label>
        <input 
          type="password" 
          id="newPassword" 
          name="newPassword" 
          required 
          placeholder="请输入新密码"
        />
        
        <label htmlFor="confirmPassword">确认新密码</label>
        <input 
          type="password" 
          id="confirmPassword" 
          name="confirmPassword" 
          required 
          placeholder="请再次输入新密码"
        />
        
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="submit" name="action" value="change">
            {props.hasPassword ? '修改密码' : '设置密码'}
          </button>
          
          {props.hasPassword && (
            <button 
              type="submit" 
              name="action" 
              value="delete"
              class="secondary"
              onclick="return confirm('确定要删除密码保护吗？删除后访问后台将不需要密码。')"
            >
              删除密码
            </button>
          )}
        </div>
      </form>
      
      <p style={{ marginTop: '1rem', color: '#666', fontSize: '0.9rem' }}>
        <a href="/admin/models">返回模型列表</a>
      </p>
    </Layout>
  );
};
