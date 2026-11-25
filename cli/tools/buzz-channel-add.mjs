// One-off: add pubkeys to a Buzz channel as role "bot" (NIP-29 kind 9000), signed by an existing
// channel-owner identity whose key is in Windows Credential Manager. Same key handling as
// buzz-board.mjs: secret read via WinCred.ps1 child pipe, never printed, logged or put in env.
// usage: node buzz-channel-add.mjs --as <bot> --channel <uuid> --pubkeys <hex,hex,...>
import {createRequire} from 'node:module'; import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process'; import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path'; import {pathToFileURL} from 'node:url';
const die=(m)=>{process.stderr.write(`buzz-channel-add: ${m}\n`);process.exit(1);};
const cfg=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'buzz-board','config.json'),'utf8').replace(/^\uFEFF/,''));
const req=createRequire(join(cfg.nostrToolsFrom,'package.json'));
const pm=await import(pathToFileURL(req.resolve('nostr-tools/pure')).href); const pure={...(pm.default||{}),...pm};
const a={}; const v=process.argv.slice(2); for(let i=0;i<v.length;i+=2)a[v[i].slice(2)]=v[i+1];
if(!/^[a-z0-9-]+$/.test(a.as||''))die('bad --as'); if(!/^[0-9a-f-]{36}$/.test(a.channel||''))die('bad --channel');
const pks=(a.pubkeys||'').split(',').filter(Boolean); if(!pks.every(p=>/^[0-9a-f]{64}$/.test(p)))die('bad pubkeys');
const target=`A2A/BUZZ_${a.as.toUpperCase().replace(/-/g,'_')}_SECRET_KEY`;
let hex; try{hex=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','. $env:BB_WINCRED; $s=[WinCredNative]::Read($env:BB_TARGET); if($null -eq $s){exit 3}; [Console]::Out.Write($s)'],{env:{...process.env,BB_WINCRED:cfg.winCredScript,BB_TARGET:target},stdio:['pipe','pipe','ignore'],windowsHide:true}).toString().trim();}catch(e){die(`cannot read ${target} (exit ${e.status})`);}
if(!/^[0-9a-f]{64}$/.test(hex))die(`${target} malformed`);
const sk=Uint8Array.from(Buffer.from(hex,'hex')); hex=null;
const sign=(kind,tags,content='')=>pure.finalizeEvent({kind,tags,content,created_at:Math.floor(Date.now()/1000)},sk);
let base=readFileSync(cfg.relayUrlFile,'utf8').trim().replace(/\/+$/,''); base=base.replace(/^wss:\/\//,'https://').replace(/^ws:\/\//,'http://');
const results=[];
for(const pk of pks){ const ev=sign(9000,[['h',a.channel],['p',pk],['role','bot']]); const body=JSON.stringify(ev); const url=base+'/events';
  const auth=sign(27235,[['u',url],['method','POST'],['nonce',randomUUID()],['payload',createHash('sha256').update(body).digest('hex')]]);
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Nostr '+Buffer.from(JSON.stringify(auth)).toString('base64'),'Content-Type':'application/json'},body});
  results.push({pubkey:pk,event:ev.id,status:r.status,body:(await r.text()).slice(0,200)}); }
process.stdout.write(JSON.stringify({signer:pure.getPublicKey(sk),channel:a.channel,results},null,2)+'\n');