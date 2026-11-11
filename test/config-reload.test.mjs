import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, applyConfig, environmentOf } from '../src/config.mjs';
import { Settings } from '../src/settings.mjs';

function base(extra = {}) {
  return {
    SESSION_KEY: 'a'.repeat(64),
    ONEBOT_ACCESS_TOKEN: 'b'.repeat(32),
    ADMIN_ACCESS_TOKEN: 'c'.repeat(32),
    REVERSE_WS_TOKEN: 'd'.repeat(32),
    AI_ENABLED: 'true', AI_MODEL: 'model-a', AI_ALLOWED_USERS: '10001',
    BOT_ADMIN_IDS: '10001',
    ...extra
  };
}

test('runtime fields apply in place and keep the objects services already hold', () => {
  const config = loadConfig(base());
  const ai = config.ai, admins = config.adminIds, allowed = config.ai.allowedUsers;
  const result = applyConfig(config, { ...environmentOf(config), AI_MODEL: 'model-b', AI_SYSTEM_PROMPT: '新人格', BOT_ADMIN_IDS: '10001,10002' });
  assert.deepEqual(result.restart_required, []);
  assert.equal(result.applied.includes('AI_MODEL'), true);
  assert.equal(config.ai.model, 'model-b');
  assert.equal(config.ai.systemPrompt, '新人格');
  // 引用不变，AIClient / isChatAdmin 才能看到新值。
  assert.equal(config.ai, ai);
  assert.equal(config.adminIds, admins);
  assert.equal(config.ai.allowedUsers, allowed);
  assert.deepEqual([...config.adminIds], ['10001', '10002']);
});

test('startup-only keys keep the running value and wait for a restart', () => {
  const config = loadConfig(base());
  const result = applyConfig(config, { ...environmentOf(config), PORT: '5999', AI_MODEL: 'model-b' });
  assert.equal(result.restart_required.includes('PORT'), true);
  assert.equal(result.applied.includes('AI_MODEL'), true);
  assert.equal(config.port, 5700);
  assert.equal(config.ai.model, 'model-b');
  // 下一次保存仍应把 PORT 视为未生效，界面据此显示“等待重启”。
  assert.equal(environmentOf(config).PORT, undefined);
});

test('AI allowlists and group rules are replaced without breaking the config shape', () => {
  const config = loadConfig(base({ AI_GROUP_REQUIRE_AT: 'true', GROUP_BLOCKED_USERS: '88888:10002' }));
  const before = config.ai.allowedUsers;
  const result = applyConfig(config, { ...environmentOf(config), AI_ALLOWED_USERS: '10003,10004', GROUP_BLOCKED_USERS: '88888:10005,*:10006', AI_GROUP_REQUIRE_AT: 'false' });
  assert.equal(result.restart_required.length, 0);
  assert.equal(config.ai.allowedUsers, before);
  assert.deepEqual([...config.ai.allowedUsers], ['10003', '10004']);
  assert.equal(config.ai.requireAt, false);
  assert.equal(config.blockedGroupUsers.get('*').has('10006'), true);
});

test('an invalid hot value is rejected before anything is applied', () => {
  const config = loadConfig(base());
  const snapshot = JSON.stringify({ ...config, adminIds: [...config.adminIds] });
  assert.throws(() => applyConfig(config, { ...environmentOf(config), AI_BASE_URL: 'not-a-url' }));
  assert.equal(JSON.stringify({ ...config, adminIds: [...config.adminIds] }), snapshot);
});

test('saving from the settings page applies hot keys and leaves the rest pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'config-reload-'));
  const path = join(directory, '.env');
  const env = base();
  await writeFile(path, Object.entries(env).map(([key, value]) => key + '=' + value).join('\n'));
  const config = loadConfig(env);
  const settings = new Settings(config, { path });
  const before = await settings.snapshot();
  assert.deepEqual(before.pending, []);

  await settings.save({ AI_MODEL: 'model-b', PORT: '5999' }, before.revision);
  const values = await settings.environment();
  const result = applyConfig(config, values, ['AI_MODEL', 'PORT']);
  settings.adopt(values, result.applied);
  const after = await settings.snapshot();

  assert.equal(config.ai.model, 'model-b');
  assert.equal(config.port, 5700);
  assert.deepEqual(result.applied, ['AI_MODEL']);
  assert.deepEqual(result.restart_required, ['PORT']);
  // 界面据此只提示 PORT 需要重启。
  assert.deepEqual(after.pending, ['PORT']);
});
