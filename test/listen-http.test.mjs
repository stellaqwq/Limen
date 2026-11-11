import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {listenHTTP} from '../src/listen-http.mjs';

function mock(ports){const server=new EventEmitter();server.binds=0;server.closes=0;server.listen=(port,host,callback)=>{server.bound=ports[Math.min(server.binds++,ports.length-1)];queueMicrotask(callback);};server.address=()=>({port:server.bound});server.close=callback=>{server.closes++;queueMicrotask(callback);};return server;}
test('automatic HTTP binding retries browser-blocked ephemeral ports before exposing a URL',async()=>{const server=mock([6666,10080,54001]);await listenHTTP(server,0,'127.0.0.1');assert.equal(server.address().port,54001);assert.equal(server.binds,3);assert.equal(server.closes,2);assert.equal(server.listenerCount('error'),0);});
test('explicit HTTP ports are preserved and repeated blocked allocation is bounded',async()=>{const explicit=mock([6666]);await listenHTTP(explicit,6666,'127.0.0.1');assert.equal(explicit.binds,1);assert.equal(explicit.closes,0);const blocked=mock([10080]);await assert.rejects(listenHTTP(blocked,0,'127.0.0.1'),/无法分配/);assert.equal(blocked.binds,8);assert.equal(blocked.closes,8);});
test('HTTP binding errors propagate without retrying unrelated failures',async()=>{const server=mock([50001]),error=Object.assign(Error('occupied'),{code:'EADDRINUSE'});server.listen=()=>queueMicrotask(()=>server.emit('error',error));await assert.rejects(listenHTTP(server,0,'127.0.0.1'),e=>e===error);assert.equal(server.closes,0);});
