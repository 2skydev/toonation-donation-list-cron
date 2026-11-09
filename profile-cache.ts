import { dirname } from 'node:path';

const PROFILE_DIR = './.cache/toonation-profile-portable';
const ARCHIVE_PATH = './.cache/toonation-profile.enc';
const HEADER = new TextEncoder().encode('TOONATION_PROFILE_V1\n');
const NONCE_LENGTH = 12;

export const profileCacheKey = async (secret: string | undefined) => {
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error('BROWSER_PROFILE_KEY에 64자리 16진수 키를 설정해주세요.');
  }

  const bytes = Uint8Array.from(
    secret.match(/../g)!,
    (hex) => parseInt(hex, 16),
  );
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  bytes.fill(0);

  return {
    key,
    id: Array.from(
      hash.slice(0, 8),
      (byte) => byte.toString(16).padStart(2, '0'),
    )
      .join(''),
  };
};

const tar = async (args: string[]) => {
  const result = await new Deno.Command('tar', {
    args,
    stdout: 'null',
    stderr: 'piped',
  }).output();

  if (!result.success) {
    throw new Error('브라우저 프로필 압축 또는 복원에 실패했습니다.');
  }
};

export const saveProfile = async (
  key: CryptoKey,
  profileDir = PROFILE_DIR,
  archivePath = ARCHIVE_PATH,
) => {
  const temporaryDir = await Deno.makeTempDir({ prefix: 'toonation-profile-' });

  try {
    const archive = `${temporaryDir}/profile.tar.gz`;
    await tar(['-czf', archive, '-C', profileDir, '.']);
    const plaintext = await Deno.readFile(archive);
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: HEADER,
        },
        key,
        plaintext,
      ),
    );
    plaintext.fill(0);

    const encrypted = new Uint8Array(
      HEADER.length + nonce.length + ciphertext.length,
    );
    encrypted.set(HEADER);
    encrypted.set(nonce, HEADER.length);
    encrypted.set(ciphertext, HEADER.length + nonce.length);

    await Deno.mkdir(dirname(archivePath), { recursive: true });
    await Deno.writeFile(archivePath, encrypted);
    console.info('브라우저 프로필 전체를 암호화했습니다.');
  } finally {
    await Deno.remove(temporaryDir, { recursive: true });
  }
};

export const restoreProfile = async (
  key: CryptoKey,
  profileDir = PROFILE_DIR,
  archivePath = ARCHIVE_PATH,
) => {
  const encrypted = await Deno.readFile(archivePath).catch((error) => {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  });

  if (!encrypted) {
    console.info('저장된 포터블 프로필이 없어 새 프로필로 시작합니다.');
    return;
  }

  if (
    encrypted.length < HEADER.length + NONCE_LENGTH + 16 ||
    !HEADER.every((byte, index) => encrypted[index] === byte)
  ) {
    throw new Error('암호화된 프로필 파일 형식이 올바르지 않습니다.');
  }

  // 인증 태그 검증에 실패하면 프로필을 풀거나 재로그인으로 우회하지 않습니다.
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encrypted.slice(HEADER.length, HEADER.length + NONCE_LENGTH),
        additionalData: HEADER,
      },
      key,
      encrypted.slice(HEADER.length + NONCE_LENGTH),
    ),
  );
  const temporaryDir = await Deno.makeTempDir({ prefix: 'toonation-profile-' });

  try {
    const archive = `${temporaryDir}/profile.tar.gz`;
    await Deno.writeFile(archive, plaintext);
    plaintext.fill(0);
    await Deno.mkdir(profileDir, { recursive: true });
    await tar(['-xzf', archive, '-C', profileDir]);
    console.info('암호화된 브라우저 프로필 전체를 복원했습니다.');
  } finally {
    plaintext.fill(0);
    await Deno.remove(temporaryDir, { recursive: true });
  }
};

if (import.meta.main) {
  const { key } = await profileCacheKey(Deno.env.get('BROWSER_PROFILE_KEY'));
  const [action] = Deno.args;

  if (action === 'restore') {
    await restoreProfile(key);
  } else if (action === 'save') {
    await saveProfile(key);
  } else {
    throw new Error('사용법: deno run -A profile-cache.ts restore|save');
  }
}
