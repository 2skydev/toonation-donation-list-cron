import { chromium } from 'playwright';
import { getDonationItems } from './toonation.ts';
import { config } from './config.ts';
import { ToonationDonationItem } from './types.ts';

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'ko-KR' });
const page = await context.newPage();

await page.goto('https://toon.at/streamer/login');
await page.getByPlaceholder('아이디 입력').fill(config.toonation.id);
await page.getByPlaceholder('패스워드 입력').fill(config.toonation.password);
await page.getByRole('button', { name: '로그인' }).click();
await page.waitForURL('**/dashboard');

const donationItems: ToonationDonationItem[] = [];

const getDonationItemsAndSendWebhook = async (pageNumber: number) => {
  donationItems.push(...await getDonationItems(page, pageNumber));

  const response = await fetch(config.webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': config.webhook.secret,
    },
    body: JSON.stringify(donationItems),
  });

  if (response.status === 404) {
    const text = await response.text();

    if (await response.text() === 'not-found-last-donation') {
      console.log(
        `webhook에서 not-found-last-donation를 받았습니다. 다음 페이지를 포함하여 탐색합니다. (pageNumber: ${pageNumber})`,
      );

      await getDonationItemsAndSendWebhook(pageNumber + 1);
    }

    throw new Error(text);
  }

  if (!response.ok) {
    console.error('webhook에서 오류 응답을 받았습니다.');
    throw new Error(await response.text());
  }

  console.log(
    `webhook에서 성공적으로 응답을 받았습니다. (pageNumber: ${pageNumber})`,
  );
};

await getDonationItemsAndSendWebhook(1).finally(async () => {
  await browser.close();
});
