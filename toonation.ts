import type { Page } from 'playwright-core';
import { transformDonationJson } from './utils.ts';
import type {
  ToonationApiGetDonationListResponse,
  ToonationDonationItem,
} from './types.ts';

// const PAGE_SIZE = 30;
const START_DATE = '2016-01-01';

const [year, , month, , day] = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts();

const END_DATE = `${year.value}-${month.value}-${day.value}`;

export const getDonationItems = async (page: Page, pageNumber: number = 1) => {
  const data = await page.evaluate(async ({ from, to, page }) => {
    const url = new URL('https://toon.at/dapi/streamer/donation_list');

    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('page', page.toString());

    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`후원 목록 조회 실패 (HTTP ${response.status})`);
    }

    return await response.json() as ToonationApiGetDonationListResponse;
  }, {
    from: START_DATE,
    to: END_DATE,
    page: pageNumber,
  });

  return transformDonationJson(data);
};

export const sendDonationPages = async (
  readPage: (pageNumber: number) => Promise<ToonationDonationItem[]>,
  send: (items: ToonationDonationItem[]) => Promise<Response>,
) => {
  const items: ToonationDonationItem[] = [];

  for (let pageNumber = 1;; pageNumber++) {
    const page = await readPage(pageNumber);
    if (!page.length) {
      throw new Error(
        `조회할 후원 내역이 더 없습니다. (pageNumber: ${pageNumber})`,
      );
    }
    items.push(...page);
    console.info('크롤링된 후원 아이템 개수:', items.length);
    console.info('최근 후원 시간:', items[0].createdAt);

    const response = await send(items);
    if (response.ok) {
      await response.body?.cancel();
      console.info(
        `webhook에서 성공적으로 응답을 받았습니다. (pageNumber: ${pageNumber})`,
      );
      return;
    }

    const message = await response.text();
    if (response.status !== 404 || message !== 'not-found-last-donation') {
      throw new Error(
        `Webhook 응답 오류 (HTTP ${response.status}): ${message}`,
      );
    }

    console.info(
      `다음 페이지를 포함하여 탐색합니다. (pageNumber: ${pageNumber + 1})`,
    );
  }
};
