import { launchPersistentContext } from 'cloakbrowser';
import { getDonationItems } from './toonation.ts';
import { config } from './config.ts';
import { ToonationDonationItem } from './types.ts';
import { sendSignedWebhook } from './webhook.ts';
import {
  type LoginSession,
  recordBrowserDiagnostics,
  recordProfileDiagnostics,
} from './diagnostics.ts';

await recordProfileDiagnostics();

const context = await launchPersistentContext({
  headless: false,
  humanize: true,
  proxy: 'socks5://127.0.0.1:1080',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
  userDataDir: './.cache/toonation-profile',
  args: [
    '--fingerprint=1212',
  ],
});

const page = await context.newPage();
let loginSession: LoginSession = 'unverified';

const donationItems: ToonationDonationItem[] = [];

const getDonationItemsAndSendWebhook = async (pageNumber: number) => {
  donationItems.push(...await getDonationItems(page, pageNumber));

  console.info('크롤링된 후원 아이템 개수:', donationItems.length);
  console.info('최근 후원 시간:', donationItems[0].createdAt);

  const response = await sendSignedWebhook(
    config.webhook.url,
    config.webhook.secret,
    donationItems,
  );

  if (response.status === 404) {
    const text = await response.text();

    if (text === 'not-found-last-donation') {
      console.log(
        `webhook에서 not-found-last-donation를 받았습니다. 다음 페이지를 포함하여 탐색합니다. (pageNumber: ${pageNumber})`,
      );

      await getDonationItemsAndSendWebhook(pageNumber + 1);
    }

    console.error('webhook에서 오류 응답을 받았습니다.');
    console.error(`[${response.status}]`, text);
    throw new Error(text);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('webhook에서 오류 응답을 받았습니다.');
    console.error(`[${response.status}]`, errText);
    throw new Error(errText);
  }

  const okText = await response.text();
  console.log(
    `webhook에서 성공적으로 응답을 받았습니다. (pageNumber: ${pageNumber})`,
  );

  console.log(`[${response.status}]`, okText);
};

try {
  await recordBrowserDiagnostics(page, 'browser-started', loginSession);
  await page.goto('https://toon.at/streamer/dashboard');

  const loginInput = page.getByPlaceholder('아이디 입력');
  const dashboardHeader = page.locator(
    'header[class*="_RouteDashboardHeader_"]',
  );

  // 페이지 로드 이후 진행되는 인증 확인과 화면 렌더링을 기다립니다.
  await loginInput.or(dashboardHeader).first().waitFor({ timeout: 10000 });

  if (new URL(page.url()).pathname === '/streamer/login') {
    loginSession = 'required';
    await recordBrowserDiagnostics(page, 'login-required', loginSession);

    await loginInput.fill(config.toonation.id);
    await page.getByPlaceholder('패스워드 입력').fill(
      config.toonation.password,
    );
    if (!await page.getByLabel('로그인 상태 유지').isChecked()) {
      await page.getByText('로그인 상태 유지', { exact: true }).click();
    }

    await recordBrowserDiagnostics(page, 'before-login-click', loginSession);
    await page.getByText('로그인', { exact: true }).click();
    await page.waitForURL('**/dashboard');
  }

  await dashboardHeader.waitFor({ timeout: 10000 });

  loginSession = loginSession === 'required' ? 'new-login' : 'reused';
  await recordBrowserDiagnostics(page, 'authenticated', loginSession);

  if (Deno.env.get('LOGIN_CHECK_ONLY') !== 'true') {
    await getDonationItemsAndSendWebhook(1);
  }
} catch (error) {
  await recordBrowserDiagnostics(page, 'failure', loginSession, true);
  throw error;
} finally {
  console.info('브라우저 종료 시작');
  await context.close();
  console.info('브라우저 종료 완료');
}
