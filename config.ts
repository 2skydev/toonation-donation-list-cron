const REQUIRE_ENVS = [
  'TOONATION_ID',
  'TOONATION_PASSWORD',
  'WEBHOOK_URL',
  'WEBHOOK_SECRET',
];

const noConfiguredMessages = REQUIRE_ENVS.map((key) => {
  return Deno.env.get(key) ? '' : `환경변수 ${key}가 설정되지 않았습니다.\n`;
}).join('');

if (noConfiguredMessages) {
  throw new Error(noConfiguredMessages);
}

export const config = {
  toonation: {
    id: Deno.env.get('TOONATION_ID')!,
    password: Deno.env.get('TOONATION_PASSWORD')!,
  },
  webhook: {
    url: Deno.env.get('WEBHOOK_URL')!,
    secret: Deno.env.get('WEBHOOK_SECRET')!,
  },
};
