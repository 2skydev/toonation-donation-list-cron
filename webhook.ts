const SIGNATURE_HEADER_KEY = 'X-Signature-Sha256';
const TIMESTAMP_HEADER_KEY = 'X-Signature-Timestamp';

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 본문 문자열과 동일한 순서로 서명한다. (검증측 raw body 와 일치해야 함)
 */
export async function sendSignedWebhook(
  url: string,
  secret: string,
  payload: unknown,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestampSec = Math.floor(Date.now() / 1000);
  const signature = await hmacSha256Hex(
    secret,
    `${timestampSec}${body}`,
  );

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [TIMESTAMP_HEADER_KEY]: String(timestampSec),
      [SIGNATURE_HEADER_KEY]: signature,
    },
    body,
  });
}
