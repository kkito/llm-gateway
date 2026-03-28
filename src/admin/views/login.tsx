import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';

interface Props {
  error?: string;
  isSetup?: boolean;
}

export const LoginPage: FC<Props> = (props) => {
  const title = props.isSetup ? '设置管理员密码' : '管理员登录';
  
  return (
    <Layout title={title}>
      <h1>{title}</h1>
      
      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}
      
      {props.isSetup && (
        <article style={{ backgroundColor: '#fff3cd', color: '#856404', marginBottom: '1rem' }}>
          <strong>提示：</strong> 首次使用后台管理，请设置管理员密码。删除 config.json 中的 adminPassword 字段可清除密码。
        </article>
      )}
      
      <form method="post" action="/admin/login">
        <label htmlFor="password">密码</label>
        <input 
          type="password" 
          id="password" 
          name="password" 
          required 
          autofocus
          placeholder="请输入密码"
        />
        <button type="submit">
          {props.isSetup ? '设置密码' : '登录'}
        </button>
      </form>
    </Layout>
  );
};
