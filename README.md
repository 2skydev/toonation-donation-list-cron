# 투네이션 후원 목록 자동 조회 크론 (CloakBrowser 크롤링)

투네이션 스트리머 계정의 후원 내역을 수집해 지정한 Webhook으로 전달하는 Deno 스크립트입니다. 크론 환경에서 주기적으로 실행하도록 설계되었습니다.

<img width="1338" height="800" alt="image" src="https://github.com/user-attachments/assets/ee4df2ce-5a95-47c1-a615-43a963b1b972" />

## 주요 기능

- **로그인 세션 재사용**: CloakBrowser의 영구 브라우저 프로필로 대시보드에 먼저 접근하고, 로그인 페이지로 이동한 경우에만 로그인합니다.
- **프록시 연결**: 브라우저는 `socks5://127.0.0.1:1080`을 사용하며, GitHub Actions에서는 NetBird가 프록시를 제공합니다.
- **후원 목록 수집**: 투네이션 내부 API(`dapi/streamer/donation_list`)를 호출하여 지정 기간(기본 2016-01-01부터 오늘까지)의 후원 내역을 페이지네이션하며 수집합니다.
- **Webhook 전송**: 누적된 후원 아이템 배열을 Webhook URL로 POST 전송합니다.
- **페이지 탐색 제어**: Webhook이 404 응답으로 `not-found-last-donation`을 반환하면 다음 페이지를 추가로 탐색합니다.

## 동작 개요

1. CloakBrowser의 `launchPersistentContext()`로 `.cache/toonation-profile` 프로필을 엽니다. 한국어 로케일(`ko-KR`), 서울 시간대(`Asia/Seoul`), `humanize: true`, `headless: false`를 사용합니다.
2. `https://toon.at/streamer/dashboard`로 이동하고 로그인 입력창 또는 대시보드 헤더가 표시될 때까지 기다립니다. 로그인 페이지라면 아이디/비밀번호를 입력하고, `로그인 상태 유지`가 꺼져 있을 때 라벨을 클릭한 뒤 로그인합니다.
3. 대시보드 헤더가 표시되면 페이지 컨텍스트에서 `fetch(https://toon.at/dapi/streamer/donation_list?from&to&page)`로 데이터를 조회합니다. 화면 표시 대기 시간은 최대 10초입니다.
4. 응답 리스트를 아래 스키마로 변환합니다.
5. Webhook으로 POST 요청을 전송합니다. 404 + `not-found-last-donation`이면 다음 페이지를 재귀적으로 조회합니다.

## 요구 사항

- Deno 설치(GitHub Actions에서는 `2.7.11` 사용)
- 첫 실행 시 의존성과 CloakBrowser 브라우저를 다운로드할 수 있는 네트워크 및 쓰기 권한
- `127.0.0.1:1080`에서 실행 중이며 `toon.at`에 연결할 수 있는 SOCKS5 프록시
- Deno 실행 환경에서 Webhook 도메인 접근 가능(Webhook 요청은 브라우저 컨텍스트 외부에서 전송)
- 현재 `headless: false` 설정으로 브라우저를 실행할 수 있는 환경

## 설치 및 실행
1) 저장소 클론 후 아래 환경 변수 예시를 참고해 프로젝트 루트에 `.env` 파일을 생성합니다.

2) 의존성과 브라우저를 준비합니다.

```bash
deno install --frozen
deno eval --frozen 'import { ensureBinary } from "cloakbrowser"; console.log(await ensureBinary());'
```

`deno.json`에는 `cloakbrowser@0.5.10`과 페이지 타입에 사용하는 `playwright-core@1.55.0`이 지정되어 있습니다. 브라우저는 CloakBrowser의 `ensureBinary()`로 준비합니다.

3) 로컬에서 SOCKS5 프록시를 먼저 실행합니다. `deno task start`는 NetBird를 자동으로 시작하지 않습니다. 프록시 없이 실행하려면 `main.ts`의 `proxy` 설정을 제거해야 합니다.

4) 스크립트를 실행합니다.

```bash
deno task start
# 또는 파일 변경 감지 모드
deno task dev
```

`deno.json`에 설정된 태스크는 `.env`를 자동으로 로드합니다. 브라우저 프로필은 `.cache/toonation-profile`에 저장되며, 다음 실행에서 재사용합니다. 세션이 만료되어 로그인 페이지로 이동하면 다시 로그인합니다.

## 환경 변수

- **TOONATION_ID**: 투네이션 스트리머 계정 아이디
- **TOONATION_PASSWORD**: 투네이션 스트리머 계정 비밀번호
- **WEBHOOK_URL**: 후원 데이터 배열을 수신할 Webhook 엔드포인트 URL
- **WEBHOOK_SECRET**: 웹훅 서명(HMAC-SHA256) 생성/검증에 사용할 비밀값

GitHub Actions에서는 NetBird 연결용 리포지토리 시크릿 **NETBIRD_SETUP_KEY**도 필요합니다. 워크플로가 이를 `NB_SETUP_KEY`로 전달하며, 로컬 Deno 스크립트의 필수 환경 변수는 아닙니다.

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

실제 설정은 [`.github/workflows/cron.yml`](.github/workflows/cron.yml)에 정의되어 있습니다.

