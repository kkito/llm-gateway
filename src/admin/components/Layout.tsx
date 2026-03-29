import { FC, PropsWithChildren } from 'hono/jsx';

interface Props extends PropsWithChildren {
  title: string;
}

export const Layout: FC<Props> = (props) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link
          rel="stylesheet"
          href="/assets/pico.min.css"
        />
      </head>
      <body>
        <nav class="container-fluid">
          <ul>
            <li><a href="/admin/models">模型管理</a></li>
            <li><a href="/admin/users">用户管理</a></li>
            <li><a href="/admin/stats">统计 Dashboard</a></li>
            <li><a href="/admin/password">密码设置</a></li>
            <li><a href="/admin/api-keys">API Key 管理</a></li>
          </ul>
        </nav>
        <main class="container">{props.children}</main>
      </body>
    </html>
  );
};