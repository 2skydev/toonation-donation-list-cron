import { launchPersistentContext } from 'cloakbrowser';
import { errors, type Page } from 'playwright-core';
import { getDonationItems, sendDonationPages } from './toonation.ts';
import { config } from './config.ts';
import { sendSignedWebhook } from './webhook.ts';
import {
  type LoginSession,
  recordBrowserDiagnostics,
  recordProfileDiagnostics,
} from './diagnostics.ts';
import { startAuthDiagnostics } from './auth-diagnostics.ts';

const PAGE_TIMEOUT = 60_000;
const DASHBOARD_HEADER = 'header[class*="_RouteDashboardHeader_"]';

await recordProfileDiagnostics();

const launchBrowser = () =>
  launchPersistentContext({
    launchOptions: { timeout: 90_000 },
    headless: false,
    humanize: true,
    proxy: 'socks5://127.0.0.1:1080',
    locale: 'ko-KR',
    timezone: 'Asia/Seoul',
    userDataDir: './.cache/toonation-profile-portable',
    args: [
      '--fingerprint=1212',
      '--fingerprint-portable-cookies',
      '--restore-last-session',
    ],
  });

const context = await launchBrowser().catch((error) => {
  if (!(error instanceof errors.TimeoutError)) throw error;

  console.warn('브라우저 기동 시간이 초과되어 한 번 더 시도합니다.');
  return launchBrowser();
});
context.setDefaultTimeout(PAGE_TIMEOUT);

const stopAuthDiagnostics = startAuthDiagnostics(context);
let loginSession: LoginSession = 'unverified';
let page: Page | undefined;

const openDashboard = async (page: Page) => {
  await page.goto('https://toon.at/streamer/dashboard', {
    waitUntil: 'domcontentloaded',
    timeout: PAGE_TIMEOUT,
  });
  await page.getByPlaceholder('아이디 입력')
    .or(page.locator(DASHBOARD_HEADER))
    .first().waitFor({ timeout: PAGE_TIMEOUT });
};

try {
  await recordProfileDiagnostics('profile-after-launch');
  // 로그인 쿠키는 유지하고 이전 실행에서 복원된 대시보드 탭은 정리합니다.
  const restoredPages = context.pages();
  page = await context.newPage();
  await Promise.all(restoredPages.map((restored) => restored.close()));
  await recordBrowserDiagnostics(page, 'browser-started', loginSession);

  try {
    await openDashboard(page);
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;

    console.warn('대시보드 로딩 시간이 초과되어 새 탭에서 다시 엽니다.');
    const previous = page;
    page = await context.newPage();
    await previous.close();
    await openDashboard(page);
  }

  const loginInput = page.getByPlaceholder('아이디 입력');
  const dashboardHeader = page.locator(DASHBOARD_HEADER);

  if (new URL(page.url()).pathname === '/streamer/login') {
    loginSession = 'required';
    await recordBrowserDiagnostics(page, 'login-required', loginSession);

    await page.bringToFront();
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[placeholder="아이디 입력"]',
        );
        if (!input) return false;

        return document.getAnimations().every((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;

          return !(target instanceof Element && target.contains(input)) ||
            animation.effect?.getComputedTiming().iterations === Infinity ||
            animation.playState === 'finished' ||
            animation.playState === 'idle';
        });
      },
      undefined,
      { timeout: PAGE_TIMEOUT },
    );

    await loginInput.fill(config.toonation.id, { timeout: PAGE_TIMEOUT });
    await page.getByPlaceholder('패스워드 입력').fill(
      config.toonation.password,
      { timeout: PAGE_TIMEOUT },
    );
    if (!await page.getByLabel('로그인 상태 유지').isChecked()) {
      await page.getByText('로그인 상태 유지', { exact: true }).click();
    }

    const loginButton = page.getByText('로그인', { exact: true });
    await loginButton.and(page.locator(':enabled')).waitFor({
      timeout: PAGE_TIMEOUT,
    });

    await recordBrowserDiagnostics(page, 'before-login-click', loginSession);
    await loginButton.click({ timeout: PAGE_TIMEOUT });
    await page.waitForURL('**/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
  }

  await dashboardHeader.waitFor({ timeout: PAGE_TIMEOUT });

  loginSession = loginSession === 'required' ? 'new-login' : 'reused';
  await recordBrowserDiagnostics(page, 'authenticated', loginSession);

  if (Deno.env.get('LOGIN_CHECK_ONLY') !== 'true') {
    const dashboard = page;
    await sendDonationPages(
      (number) => getDonationItems(dashboard, number),
      (items) =>
        sendSignedWebhook(config.webhook.url, config.webhook.secret, items),
    );
  }
} catch (error) {
  if (page) await recordBrowserDiagnostics(page, 'failure', loginSession, true);
  throw error;
} finally {
  await stopAuthDiagnostics();
  console.info('브라우저 종료 시작');
  await context.close();
  console.info('브라우저 종료 완료');
  await recordProfileDiagnostics('profile-after-close');
}
