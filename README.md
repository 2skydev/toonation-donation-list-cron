# 투네이션 후원 목록 자동 조회 크론 (playwright 크롤링)

투네이션 스트리머 계정의 후원 내역을 수집해 지정한 Webhook으로 전달하는 Deno 스크립트입니다. 크론 환경에서 주기적으로 실행하도록 설계되었습니다.

## 주요 기능
- **자동 로그인**: Playwright를 사용해 `toon.at` 스트리머 대시보드에 로그인합니다.
- **후원 목록 수집**: 투네이션 내부 API(`dapi/streamer/donation_list`)를 호출하여 지정 기간(기본 2016-01-01부터 오늘까지)의 후원 내역을 페이지네이션하며 수집합니다.
- **Webhook 전송**: 누적된 후원 아이템 배열을 Webhook URL로 POST 전송합니다.
- **페이지 탐색 제어**: Webhook이 404 응답으로 `not-found-last-donation`을 반환하면 다음 페이지를 추가로 탐색합니다.

## 동작 개요
1. Playwright Chromium 컨텍스트를 한국어 로케일(`ko-KR`)로 생성합니다.
2. 로그인 페이지에서 아이디/비밀번호를 입력해 대시보드로 이동합니다.
3. 페이지 컨텍스트에서 `fetch(https://toon.at/dapi/streamer/donation_list?from&to&page)`로 데이터를 조회합니다.
4. 응답 리스트를 아래 스키마로 변환합니다.
5. Webhook으로 POST 요청을 전송합니다. 404 + `not-found-last-donation`이면 다음 페이지를 재귀적으로 조회합니다.

## 요구 사항
- Deno 설치
- 네트워크로 `toon.at` 및 Webhook 도메인 접근 가능
- 첫 실행 시 Playwright가 브라우저를 다운로드할 수 있는 환경

## 설치 및 실행
1) 저장소 클론 후 `.env` 파일을 준비합니다.

```bash
cp .env.example .env # 예시 파일이 없으면 아래 예시를 참고해 직접 생성
```

2) 스크립트 실행

```bash
deno task start
# 또는 파일 변경 감지 모드
deno task dev
```

`deno.json`에 설정된 태스크는 `.env`를 자동으로 로드합니다.

## 환경 변수
- **TOONATION_ID**: 투네이션 스트리머 계정 아이디
- **TOONATION_PASSWORD**: 투네이션 스트리머 계정 비밀번호
- **WEBHOOK_URL**: 후원 데이터 배열을 수신할 Webhook 엔드포인트 URL
- **WEBHOOK_SECRET**: 요청 헤더 `X-Webhook-Secret`에 포함될 비밀값

`.env` 예시:

```bash
TOONATION_ID=your_toonation_id
TOONATION_PASSWORD=your_toonation_password
WEBHOOK_URL=https://your.service.example.com/toonation/webhook
WEBHOOK_SECRET=your_webhook_secret
```

## Webhook
- **HTTP 메서드**: `POST`
- **헤더**:
  - `Content-Type: application/json`
  - `X-Webhook-Secret: <WEBHOOK_SECRET>`
- **본문(payload)**: `ToonationDonationItem[]` 배열

`ToonationDonationItem` 타입:

```typescript
interface ToonationDonationItem {
  account: string;
  nickname: string;
  amount: number;
  message: string;
  createdAt: string;
}
```

예시 페이로드:

```json
[
  {
    "account": "acc123",
    "nickname": "닉네임",
    "amount": 5000,
    "message": "응원합니다!",
    "createdAt": "2024-05-10T09:15:27.123Z"
  }
]
```

응답 요구사항:
- 정상 처리 시 2xx를 반환하십시오.
- 추가 페이지 탐색이 필요하면 `404` 상태 코드와 본문 텍스트로 정확히 `not-found-last-donation`을 반환하십시오. 그러면 스크립트가 다음 페이지를 조회합니다.

## 스케줄 실행(GitHub Actions)
이 프로젝트는 GitHub Actions 워크플로우로 스케줄 실행됩니다. 설정은 `.github/workflows/cron.yml` 에 정의되어 있습니다.

- 스케줄:
  - `0 0-14 * * *` (KST 09:00 ~ 23:00, 매 시 정각)
  - `0 15-18 * * *` (KST 00:00 ~ 03:00, 매 시 정각)
- 수동 실행: `workflow_dispatch` 지원

필수 리포지토리 시크릿:
- `TOONATION_ID`
- `TOONATION_PASSWORD`
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`

워크플로우 요약:

```yaml
name: Cron
on:
  schedule:
    - cron: '0 0-14 * * *' # KST 09:00 ~ 23:00
    - cron: '0 15-18 * * *' # KST 00:00 ~ 03:00
  workflow_dispatch:

jobs:
  cron:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2

      - name: Setup Deno
        uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      
      - name: Install Playwright
        run: deno run -A playwright install chromium --only-shell
      
      - name: Run main.ts
        run: deno -A main.ts
        env:
          TOONATION_ID: ${{ secrets.TOONATION_ID }}
          TOONATION_PASSWORD: ${{ secrets.TOONATION_PASSWORD }}
          WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}
          WEBHOOK_SECRET: ${{ secrets.WEBHOOK_SECRET }}
```

## 프로젝트 구조

```text
./
  ├── main.ts          # 진입점: 로그인, 수집, Webhook 전송
  ├── toonation.ts     # 목록 조회 로직(page.evaluate, from/to/page)
  ├── utils.ts         # .NET ticks → ISO 문자열 변환 및 매핑
  ├── types.ts         # 타입 정의(ToonationDonationItem 등)
  ├── config.ts        # 환경 변수 로드 및 검증
  ├── deno.json        # 태스크/포맷/린트/임포트 매핑
  └── deno.lock        # 종속성 잠금 파일
```

## 포맷/린트
- `deno fmt` 설정: `singleQuote: true`
- `deno lint` 규칙 일부 비활성화: `no-explicit-any`

## 트러블슈팅
- **로그인 실패**: `TOONATION_ID`, `TOONATION_PASSWORD`를 확인하세요. 캡차/2단계 인증이 필요한 계정은 지원하지 않을 수 있습니다.
- **브라우저 다운로드 실패**: 네트워크/권한 문제로 Playwright가 Chromium을 받지 못할 수 있습니다. 재시도하거나 네트워크 정책을 확인하세요.
- **Webhook 401/403**: `X-Webhook-Secret` 불일치일 수 있습니다. Webhook 서버와 Repository의 Secret 값을 일치시키세요.
- **404 반환 후 스크립트 종료**: Webhook이 본문으로 `not-found-last-donation` 외 다른 문자열을 반환하면 스크립트가 에러로 간주합니다. 처리 로직을 점검하세요.
