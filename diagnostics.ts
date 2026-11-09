/// <reference lib="dom" />
import type { Page } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { cookieValueHash } from './auth-diagnostics.ts';

const DIAGNOSTICS_DIR = './.cache/diagnostics';

export type LoginSession = 'unverified' | 'required' | 'reused' | 'new-login';

export const recordProfileDiagnostics = async (stage = 'profile') => {
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
    // cache-hit은 접두사로 복원하면 'false', 캐시가 없으면 빈 문자열입니다.
    const cacheHit = Deno.env.get('BROWSER_PROFILE_CACHE_HIT') || null;
    const inspection = await new Deno.Command(
      Deno.build.os === 'windows' ? 'python' : 'python3',
      {
        args: [
          fileURLToPath(new URL('./profile_diagnostics.py', import.meta.url)),
        ],
        stdout: 'piped',
        stderr: 'piped',
      },
    ).output();
    const report = {
      recordedAt: new Date().toISOString(),
      stage,
      cacheHit,
      cacheRestored: cacheHit !== null,
      files,
      storedProfile: inspection.success
        ? JSON.parse(new TextDecoder().decode(inspection.stdout))
        : null,
    };

    await Deno.mkdir(DIAGNOSTICS_DIR, { recursive: true });
    await Deno.writeTextFile(
      `${DIAGNOSTICS_DIR}/${stage}.json`,
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
      page.context().cookies(),
      page.evaluate(() => {
        const input = (selector: string) =>
          document.querySelector<HTMLInputElement>(selector);
        const loginButton = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === '로그인',
        );
        const captcha = input('input[name="cf-turnstile-response"]');

        return {
          documentReadyState: document.readyState,
          dashboardHeaderPresent: document.querySelector(
            'header[class*="_RouteDashboardHeader_"]',
          ) !== null,
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
      siteCookies: cookies.status === 'fulfilled'
        ? await Promise.all(
          cookies.value.filter((cookie) =>
            cookie.domain.replace(/^\./, '') === 'toon.at' ||
            cookie.domain.endsWith('.toon.at')
          ).map(async (cookie) => ({
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            sessionCookie: cookie.expires === -1,
            hasValue: Boolean(cookie.value),
            valueHash: await cookieValueHash(cookie.value),
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            partitionKey: cookie.partitionKey ?? null,
          })),
        )
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
