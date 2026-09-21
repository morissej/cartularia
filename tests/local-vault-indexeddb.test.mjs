import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const project = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.CARTULARIA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

class DevTools {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data); const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    };
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; });
    return new DevTools(socket);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const response = new Promise((resolveCall, rejectCall) => {
      const timeout = setTimeout(() => { this.pending.delete(id); rejectCall(new Error(`DevTools timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolveCall(value); }, reject: (error) => { clearTimeout(timeout); rejectCall(error); } });
    });
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return response;
  }
  async evaluate(sessionId, expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
}

test('IndexedDB réel : transactions entre onglets, ACK exacts, reprise et imports atomiques', {
  skip: !existsSync(chromePath) && 'Chrome absent ; définir CARTULARIA_CHROME pour la recette IndexedDB réelle.', timeout: 60_000,
}, async (t) => {
  // Only this test's TypeScript modules are served. A fresh profile and blocked DNS keep real sessions untouched.
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Local vault synthetic test</title>'); return; }
    const path = resolve(project, `.${pathname}`);
    if (!path.startsWith(resolve(project, 'src') + '/') || !path.endsWith('.ts')) { response.writeHead(404); response.end(); return; }
    try {
      const source = await readFile(path, 'utf8');
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      response.end(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'cartularia-idb-test-'));
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeErrors = '';
  chrome.stderr.on('data', (chunk) => { chromeErrors = (chromeErrors + String(chunk)).slice(-3000); });
  chrome.on('error', (error) => { chromeErrors += error.message; });
  let cdp;
  try {
    let port;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch { /* Chrome is starting. */ }
      if (chrome.exitCode !== null) break;
      await pause(250);
    }
    assert.ok(port, `Chrome doit démarrer sur un port DevTools isolé : ${chromeErrors}`);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = await DevTools.open(version.webSocketDebuggerUrl);
    const newPage = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: origin });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await cdp.evaluate(sessionId, 'location.origin') === origin) break;
        await pause(25);
      }
      await cdp.evaluate(sessionId, `globalThis.mod = await import('/src/persistence/localVault.ts'); true`);
      return { targetId, sessionId };
    };
    const pageA = await newPage();
    let pageB = await newPage();
    const evalA = (source) => cdp.evaluate(pageA.sessionId, source);
    const evalB = (source) => cdp.evaluate(pageB.sessionId, source);
    const setup = async (cart, fixedClock = null) => {
      const source = `globalThis.backend = new mod.IndexedDbVaultBackend(); globalThis.session = mod.createVerifiedLocalVaultSession({uid:'synthetic-user',cartularyId:${JSON.stringify(cart)},backend,storage:localStorage${fixedClock === null ? '' : `,now:()=>${fixedClock}`}}); globalThis.vault=session.vault; globalThis.key='cartularia-test-state'; true`;
      await Promise.all([evalA(source), evalB(source)]);
      await evalA(`await vault.writeRaw(key,'A'); globalThis.captured=(await vault.listStateRecords())[0]; await vault.markStateCloudSynced(key,1,captured); globalThis.captured=(await vault.listStateRecords())[0]; true`);
    };
    const holdMutationAfterCommit = `globalThis.originalMutation=backend.mutateState.bind(backend); globalThis.holdOnce=true; globalThis.held=false; backend.mutateState=async(...args)=>{const result=await originalMutation(...args); if(holdOnce){holdOnce=false; held=true; await new Promise(resolve=>globalThis.release=resolve);} return result;}; true`;
    const waitHeld = async (evaluate) => {
      for (let attempt = 0; attempt < 80; attempt += 1) { if (await evaluate('Boolean(globalThis.held)')) return; await pause(10); }
      assert.fail('La mutation doit atteindre le point de suspension');
    };

    await t.test('deux connexions : une saisie immédiate en attente protège contre ACK et pull périmés', async () => {
      await setup('cart-pending');
      await evalB(`globalThis.originalMutation=backend.mutateState.bind(backend); globalThis.held=false; globalThis.holdOnce=true; backend.mutateState=async(...args)=>{if(holdOnce){holdOnce=false;held=true;await new Promise(resolve=>globalThis.release=resolve);}return originalMutation(...args);}; globalThis.writing=vault.writeRaw(key,'B pending'); true`);
      await waitHeld(evalB);
      assert.equal(await evalA('await vault.markStateCloudSynced(key,2,captured)'), false);
      assert.equal(await evalA(`await vault.applyCloudState({...captured,value:'stale cloud',cloudRevision:3},captured)`), false);
      await evalB('release(); await writing; true');
      const result = await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(result.record.value, 'B pending'); assert.equal(result.value, 'B pending');
      assert.equal(result.record.dirty, true); assert.equal(result.record.cloudRevision, 2);
    });

    await t.test('fermeture avant transaction : l’intention locale rétablit le brouillon au redémarrage', async () => {
      await setup('cart-reopen');
      await evalB(`backend.mutateState=async()=>new Promise(()=>{}); void vault.writeRaw(key,'B durable intent'); true`);
      await cdp.send('Target.closeTarget', { targetId: pageB.targetId });
      pageB = await newPage();
      await evalA('await vault.restoreLocalStorage(); true');
      const result = await evalA('(await vault.listStateRecords())[0]');
      assert.equal(result.value, 'B durable intent'); assert.equal(result.dirty, true); assert.ok(result.localVersion);
    });

    await t.test('ACK inversés : une révision plus ancienne ne nettoie pas une nouvelle version et ne fait pas reculer le cloud', async () => {
      await setup('cart-ack-reverse');
      await evalB(`await vault.writeRaw(key,'B'); globalThis.newer=(await vault.listStateRecords())[0]; await vault.markStateCloudSynced(key,3,newer); true`);
      assert.equal(await evalA('await vault.markStateCloudSynced(key,2,captured)'), false);
      const result = await evalA('(await vault.listStateRecords())[0]');
      assert.equal(result.value, 'B'); assert.equal(result.dirty, false); assert.equal(result.cloudRevision, 3);
    });

    for (const operation of ['restore', 'conflict', 'pull']) {
      await t.test(`projection ${operation} retardée après commit : la saisie de l’autre onglet reste en IDB et localStorage`, async () => {
        await setup(`cart-project-${operation}`);
        await evalA(holdMutationAfterCommit);
        const call = operation === 'restore' ? 'vault.restoreLocalStorage()' : operation === 'conflict' ? 'vault.prepareStateConflictResolution(key,2,captured)' : `vault.applyCloudState({...captured,value:'cloud old',cloudRevision:2},captured)`;
        await evalA(`globalThis.operation=${call}; true`);
        await waitHeld(evalA);
        await evalB(`await vault.writeRaw(key,'newer B'); true`);
        await evalA('release(); await operation; backend.mutateState=originalMutation; true');
        const result = await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
        assert.equal(result.record.value, 'newer B'); assert.equal(result.value, 'newer B'); assert.equal(result.record.dirty, true);
      });
    }

    await t.test('un miroir localStorage retardé ne ressuscite pas une ancienne valeur après un pull déjà commis', async () => {
      await setup('cart-mirror-during-pull');
      await evalA(holdMutationAfterCommit);
      await evalA(`globalThis.operation=vault.applyCloudState({...captured,value:'new remote value',cloudRevision:2},captured); true`);
      await waitHeld(evalA);
      await evalB('await vault.mirrorLocalStorage(); true');
      await evalA('release(); await operation; backend.mutateState=originalMutation; true');
      const current=await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(current.record.value,'new remote value');
      assert.equal(current.value,'new remote value');
      assert.equal(current.record.dirty,false);
      assert.equal(current.record.cloudRevision,2);
    });

    await t.test('deux pulls concurrents sur le même snapshot : un seul CAS peut appliquer', async () => {
      await setup('cart-two-pulls');
      await evalB('globalThis.captured=(await vault.listStateRecords())[0]; true');
      const results = await Promise.all([
        evalA(`await vault.applyCloudState({...captured,value:'cloud A',cloudRevision:2},captured)`),
        evalB(`await vault.applyCloudState({...captured,value:'cloud B',cloudRevision:2},captured)`),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      const final = await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(final.record.value, results[0] ? 'cloud A' : 'cloud B'); assert.equal(final.value, final.record.value);
    });

    await t.test('une saisie inter-onglets pendant la projection synchrone ne doit pas disparaître', async () => {
      await setup('cart-project-critical');
      await cdp.send('Debugger.enable', {}, pageA.sessionId);
      await evalA(`globalThis.originalProject=vault.projectState.bind(vault); vault.projectState=(record)=>{if(record.value==='cloud critical') debugger; originalProject(record);}; true`);
      const paused = new Promise((done, fail) => {
        const timeout = setTimeout(() => fail(new Error('Breakpoint de projection non atteint')), 3000);
        const listener = ({data}) => { const event=JSON.parse(data); if(event.method==='Debugger.paused' && event.sessionId===pageA.sessionId){clearTimeout(timeout);cdp.socket.removeEventListener('message',listener);done();} };
        cdp.socket.addEventListener('message',listener);
      });
      const pulling = evalA(`await vault.applyCloudState({...captured,value:'cloud critical',cloudRevision:2},captured)`);
      try {
        await paused;
        await evalB(`globalThis.writing=vault.writeRaw(key,'B during projection'); true`);
      } finally { await cdp.send('Debugger.resume', {}, pageA.sessionId); }
      await pulling;
      await evalB('await writing; true');
      await cdp.send('Debugger.disable', {}, pageA.sessionId);
      const current=await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(current.record.value,'B during projection');
      assert.equal(current.value,'B during projection');
      assert.equal(current.record.dirty,true);
    });

    await t.test('projection et fermeture concurrentes : le payload de l’intention survit avant son commit IDB', async () => {
      await setup('cart-project-close');
      await cdp.send('Debugger.enable', {}, pageA.sessionId);
      await evalA(`globalThis.originalProject=vault.projectState.bind(vault); vault.projectState=(record)=>{if(record.value==='cloud closing') debugger; originalProject(record);}; true`);
      const paused = new Promise((done, fail) => {
        const timeout = setTimeout(() => fail(new Error('Breakpoint de projection non atteint')), 3000);
        const listener = ({data}) => { const event=JSON.parse(data); if(event.method==='Debugger.paused' && event.sessionId===pageA.sessionId){clearTimeout(timeout);cdp.socket.removeEventListener('message',listener);done();} };
        cdp.socket.addEventListener('message',listener);
      });
      const pulling = evalA(`await vault.applyCloudState({...captured,value:'cloud closing',cloudRevision:2},captured)`);
      try {
        await paused;
        await evalB(`backend.mutateState=async()=>new Promise(()=>{}); void vault.writeRaw(key,'B closed before commit'); true`);
        await cdp.send('Target.closeTarget', { targetId: pageB.targetId });
      } finally { await cdp.send('Debugger.resume', {}, pageA.sessionId); }
      await pulling;
      await cdp.send('Debugger.disable', {}, pageA.sessionId);
      pageB = await newPage();
      await evalA('vault.projectState=originalProject; await vault.restoreLocalStorage(); true');
      const current=await evalA(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(current.record.value,'B closed before commit');
      assert.equal(current.value,'B closed before commit');
      assert.equal(current.record.dirty,true);
    });

    await t.test('binaires IDB entre onglets : ACK/pull d’anciens octets préservent le Blob plus récent', async () => {
      await setup('cart-binary');
      await evalA(`globalThis.binaryA=await vault.putBinary({binaryId:'synthetic-binary',kind:'media',fileName:'a.txt',mimeType:'text/plain',sha256:'a'.repeat(64),blob:new Blob(['old bytes'])}); true`);
      await evalB(`await vault.putBinary({binaryId:'synthetic-binary',kind:'media',fileName:'b.txt',mimeType:'text/plain',sha256:'b'.repeat(64),blob:new Blob(['newer bytes'])}); true`);
      assert.equal(await evalA(`await vault.markBinaryCloudSynced('synthetic-binary',1,'private/old',binaryA)`),false);
      assert.equal(await evalA(`await vault.applyCloudBinary({...binaryA,dirty:false,cloudRevision:2},binaryA,{allowDirty:true})`),false);
      const current=await evalA(`globalThis.currentBinary=await vault.getBinary('synthetic-binary'); ({bytes:await currentBinary.blob.text(),dirty:currentBinary.dirty,revision:currentBinary.cloudRevision,path:currentBinary.cloudStoragePath})`);
      assert.deepEqual(current,{bytes:'newer bytes',dirty:true,revision:1,path:null});
    });

    await t.test('une écriture acceptée avant verrouillage ne remplace pas l’autre onglet au même milliseconde', async () => {
      await setup('cart-lock-same-clock',1000);
      await evalA(`globalThis.originalMutation=backend.mutateState.bind(backend); globalThis.held=false; globalThis.holdOnce=true; backend.mutateState=async(...args)=>{if(holdOnce){holdOnce=false;held=true;await new Promise(resolve=>globalThis.release=resolve);}return originalMutation(...args);}; globalThis.writing=vault.writeRaw(key,'old queued A'); session.lock(); true`);
      await waitHeld(evalA);
      await evalB(`await vault.writeRaw(key,'newer B same millisecond'); true`);
      await evalA(`release(); await writing.catch(error=>error.name); true`);
      await evalB('await vault.restoreLocalStorage(); true');
      const current=await evalB(`({record:(await vault.listStateRecords())[0],value:session.storage.getItem(key)})`);
      assert.equal(current.record.value,'newer B same millisecond');
      assert.equal(current.value,'newer B same millisecond');
      assert.equal(current.record.dirty,true);
    });

    await t.test('put/delete binaires acceptés avant verrouillage ne remplacent pas les nouveaux octets d’un autre onglet', async () => {
      for (const action of ['put','delete']) {
        await setup(`cart-binary-lock-${action}`,1000);
        await evalB(`await vault.putBinary({binaryId:'synthetic-binary',kind:'media',fileName:'initial.txt',mimeType:'text/plain',sha256:'a'.repeat(64),blob:new Blob(['initial bytes'])}); true`);
        await evalA(`globalThis.originalBinaryMutation=backend.mutateBinary.bind(backend); globalThis.held=false; globalThis.holdOnce=true; backend.mutateBinary=async(...args)=>{if(holdOnce){holdOnce=false;held=true;await new Promise(resolve=>globalThis.release=resolve);}return originalBinaryMutation(...args);}; true`);
        const operation=action==='put' ? `vault.putBinary({binaryId:'synthetic-binary',kind:'media',fileName:'old.txt',mimeType:'text/plain',sha256:'b'.repeat(64),blob:new Blob(['old A'])})` : `vault.deleteBinary('synthetic-binary')`;
        await evalA(`globalThis.writing=${operation}.catch(error=>error.name); session.lock(); true`);
        await waitHeld(evalA);
        await evalB(`await vault.putBinary({binaryId:'synthetic-binary',kind:'media',fileName:'new.txt',mimeType:'text/plain',sha256:'c'.repeat(64),blob:new Blob(['new B'])}); true`);
        await evalA('release(); await writing; true');
        const current=await evalB(`globalThis.currentBinary=await vault.getBinary('synthetic-binary'); ({bytes:currentBinary.blob ? await currentBinary.blob.text() : null,deleted:currentBinary.deleted,dirty:currentBinary.dirty})`);
        assert.deepEqual(current,{bytes:'new B',deleted:false,dirty:true},action);
      }
    });

    await t.test('ancien enregistrement sans version : migration atomique commune aux deux connexions', async () => {
      await setup('cart-legacy');
      await evalA(`const id='identity::synthetic-user::cart-legacy::'+key; const legacy=await backend.getState(id); delete legacy.localVersion; delete legacy.localLineage; await backend.putState(legacy); true`);
      const records = await Promise.all([evalA('(await vault.listStateRecords())[0]'), evalB('(await vault.listStateRecords())[0]')]);
      assert.ok(records[0].localVersion); assert.equal(records[0].localVersion, records[1].localVersion);
      assert.ok(records[0].localLineage); assert.equal(records[0].localLineage, records[1].localLineage);
      assert.equal(records[0].value, 'A'); assert.equal(records[0].cloudRevision, 1);
    });

    const setupImport = async (cart) => {
      await setup(cart);
      const source = `globalThis.importBinary=(binaryId)=>({binaryId,kind:'media',fileName:binaryId+'.png',mimeType:'image/png',sha256:'c'.repeat(64),blob:new Blob(['synthetic '+binaryId])});
        globalThis.appendImport=(binaryId)=>(raw)=>JSON.stringify([...JSON.parse(raw||'[]'),{id:binaryId,binaryId,name:binaryId}]); true`;
      await Promise.all([evalA(source), evalB(source)]);
      await evalA(`await vault.putBinary(importBinary('preexisting-binary')); await vault.writeRaw(key,JSON.stringify([{id:'preexisting-binary',binaryId:'preexisting-binary',name:'untouched'}]));
        globalThis.beforeImport=(await vault.listStateRecords())[0]; await vault.markStateCloudSynced(key,4,beforeImport); globalThis.beforeImport=(await vault.listStateRecords())[0]; true`);
    };

    await t.test('import atomique : un abort après insertion effective annule références et nouveaux Blobs, puis le même lot reprend sans doublon', async () => {
      await setupImport('cart-import-abort');
      await evalA(`globalThis.originalAdd=IDBObjectStore.prototype.add; globalThis.insertedRequests=0;
        IDBObjectStore.prototype.add=function(...args){const request=originalAdd.apply(this,args); if(this.name==='binaries' && args[0].binaryId.startsWith('import-abort-')){
          const transaction=this.transaction; request.addEventListener('success',()=>{insertedRequests+=1;if(insertedRequests===1)transaction.abort();});} return request;}; true`);
      const failed = await evalA(`globalThis.importAttempt=()=>vault.commitImport({key,binaries:[importBinary('import-abort-a'),importBinary('import-abort-b')],
        update:raw=>appendImport('import-abort-b')(appendImport('import-abort-a')(raw))});
        globalThis.failure=await importAttempt().then(()=>null,error=>({name:error.name,message:error.message}));
        IDBObjectStore.prototype.add=originalAdd; ({failure,insertedRequests,state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId),raw:session.storage.getItem(key),before:beforeImport})`);
      assert.ok(failed.failure, 'La transaction interrompue doit être refusée');
      assert.equal(failed.insertedRequests, 1, 'Le premier add a réussi avant abort : il ne s’agit pas seulement d’une validation préalable');
      assert.deepEqual(failed.state, failed.before);
      assert.equal(failed.raw, failed.before.value);
      assert.deepEqual(failed.binaries, ['preexisting-binary']);
      const retried = await evalA(`await importAttempt(); ({state:(await vault.listStateRecords())[0],binaries:await Promise.all((await vault.listBinaryRecords()).map(async item=>({id:item.binaryId,bytes:await item.blob.text()})))})`);
      assert.deepEqual(JSON.parse(retried.state.value).map((item) => item.id).sort(), ['import-abort-a', 'import-abort-b', 'preexisting-binary']);
      assert.deepEqual(retried.binaries.map((item) => item.id).sort(), ['import-abort-a', 'import-abort-b', 'preexisting-binary']);
      assert.equal(retried.binaries.find((item) => item.id === 'preexisting-binary').bytes, 'synthetic preexisting-binary');
      assert.equal(retried.state.dirty, true); assert.equal(retried.state.cloudRevision, 4);
    });

    await t.test('deux imports sur deux connexions fusionnent leurs références et leurs binaires dans le dernier état IDB', async () => {
      await setupImport('cart-import-two-tabs');
      const results = await Promise.all([
        evalA(`await vault.commitImport({key,binaries:[importBinary('import-tab-a')],update:appendImport('import-tab-a')}); true`),
        evalB(`await vault.commitImport({key,binaries:[importBinary('import-tab-b')],update:appendImport('import-tab-b')}); true`),
      ]);
      assert.deepEqual(results, [true, true]);
      const result = await evalA(`({state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId),raw:session.storage.getItem(key)})`);
      const ids = ['import-tab-a', 'import-tab-b', 'preexisting-binary'];
      assert.deepEqual(JSON.parse(result.state.value).map((item) => item.id).sort(), ids);
      assert.deepEqual(result.binaries.sort(), ids);
      assert.equal(result.raw, result.state.value);
      assert.equal(JSON.parse(result.state.value).find((item) => item.id === 'preexisting-binary').name, 'untouched');
      assert.equal(result.state.cloudRevision, 4); assert.equal(result.state.dirty, true);
    });

    await t.test('une saisie inter-onglets après la lecture du lot fait refuser son commit sans références orphelines', async () => {
      await setupImport('cart-import-edit-during-transaction');
      await cdp.send('Debugger.enable', {}, pageA.sessionId);
      const paused = new Promise((done, fail) => {
        const timeout = setTimeout(() => fail(new Error('Breakpoint de préparation de l’import non atteint')), 3000);
        const listener = ({data}) => { const event=JSON.parse(data); if(event.method==='Debugger.paused' && event.sessionId===pageA.sessionId){clearTimeout(timeout);cdp.socket.removeEventListener('message',listener);done();} };
        cdp.socket.addEventListener('message',listener);
      });
      const importing = evalA(`await vault.commitImport({key,binaries:[importBinary('import-interrupted')],update:raw=>{const next=appendImport('import-interrupted')(raw); debugger; return next;}}).then(()=>({ok:true}),error=>({ok:false,message:error.message}))`);
      try {
        await paused;
        await evalB(`globalThis.writing=vault.writeRaw(key,JSON.stringify([{id:'preexisting-binary',binaryId:'preexisting-binary',name:'edited in B'}])); true`);
      } finally { await cdp.send('Debugger.resume', {}, pageA.sessionId); }
      const result = await importing;
      await evalB('await writing; true');
      await cdp.send('Debugger.disable', {}, pageA.sessionId);
      assert.equal(result.ok, false, 'Une préparation devenue périmée doit être refusée avant de persister les Blobs');
      const current = await evalB(`({state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId),raw:session.storage.getItem(key)})`);
      assert.deepEqual(JSON.parse(current.state.value), [{ id: 'preexisting-binary', binaryId: 'preexisting-binary', name: 'edited in B' }]);
      assert.deepEqual(current.binaries, ['preexisting-binary']);
      assert.equal(current.raw, current.state.value);
      const retried = await evalA(`await vault.commitImport({key,binaries:[importBinary('import-interrupted')],update:appendImport('import-interrupted')}); ({state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId)})`);
      assert.deepEqual(JSON.parse(retried.state.value).map((item) => item.id).sort(), ['import-interrupted', 'preexisting-binary']);
      assert.equal(JSON.parse(retried.state.value).find((item) => item.id === 'preexisting-binary').name, 'edited in B');
      assert.deepEqual(retried.binaries.sort(), ['import-interrupted', 'preexisting-binary']);
    });

    await t.test('une édition arrivée pendant les requêtes IDB du lot reste récupérable sans écraser ses références', async () => {
      await setupImport('cart-import-edit-during-requests');
      await evalB('globalThis.expectedImportVersion=vault.getImportVersion(key); true');
      await cdp.send('Debugger.enable', {}, pageA.sessionId);
      await evalA(`globalThis.originalAdd=IDBObjectStore.prototype.add; IDBObjectStore.prototype.add=function(...args){
        if(this.name==='binaries' && args[0].binaryId==='import-late-edit') debugger; return originalAdd.apply(this,args);}; true`);
      const paused = new Promise((done, fail) => {
        const timeout = setTimeout(() => fail(new Error('Breakpoint des requêtes de l’import non atteint')), 3000);
        const listener = ({data}) => { const event=JSON.parse(data); if(event.method==='Debugger.paused' && event.sessionId===pageA.sessionId){clearTimeout(timeout);cdp.socket.removeEventListener('message',listener);done();} };
        cdp.socket.addEventListener('message',listener);
      });
      const importing = evalA(`await vault.commitImport({key,binaries:[importBinary('import-late-edit')],update:appendImport('import-late-edit')}).then(()=>({ok:true}),error=>({ok:false,message:error.message}))`);
      try {
        await paused;
        await evalB(`globalThis.writing=vault.writeRaw(key,JSON.stringify([{id:'preexisting-binary',binaryId:'preexisting-binary',name:'edited while inserting'}]),{expectedImportVersion}).then(()=>({ok:true}),error=>({ok:false,message:error.message})); true`);
      } finally { await cdp.send('Debugger.resume', {}, pageA.sessionId); }
      const result = await importing;
      const edited = await evalB('await writing');
      await evalA('IDBObjectStore.prototype.add=originalAdd; true');
      await cdp.send('Debugger.disable', {}, pageA.sessionId);
      assert.equal(result.ok, true);
      assert.equal(edited.ok, false, 'L’ancienne édition doit être refusée explicitement, jamais annoncée sauvegardée');
      const current = await evalB(`({state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId),
        recoverable:Array.from({length:session.storage.length},(_,index)=>session.storage.key(index)).filter(name=>name!==key).map(name=>session.storage.getItem(name)).some(raw=>raw?.includes('edited while inserting'))})`);
      const references = JSON.parse(current.state.value);
      assert.equal(references.find((item) => item.id === 'preexisting-binary').name, 'untouched');
      assert.ok(current.state.localImportVersion);
      assert.equal(current.recoverable, true, 'Le payload de l’édition refusée reste durable, indépendamment du cache visible');
      assert.equal(current.binaries.includes('import-late-edit'), true);
      assert.equal(references.some((item) => item.binaryId === 'import-late-edit'), true, 'Un commit réussi conserve une référence pour son original');
      const resumed = await evalB(`globalThis.latest=(await vault.listStateRecords())[0];
        await vault.writeRaw(key,JSON.stringify(JSON.parse(latest.value).map(item=>item.id==='preexisting-binary'?{...item,name:'edited while inserting'}:item)),{expectedImportVersion:vault.getImportVersion(key)});
        ({state:(await vault.listStateRecords())[0],binaries:(await vault.listBinaryRecords()).map(item=>item.binaryId)})`);
      assert.equal(JSON.parse(resumed.state.value).find((item) => item.id === 'preexisting-binary').name, 'edited while inserting');
      assert.deepEqual(JSON.parse(resumed.state.value).map((item) => item.binaryId).sort(), ['import-late-edit', 'preexisting-binary']);
      assert.deepEqual(resumed.binaries.sort(), ['import-late-edit', 'preexisting-binary']);
    });
  } finally {
    cdp?.socket.close();
    if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
      await new Promise((done) => {
        const timeout = setTimeout(() => chrome.kill('SIGKILL'), 2000);
        chrome.once('exit', () => { clearTimeout(timeout); done(); });
        chrome.kill('SIGTERM');
      });
    }
    await new Promise((done) => server.close(done));
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
});
