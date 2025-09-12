import type { Page } from 'playwright';
import { transformDonationJson } from './utils.ts';
import { ToonationApiGetDonationListResponse } from './types.ts';

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

    const response = await fetch(url.toString());

    return await response.json() as ToonationApiGetDonationListResponse;
  }, {
    from: START_DATE,
    to: END_DATE,
    page: pageNumber,
  });

  return transformDonationJson(data);
};
