import { join } from 'node:path';
import { lockData } from './data-lock.mjs';
import { Store } from './store.mjs';
import { SessionVault } from './qq/session-vault.mjs';
import { loadDriver } from './qq/driver.mjs';
import { QQAdapter } from './qq/adapter.mjs';
import { AIClient } from './ai.mjs';
import { ReplyWorker } from './worker.mjs';
import { OneBotServer } from './onebot.mjs';
import { createLogger } from './logger.mjs';
import { MessageIdMap } from './qq/message-ids.mjs';
import { Settings } from './settings.mjs';
import { applyConfig } from './config.mjs';
import { Telemetry } from './telemetry.mjs';
import { QzoneService } from './qzone/service.mjs';
import { describeDriverFault } from './qq/faults.mjs';
import { PluginService } from './plugins/service.mjs';
import { AgentRuntime } from './agent/runtime.mjs';
import { AttachmentService } from './attachments/service.mjs';
import { GroupContext } from './group-context.mjs';

export async function createApp(config, overrides = {}) {
  const telemetry = overrides.telemetry || new Telemetry();
  const sink = overrides.log || createLogger();
  const sanitize = createLogger(line => {
    const { time, level, event, ...fields } = JSON.parse(line);
    telemetry.add('log', { level, event, fields });
  });
  const log = (level, event, fields) => { sanitize(level, event, fields); sink(level, event, fields); };
  const settings = new Settings(config, { path:overrides.settingsPath, lockedKeys:overrides.lockedKeys });
  // 保存配置后先尝试热应用：服务都持同一个 config 引用，就地合并即可读到新值。
  // 启动项（端口、凭据、驱动、内核路径、队列并发等）保持旧值，仍由“重启生效”处理。
  const reloadSettings = async changedKeys => {
    const values = await settings.environment();
    const result = applyConfig(config, values, changedKeys);
    settings.adopt(values, result.applied);
    return result;
  };
  const unlock = lockData(config.dataDir);
  let store, adapter, worker, server, qzone, plugins, memes, voicestudio,groupChatPlus,livingMemory,emotion,video,android,douyinWeb;
  try {
    store = new Store(join(config.dataDir, 'bot.sqlite'),{retainIgnoredContent:config.retainIgnoredContent,
      onRedaction:fields=>log('info','ignored_job_content_redacted',fields)});
    const vault = new SessionVault(join(config.dataDir, 'sessions'), config.sessionKey);
    const ids = new MessageIdMap(store.db);
    const driver = overrides.driver || await loadDriver(config, vault, log, ids);
    adapter = new QQAdapter(driver, config);
    const groupContext=new GroupContext({store,config});
    const observe=event=>{telemetry.message(event);try{groupContext.observe(event);groupChatPlus?.observe(event);}catch{log('warn','group_context_failed');}};
    adapter.on('event', observe);
    adapter.on('outgoing', observe);
    adapter.on('state', () => log('info', 'qq_connection_changed', { state:adapter.status().online ? 'online' : 'offline' }));
    adapter.on('fault', error => log('warn', 'qq_driver_fault', describeDriverFault(error)));
    const ai = overrides.ai || new AIClient(config.ai);
    const attachments = new AttachmentService({store,adapter,config});
    // Plugin packages live in plugins/ and are loaded by the registry; src/
    // holds no plugin implementation. Services are created on first use.
    plugins = new PluginService({ store, adapter, log, config, retentionDays: config.retentionDays, ai, attachments, groupContext, overrides });
    await plugins.start({ dir: overrides.pluginDir });
    memes = plugins.service('meme-manager');
    voicestudio = plugins.service('voicestudio');
    groupChatPlus = plugins.service('group-chat-plus');
    livingMemory = plugins.service('living-memory');
    emotion = plugins.service('psychodynamic-emotion');
    video = plugins.service('video-analysis');
    android = plugins.service('android-device');
    douyinWeb = plugins.service('douyin-web');
    qzone = new QzoneService({ store, config, log, transport: overrides.qzoneTransport, ai: overrides.qzoneAI });
    const agent = new AgentRuntime({ ai, store, config, log, plugins, memes, voicestudio, qzone, adapter, attachments,groupChatPlus,livingMemory,video,android,douyinWeb });
    if(livingMemory){livingMemory.personaFor=session=>agent.state.persona(session)?.id||'';livingMemory.personaDetailsFor=session=>agent.state.persona(session);}
    if(emotion)emotion.personaFor=session=>agent.state.persona(session)?.id||'';
    worker = new ReplyWorker({ adapter, store, ai:agent, config, log, memes, voicestudio, attachments, groupContext,groupChatPlus,livingMemory,emotion,douyinWeb });
    server = new OneBotServer({ adapter, worker, store, config, log, telemetry, settings, qzone, plugins, memes, voicestudio, agent, reload: reloadSettings });
    // QR login may still be pending, but a broken driver must fail startup.
    await adapter.start();
    await server.start();
    store.cleanup(config.retentionDays, config.uncertainRetentionDays, config.jobMaxAge);
    agent.state.cleanup(config.retentionDays);
    emotion?.cleanup();
    await attachments.cleanup();
    await video?.cleanup();
    worker.start();
    agent.freeActivity?.start(agent);
    groupChatPlus?.start();
    douyinWeb?.autoChat.start(agent);
    douyinWeb?.browsing.start(agent);
    log('info', 'service_started', { port:server.server.address().port, driver:config.driver });
    const cleanup = setInterval(() => {
      try { store.cleanup(config.retentionDays, config.uncertainRetentionDays, config.jobMaxAge); groupContext.cleanup(); agent.state.cleanup(config.retentionDays); qzone.cleanup(); plugins.cleanup(); livingMemory?.cleanup(); emotion?.cleanup(); memes?.cleanup(); voicestudio?.cleanup().catch(()=>log('error','retention_cleanup_failed')); attachments.cleanup().catch(()=>log('error','retention_cleanup_failed')); video?.cleanup().catch(()=>log('error','retention_cleanup_failed')); } catch { log('error', 'retention_cleanup_failed'); }
    }, 3600000);
    let closing;
    return { config, adapter, store, worker, server, telemetry, settings, qzone, plugins, memes, voicestudio, agent, attachments, groupContext,groupChatPlus,livingMemory,emotion,video,android,douyinWeb, address: server.server.address(), reloadSettings,
      close() {
        if (!closing) closing = (async () => {
          clearInterval(cleanup);
          agent.freeActivity?.close();
          agent.computer.controller.abort(Error('服务正在关闭。'));
          android?.cancel();douyinWeb?.cancel();
          try {
            await server.close();
            await Promise.all([plugins.close(), memes?.close(), voicestudio?.close(), worker.close(),groupChatPlus?.close(),livingMemory?.close(),emotion?.close(),video?.close(),android?.close(),douyinWeb?.close()]);
            await qzone.close();
            await adapter.close();
          } finally { store.close(); unlock(); }
        })();
        return closing;
      }
    };
  } catch (error) {
    plugins?.service('free-activity')?.close();
    await server?.close().catch(() => {});
    await douyinWeb?.close().catch(()=>{});
    await android?.close().catch(()=>{});
    await video?.close().catch(()=>{});
    await plugins?.close().catch(() => {});
    await livingMemory?.close().catch(() => {});
    await emotion?.close().catch(()=>{});
    await groupChatPlus?.close().catch(()=>{});
    await voicestudio?.close().catch(() => {});
    await memes?.close().catch(() => {});
    await qzone?.close().catch(() => {});
    await worker?.close().catch(() => {});
    await adapter?.close().catch(() => {});
    store?.close(); unlock(); throw error;
  }
}
