import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';

interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

interface Props {
  mode: 'new' | 'edit';
  user?: UserApiKey;
}

export const UserFormPage: FC<Props> = (props) => {
  const isEdit = props.mode === 'edit';
  const title = isEdit ? '编辑用户' : '新增用户';
  const actionUrl = isEdit ? `/admin/users/edit/${props.user?.name}` : '/admin/users/new';

  return (
    <Layout title={title}>
      <h1>{title}</h1>

      <form method="post" action={actionUrl}>
        <div style={{marginBottom: '1rem'}}>
          <label for="name" style={{display: 'block', marginBottom: '0.5rem'}}>
            用户名称 *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={props.user?.name || ''}
            required
            style={{
              width: '100%',
              padding: '0.5rem',
              fontSize: '1rem',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
            placeholder="请输入用户名称"
          />
        </div>

        <div style={{marginBottom: '1rem'}}>
          <label for="desc" style={{display: 'block', marginBottom: '0.5rem'}}>
            描述
          </label>
          <input
            type="text"
            id="desc"
            name="desc"
            value={props.user?.desc || ''}
            style={{
              width: '100%',
              padding: '0.5rem',
              fontSize: '1rem',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
            placeholder="可选，描述用户用途"
          />
        </div>

        {isEdit && (
          <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f3f4f6', borderRadius: '4px'}}>
            <label style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>
              API Key
            </label>
            <code style={{fontSize: '0.9rem', color: '#666'}}>
              {props.user?.apikey}
            </code>
            <p style={{fontSize: '0.8rem', color: '#999', marginTop: '0.5rem', margin: 0}}>
              API Key 不可修改，如需更换请删除后重新创建
            </p>
          </div>
        )}

        <div style={{display: 'flex', gap: '0.5rem', marginTop: '1.5rem'}}>
          <button
            type="submit"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              backgroundColor: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {isEdit ? '保存' : '创建'}
          </button>
          <a
            href="/admin/users"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              backgroundColor: '#e5e7eb',
              color: '#374151',
              textDecoration: 'none',
              borderRadius: '4px',
              display: 'inline-block'
            }}
          >
            取消
          </a>
        </div>
      </form>
    </Layout>
  );
};
