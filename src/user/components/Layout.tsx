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
        <main class="container">{props.children}</main>
      </body>
    </html>
  );
};