- 실행 환경: `windows-2025`, Deno `2.7.11`
- 기본 셸: Bash. NetBird 설치와 크롤링 단계는 `shell: pwsh`로 PowerShell 사용
- 스케줄(UTC cron 기준):
  - `0 0-14 * * *`: KST 09:00 ~ 23:00, 매 시 정각
  - `0 15-18 * * *`: KST 00:00 ~ 03:00, 매 시 정각
- 수동 실행: `workflow_dispatch` 지원

필수 리포지토리 시크릿:

- `TOONATION_ID`
- `TOONATION_PASSWORD`
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`
- `NETBIRD_SETUP_KEY`

워크플로 실행 순서:

1. 저장소 체크아웃 및 Deno 설치 후 `deno install --frozen`으로 의존성을 준비합니다.
2. `binaryInfo()`로 브라우저 버전과 캐시 경로를 확인하고 캐시를 복원합니다. `ensureBinary()`로 누락된 브라우저를 다운로드한 뒤 실행 여부를 검사합니다.
3. NetBird `0.79.0`의 Windows 실행 파일을 다운로드하고 릴리스 체크섬과 SHA-256을 대조한 뒤 압축을 해제합니다.
4. `.cache/toonation-profile` 브라우저 프로필 캐시를 복원합니다.
5. **하나의 PowerShell 단계**에서 NetBird 시작, 연결 확인, SOCKS5 통신 검사, `deno run --frozen -A main.ts`를 순서대로 실행합니다. 단계 제한 시간은 크롤링을 포함해 10분입니다.
6. `finally`에서 NetBird 프로세스를 종료합니다. 작업이 성공하면 캐시 액션이 브라우저 프로필을 저장합니다.

### NetBird 프록시

NetBird는 `service run`으로 실행하며 `NB_USE_NETSTACK_MODE=true`로 사용자 공간 네트워크 스택과 SOCKS5 프록시를 사용합니다. 브라우저와 프록시 모두 `127.0.0.1:1080`을 사용합니다.

- 데몬 시작 확인: 최대 10회, 실패 시 1초 대기
- 연결 준비 및 프록시 포트 확인: 최대 10회, 실패 시 2초 대기
- 실제 통신 확인: `curl.exe`로 SOCKS5 프록시를 통해 대시보드 요청. 연결 제한 10초, 전체 요청 제한 30초

반복 확인의 총 소요 시간에는 각 상태 확인 명령의 실행 시간도 포함됩니다. 프록시 검사는 HTTP 상태 코드를 출력하며, 연결이나 전송 오류로 curl이 실패하면 크롤링을 진행하지 않습니다.

NetBird와 크롤링을 같은 단계에 두어 단계 전환 중 NetBird가 종료되는 문제를 피합니다. NetBird 실행 로그는 러너 임시 디렉토리의 `netbird/client.log`, `netbird/service.log`, `netbird/service-error.log`에 기록됩니다.

### 캐시

| 대상 | 경로 | 캐시 구분 기준 |
| --- | --- | --- |
| CloakBrowser 브라우저 | `.cache/cloakbrowser` 아래 `binaryInfo().cacheDir` | Windows 이미지, 아키텍처, 브라우저 버전, `deno.lock` 해시 |
| 브라우저 프로필 | `.cache/toonation-profile` | Windows 이미지, 아키텍처, 브라우저 버전, 실행 ID와 재시도 번호 |

브라우저는 `CLOAKBROWSER_AUTO_UPDATE=false`로 자동 업데이트를 끄고, 확인된 버전을 `CLOAKBROWSER_VERSION`으로 지정해 실행합니다. 프로필은 같은 환경·브라우저 버전의 캐시를 복원하고, 성공한 실행마다 새 키로 저장해 갱신합니다. 캐시가 없거나 로그인 세션이 만료된 경우에는 다시 로그인합니다. `.cache/`는 Git 추적에서 제외됩니다.

## 프로젝트 구조

```text
./
  ├── .github/workflows/cron.yml # Windows 스케줄 실행, NetBird, 캐시
  ├── main.ts          # 진입점: 세션 재사용, 로그인, 수집, Webhook 전송
  ├── toonation.ts     # 목록 조회 로직(page.evaluate, from/to/page)
  ├── webhook.ts       # HMAC 서명 생성 및 Webhook 전송
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
- **브라우저 다운로드 실패**: CloakBrowser 다운로드 서버에 대한 네트워크 접근과 캐시 디렉토리 쓰기 권한을 확인하세요. `ensureBinary()` 명령으로 다운로드를 다시 시도할 수 있습니다.
- **`ERR_PROXY_CONNECTION_FAILED`**: `127.0.0.1:1080` 프록시가 실행 중인지 확인하세요. Actions에서는 `Run main.ts with NetBird` 단계의 연결 확인 및 curl 오류를 확인하세요.
- **화면 표시 대기 시간 초과**: 현재 로그인 입력창 또는 대시보드 헤더를 최대 10초 기다립니다. 프록시 연결 상태, 로그인 리다이렉트, 화면 구조 변경 여부를 확인하세요.
- **Webhook 401/403**: `X-Signature-*` 검증 실패일 수 있습니다. `WEBHOOK_SECRET`, raw body 사용 여부, 타임스탬프 허용 범위를 확인하세요.
- **404 반환 후 스크립트 종료**: Webhook이 본문으로 `not-found-last-donation` 외 다른 문자열을 반환하면 스크립트가 에러로 간주합니다. 처리 로직을 점검하세요.
