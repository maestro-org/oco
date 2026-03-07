import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const FALLBACK_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OCO Admin Dashboard</title>
  <style>
    body{
      margin:0;
      min-height:100vh;
      display:grid;
      place-items:center;
      font-family:"IBM Plex Sans",system-ui,sans-serif;
      background:#f4f7fb;
      color:#152238;
    }
    main{
      width:min(680px,92vw);
      background:#fff;
      border:1px solid #d7dde8;
      border-radius:14px;
      padding:20px;
      box-shadow:0 16px 36px rgba(21,34,56,.1);
    }
    h1{margin:0 0 10px;font-size:1.2rem}
    p{margin:0 0 12px;color:#3c4f6f}
    code{
      background:#f0f3fa;
      border-radius:8px;
      padding:2px 6px;
      border:1px solid #d7dde8;
    }
  </style>
</head>
<body>
  <main>
    <h1>OCO Admin Dashboard</h1>
    <p>Dashboard bundle not found. Build the React client before opening this page.</p>
    <p>Run <code>bun run dashboard:build</code> or <code>bun run dashboard:dev</code>.</p>
  </main>
</body>
</html>`;

export interface AdminAsset {
  contentType: string;
  body: string | Buffer;
}

function dashboardDistPath(): string {
  const envPath = process.env.OCO_DASHBOARD_DIST?.trim();
  if (envPath) {
    return resolve(envPath);
  }
  return resolve(process.cwd(), 'dashboard', 'dist');
}

function normalizeRequestPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/admin')) {
    return undefined;
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    return '/index.html';
  }

  const requested = pathname.slice('/admin'.length);
  if (!requested.startsWith('/')) {
    return undefined;
  }
  return requested;
}

function resolveSafeDistFile(distRoot: string, requestedPath: string): string | undefined {
  const target = resolve(distRoot, `.${requestedPath}`);
  if (!target.startsWith(distRoot)) {
    return undefined;
  }
  if (!existsSync(target)) {
    return undefined;
  }
  return target;
}

function contentTypeForPath(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function loadDistAsset(pathname: string): AdminAsset | undefined {
  const requestedPath = normalizeRequestPath(pathname);
  if (!requestedPath) {
    return undefined;
  }

  const distRoot = dashboardDistPath();
  const direct = resolveSafeDistFile(distRoot, requestedPath);
  if (direct) {
    return {
      contentType: contentTypeForPath(direct),
      body: readFileSync(direct),
    };
  }

  if (!requestedPath.includes('.')) {
    const indexFile = resolveSafeDistFile(distRoot, '/index.html');
    if (indexFile) {
      return {
        contentType: 'text/html; charset=utf-8',
        body: readFileSync(indexFile),
      };
    }
  }

  return undefined;
}

export function hasAdminAsset(pathname: string): boolean {
  if (!pathname.startsWith('/admin')) {
    return false;
  }
  return true;
}

export function getAdminAsset(pathname: string): AdminAsset {
  const distAsset = loadDistAsset(pathname);
  if (distAsset) {
    return distAsset;
  }

  return {
    contentType: 'text/html; charset=utf-8',
    body: FALLBACK_ADMIN_HTML,
  };
}
