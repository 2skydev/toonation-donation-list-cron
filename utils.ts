import {
  ToonationApiGetDonationListResponse,
  ToonationDonationItem,
} from './types.ts';

/**
 * .NET DateTime.Ticks를 JavaScript Date로 변환하는 함수
 */
const ticksToDate = (ticks: number): Date => {
  const epochTicks = 621355968000000000;
  const ticksToUnixEpoch = ticks - epochTicks;
  const milliseconds = ticksToUnixEpoch / 10000;
  return new Date(milliseconds);
};

/**
 * 투네이션 API 응답 데이터를 ToonationDonationItem 타입으로 변환
 */
export const transformDonationJson = (
  data: ToonationApiGetDonationListResponse,
): ToonationDonationItem[] => {
  const items: ToonationDonationItem[] = data.data.list.map((item) => {
    return {
      account: item.acc,
      nickname: item.name,
      amount: item.cash,
      message: item.message,
      createdAt: ticksToDate(item.time).toISOString(),
    };
  });

  return items;
};
