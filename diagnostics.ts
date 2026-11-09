/// <reference lib="dom" />
import type { Page } from 'playwright-core';

const DIAGNOSTICS_DIR = './.cache/diagnostics';

export type LoginSession = 'unverified' | 'required' | 'reused' | 'new-login';

export const recordProfileDiagnostics = async () => {
  try {
    const paths = [
      'Local State',
      'Default/Preferences',
      'Default/Network/Cookies',
      'Default/Cookies',
    ];
    const files = await Promise.all(paths.map(async (path) => {
      const info = await Deno.stat(`./.cache/toonation-profile/${path}`).catch(
        () => null,
      );

      return { path, exists: info !== null, size: info?.size ?? null };
    }));
    const cacheMatchedKey = Deno.env.get('BROWSER_PROFILE_CACHE_KEY') || null;
    const report = {
      recordedAt: new Date().toISOString(),
      cacheMatchedKey,
      cacheRestored: cacheMatchedKey !== null,
      files,
    };

    await Deno.mkdir(DIAGNOSTICS_DIR, { recursive: true });
    await Deno.writeTextFile(
      `${DIAGNOSTICS_DIR}/profile.json`,
      JSON.stringify(report, null, 2),
    );
    console.info('프로필 복원 진단:', JSON.stringify(report));
  } catch {
    console.error('프로필 진단 기록에 실패했습니다.');
  }
};

export const recordBrowserDiagnostics = async (
  page: Page,
  stage: string,
  loginSession: LoginSession,
  screenshot = false,
) => {
  try {
    const url = new URL(page.url());
    const [cookies, state] = await Promise.allSettled([
      page.context().cookies('https://toon.at'),
      page.evaluate(() => {
        const input = (selector: string) =>
          document.querySelector<HTMLInputElement>(selector);
        const loginButton = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === '로그인',
        );
        const captcha = input('input[name="cf-turnstile-response"]');

        return {
          loginInputPresent: input('input[placeholder="아이디 입력"]') !== null,
          idFilled: Boolean(input('input[placeholder="아이디 입력"]')?.value),
          passwordFilled: Boolean(input('input[type="password"]')?.value),
          rememberLoginChecked: input('input[name="maintain_login_state"]')
            ?.checked ?? null,
          loginButtonDisabled: loginButton?.disabled ?? null,
          captchaResponsePresent: captcha !== null,
          captchaHasToken: Boolean(captcha?.value),
        };
      }),
    ]);
    const report = {
      recordedAt: new Date().toISOString(),
      stage,
      loginSession,
      // URL의 쿼리와 해시에는 인증 정보가 포함될 수 있습니다.
      page: url.protocol === 'about:'
        ? 'about:blank'
        : `${url.origin}${url.pathname}`,
      authCookies: cookies.status === 'fulfilled'
        ? cookies.value.filter((cookie) =>
          cookie.name.startsWith('__toonation_login_')
        ).map((cookie) => ({
          name: cookie.name,
          domain: cookie.domain,
          expires: cookie.expires,
          sessionCookie: cookie.expires === -1,
          hasValue: Boolean(cookie.value),
        }))
        : null,
      state: state.status === 'fulfilled' ? state.value : null,
      challengeFrameCount: page.frames().filter((frame) =>
        frame.url().startsWith('https://challenges.cloudflare.com/')
      ).length,
    };

    await Deno.mkdir(DIAGNOSTICS_DIR, { recursive: true });
    await Deno.writeTextFile(
      `${DIAGNOSTICS_DIR}/${stage}.json`,
      JSON.stringify(report, null, 2),
    );
    console.info('브라우저 진단:', JSON.stringify(report));

    if (screenshot) {
      // 공개 저장소의 아티팩트에 계정 화면과 후원 내역이 노출되지 않게 합니다.
      const mask = url.origin === 'https://toon.at' &&
          url.pathname === '/streamer/login'
        ? page.locator('input, textarea, [contenteditable]')
        : page.locator('body');

      await page.screenshot({
        path: `${DIAGNOSTICS_DIR}/${stage}.png`,
        mask: [mask],
        timeout: 5000,
      });
    }
  } catch {
    // 진단 실패가 원래의 크롤링 오류를 덮어쓰지 않도록 합니다.
    console.error(`브라우저 진단 기록에 실패했습니다. (stage: ${stage})`);
  }
};
