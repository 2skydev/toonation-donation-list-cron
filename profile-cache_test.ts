import {
  profileCacheKey,
  restoreProfile,
  saveProfile,
} from './profile-cache.ts';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const rejects = async (action: () => Promise<unknown>) => {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert(rejected, '실패해야 하는 작업이 성공했습니다.');
};

Deno.test('프로필 전체를 암호화하고 다른 디렉터리에 손실 없이 복원한다', async () => {
  const root = await Deno.makeTempDir();

  try {
    const original = `${root}/original`;
    const restored = `${root}/restored`;
    const archive = `${root}/cache/profile.enc`;
    const { key } = await profileCacheKey('01'.repeat(32));
    const files = {
      'Local State': '{"portable":true}',
      'Default/Network/Cookies': 'fixture-cookie-database',
      'Default/Sessions/Session_1': 'fixture-restored-tab',
    };

    await Deno.mkdir(`${original}/Default/Network`, { recursive: true });
    await Deno.mkdir(`${original}/Default/Sessions`, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      await Deno.writeTextFile(`${original}/${path}`, content);
    }

    await saveProfile(key, original, archive);
    const first = await Deno.readFile(archive);
    assert(
      !new TextDecoder().decode(first).includes('fixture-cookie-database'),
      '캐시에 프로필 원문이 노출됐습니다.',
    );
    await saveProfile(key, original, archive);
    const second = await Deno.readFile(archive);
    assert(
      !first.every((byte, index) => byte === second[index]),
      '암호화할 때마다 새로운 nonce를 사용해야 합니다.',
    );

    await Deno.remove(original, { recursive: true });
    await restoreProfile(key, restored, archive);
    for (const [path, content] of Object.entries(files)) {
      assert(
        await Deno.readTextFile(`${restored}/${path}`) === content,
        `${path} 복원 실패`,
      );
    }
    assert(
      [...Deno.readDirSync(`${root}/cache`)].length === 1,
      '캐시에는 암호화 파일 하나만 있어야 합니다.',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('잘못된 키와 변조된 캐시는 프로필을 풀기 전에 거부한다', async () => {
  const root = await Deno.makeTempDir();

  try {
    const original = `${root}/original`;
    const restored = `${root}/restored`;
    const archive = `${root}/profile.enc`;
    const { key, id } = await profileCacheKey('01'.repeat(32));
    const other = await profileCacheKey('02'.repeat(32));
    assert(id !== other.id, '키 교체 시 다른 캐시를 사용해야 합니다.');
    await Deno.mkdir(original);
    await Deno.writeTextFile(`${original}/Local State`, 'fixture');
    await saveProfile(key, original, archive);

    await rejects(() => restoreProfile(other.key, restored, archive));
    const encrypted = await Deno.readFile(archive);
    encrypted[encrypted.length - 1] ^= 1;
    await Deno.writeFile(archive, encrypted);
    await rejects(() => restoreProfile(key, restored, archive));
    await rejects(() => Deno.stat(restored));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('캐시가 없으면 새 프로필로 시작하고 유효하지 않은 키는 거부한다', async () => {
  const root = await Deno.makeTempDir();

  try {
    const { key } = await profileCacheKey('01'.repeat(32));
    await restoreProfile(key, `${root}/profile`, `${root}/missing.enc`);
    await rejects(() => profileCacheKey(undefined));
    await rejects(() => profileCacheKey('short'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
