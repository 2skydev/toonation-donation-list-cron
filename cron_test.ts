import assert from 'node:assert/strict';
import { readDiagnostic } from './auth-diagnostics.ts';
import { sendDonationPages } from './toonation.ts';
import type { ToonationDonationItem } from './types.ts';

const item = (id: number): ToonationDonationItem => ({
  account: String(id),
  nickname: 'test',
  amount: 1000,
  message: '',
  createdAt: '2026-11-16T00:00:00Z',
});

const morePages = () =>
  new Response('not-found-last-donation', { status: 404 });

Deno.test('추가 페이지를 요청한 뒤 웹훅이 성공하면 전송을 끝낸다', async () => {
  const requests: string[][] = [];
  await sendDonationPages(
    (page) => Promise.resolve([item(page)]),
    (items) => {
      requests.push(items.map((row) => row.account));
      return Promise.resolve(
        requests.length === 1 ? morePages() : new Response(),
      );
    },
  );
  assert.deepEqual(requests, [['1'], ['1', '2']]);
});

Deno.test('마지막 빈 페이지에서는 같은 후원 목록을 다시 전송하지 않는다', async () => {
  let sent = 0;
  await assert.rejects(
    sendDonationPages(
      (page) => Promise.resolve(page === 1 ? [item(1)] : []),
      () => {
        sent++;
        return Promise.resolve(morePages());
      },
    ),
    /더 없습니다/,
  );
  assert.equal(sent, 1);
});

Deno.test('웹훅 응답이 유실되면 중복 전송하지 않는다', async () => {
  let sent = 0;
  await assert.rejects(
    sendDonationPages(
      () => Promise.resolve([item(1)]),
      () => {
        sent++;
        return Promise.reject(new Error('connection reset'));
      },
    ),
    /connection reset/,
  );
  assert.equal(sent, 1);
});

Deno.test('끝나지 않는 진단의 대기를 중단하고 정상 진단 결과는 보존한다', async () => {
  assert.equal(await readDiagnostic(new Promise(() => {}), 5), null);
  assert.equal(await readDiagnostic(Promise.resolve('ready')), 'ready');
});
