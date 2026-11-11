import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLocalVideo,localVideoPatch} from '../../../plugins/video/asr/local.mjs';
import {app} from './helpers.mjs';

const local={port:8766,token:'test-local-asr-token-with-at-least-32-characters'};
test('local ASR setup configures and enables a new video plugin only for authenticated web use',async t=>{
  const bot=await app(t),result=await applyLocalVideo(bot.plugins,local),plugin=bot.plugins.get(result.id);
  assert.equal(plugin.enabled,true);assert.equal(plugin.config.asr_model,'sensevoice-small-int8');assert.equal(plugin.config.asr_api_key,local.token);
  assert.equal(plugin.config.asr_url,'http://127.0.0.1:8766/v1/audio/transcriptions');assert.equal(plugin.config.asr_format,'verbose_json');
  assert.deepEqual(plugin.scope.private_users,[]);assert.deepEqual(plugin.scope.groups,[]);assert.equal(plugin.scope.all_private,false);assert.equal(plugin.scope.all_groups,false);
  assert.ok(!JSON.stringify(result).includes(local.token));
});
test('local ASR setup preserves existing plugin scope, enabled state and unrelated video settings',async t=>{
  const bot=await app(t);let plugin=await bot.plugins.install({kind:'video-analysis'});
  plugin=await bot.plugins.save({id:plugin.id,revision:plugin.revision,plugin:{...plugin,scope:{...plugin.scope,private_users:['10001']},config:{...plugin.config,max_frames:2,allowed_roots:['./custom-video']}}});
  const result=await applyLocalVideo(bot.plugins,local),saved=bot.plugins.get(result.id);
  assert.equal(saved.id,plugin.id);assert.equal(saved.enabled,false);assert.equal(saved.config.max_frames,2);assert.deepEqual(saved.config.allowed_roots,['./custom-video']);assert.deepEqual(saved.scope,plugin.scope);
  assert.equal(saved.config.asr_language,'auto');assert.equal(localVideoPatch(local).asr_timeout_seconds,120);
});
