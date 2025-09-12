/**
 * 투네이션 후원 아이템
 */
export interface ToonationDonationItem {
  account: string;
  nickname: string;
  amount: number;
  message: string;
  createdAt: string;
}

/**
 * 투네이션 후원 목록 조회 API 응답 데이터
 */
export interface ToonationApiGetDonationListResponse {
  code: number;
  message: string;
  data: {
    count: number;
    list: any[];
    voting_table: any[];
  };
}
