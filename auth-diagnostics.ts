import type { BrowserContext, Request } from 'playwright-core';

const AUTH_PATHS = new Set([
  '/streamer/dashboard',
  '/streamer/login',
  '/dapi/streamer/common',
  '/dapi/streamer/social/login',
  '/dapi/streamer/social/accounts',
  '/dapi/logout/2',
]);

export const cookieValueHash = async (value: string) => {
  if (!value) return null;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
};

const describeCookie = async (header: string) => {
  const [cookie, ...parts] = header.split(';');
  const separator = cookie.indexOf('=');
  const attributes = new Map(parts.map((part) => {
    const [name, ...value] = part.trim().split('=');
    return [name.toLowerCase(), value.join('=')];
  }));

  return {
    name: cookie.slice(0, separator).trim(),
    valueHash: await cookieValueHash(cookie.slice(separator + 1)),
    domain: attributes.get('domain') ?? null,
    path: attributes.get('path') ?? null,
    expires: attributes.get('expires') ?? null,
    maxAge: attributes.get('max-age') ?? null,
    httpOnly: attributes.has('httponly'),
    secure: attributes.has('secure'),
    sameSite: attributes.get('samesite') ?? null,
    partitioned: attributes.has('partitioned'),
  };
};

const recordAuthResponse = async (request: Request) => {
  const recordedAt = new Date().toISOString();
  const url = new URL(request.url());
  const response = await request.response();
  if (!response) return;

  const [cookieHeader, setCookieHeaders, location, contentType] = await Promise
    .all([
      request.headerValue('cookie'),
      response.headerValues('set-cookie'),
      response.headerValue('location'),
      response.headerValue('content-type'),
    ]);
  const data = contentType?.includes('json')
    ? await response.json().catch(() => null)
    : null;
  const report = {
    recordedAt,
    method: request.method(),
    url: `${url.origin}${url.pathname}`,
    status: response.status(),
    location: location ? new URL(location, url).pathname : null,
    fromServiceWorker: response.fromServiceWorker(),
    requestCookies: await Promise.all(
      (cookieHeader?.split(/;\s*/) ?? []).map(async (cookie) => {
        const separator = cookie.indexOf('=');
        return {
          name: cookie.slice(0, separator),
          valueHash: await cookieValueHash(cookie.slice(separator + 1)),
        };
      }),
    ),
    setCookies: await Promise.all(setCookieHeaders.map(describeCookie)),
    result: data
      ? {
        IsLogin: typeof data.IsLogin === 'boolean' ? data.IsLogin : null,
        statusCode: typeof data.statusCode === 'number'
          ? data.statusCode
          : null,
        code: typeof data.code === 'number' ? data.code : null,
      }
      : null,
  };

  await Deno.mkdir('./.cache/diagnostics', { recursive: true });
  await Deno.writeTextFile(
    './.cache/diagnostics/auth-network.jsonl',
    `${JSON.stringify(report)}\n`,
    { append: true },
  );
  console.info('인증 응답 진단:', JSON.stringify(report));
};

export const startAuthDiagnostics = (context: BrowserContext) => {
  const pending: Promise<void>[] = [];
  const onFinished = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin !== 'https://toon.at' || !AUTH_PATHS.has(url.pathname)) {
      return;
    }

    pending.push(
      recordAuthResponse(request).catch(() => {
        console.error(
          `인증 응답 진단 기록에 실패했습니다. (path: ${url.pathname})`,
        );
      }),
    );
  };
  context.on('requestfinished', onFinished);

  return async () => {
    context.off('requestfinished', onFinished);
    await Promise.all(pending);
  };
};
