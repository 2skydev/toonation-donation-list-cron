# 투네이션 후원 목록 자동 조회 크론 (playwright 크롤링)

투네이션 스트리머 계정의 후원 내역을 수집해 지정한 Webhook으로 전달하는 Deno 스크립트입니다. 크론 환경에서 주기적으로 실행하도록 설계되었습니다.

<img width="1338" height="800" alt="image" src="https://github.com/user-attachments/assets/ee4df2ce-5a95-47c1-a615-43a963b1b972" />

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
- **WEBHOOK_SECRET**: 웹훅 서명(HMAC-SHA256) 생성/검증에 사용할 비밀값

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
  - `X-Signature-Timestamp: <unix timestamp seconds>`
  - `X-Signature-Sha256: <hex hmac sha256>`
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

## Webhook 수신 서버 서명 검증 가이드
수신 서버는 아래 순서대로 서명을 검증하면 됩니다.

1. 요청의 raw body 문자열을 그대로 읽습니다.
2. 헤더 `X-Signature-Timestamp`, `X-Signature-Sha256`가 모두 존재하는지 확인합니다.
3. `X-Signature-Timestamp`를 정수로 파싱하고, 현재 시각과의 차이가 허용 범위(예: 300초) 이내인지 확인합니다.
4. `expected = HMAC_SHA256_HEX(WEBHOOK_SECRET, timestamp + rawBody)`를 계산합니다.
5. 수신한 `X-Signature-Sha256`와 constant-time 비교로 일치 여부를 확인합니다.
6. 통과 후에만 raw body를 JSON으로 파싱해 비즈니스 로직을 수행합니다.

### Node.js(Express) 예시
```typescript
import crypto from 'node:crypto';
import express from 'express';

const app = express();

// 반드시 raw body가 필요합니다.
app.use('/toonation/webhook', express.text({ type: 'application/json' }));

const SKEW_SECONDS = 300;
const SECRET = process.env.WEBHOOK_SECRET!;

app.post('/toonation/webhook', (req, res) => {
  const rawBody = req.body as string;
  const timestamp = req.header('X-Signature-Timestamp');
  const signature = req.header('X-Signature-Sha256');

  if (!timestamp || !signature) {
    return res.status(401).send('missing-signature-headers');
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return res.status(401).send('invalid-timestamp');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SKEW_SECONDS) {
    return res.status(401).send('timestamp-out-of-range');
  }

  const expectedHex = crypto
    .createHmac('sha256', SECRET)
    .update(`${ts}${rawBody}`, 'utf8')
    .digest('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(signature, 'hex');

  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    return res.status(401).send('invalid-signature');
  }

  const payload = JSON.parse(rawBody);
  // TODO: payload 처리
  return res.status(200).send('ok');
});
```

참고:
- JSON 파서를 먼저 붙이면 raw body가 바뀌어 서명 검증에 실패할 수 있습니다. 반드시 raw body 기준으로 검증하세요.
- `WEBHOOK_SECRET`은 GitHub Actions의 비밀 변수와 수신 서버가 동일해야 합니다.

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
- **Webhook 401/403**: `X-Signature-*` 검증 실패일 수 있습니다. `WEBHOOK_SECRET`, raw body 사용 여부, 타임스탬프 허용 범위를 확인하세요.
- **404 반환 후 스크립트 종료**: Webhook이 본문으로 `not-found-last-donation` 외 다른 문자열을 반환하면 스크립트가 에러로 간주합니다. 처리 로직을 점검하세요.
