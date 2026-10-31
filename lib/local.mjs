import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
export function runProcess(executable,args,{input='',signal,timeout=30000,env=process.env,maxOutput=2e6}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env,signal});
    let out='',err='',settled=false;
    const timer=setTimeout(()=>{child.kill();finish(new Error('Local process timed out.'));},timeout);
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(out.trim());};
    child.stdout.on('data',b=>{out+=b;if(out.length>maxOutput){child.kill();finish(new Error('Local process output exceeded the limit.'));}});
    child.stderr.on('data',b=>{err=(err+b).slice(-3000);});
    child.on('error',()=>finish(new Error('Could not start the local executable. Check its path in Settings.')));
    child.on('close',code=>finish(code===0?null:new Error('Local process failed. '+err.slice(-1000))));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export async function protectKey(value, decrypt=false){
  if(process.platform!=='win32')throw new Error('Remembering keys uses Windows encryption. Use a session key or MODEL_API_KEY on this OS.');
  const method=decrypt?'Unprotect':'Protect';
  const code='Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); '+
    (decrypt?'$b=[Convert]::FromBase64String($s);':'$b=[Text.Encoding]::UTF8.GetBytes($s);')+
    '$r=[Security.Cryptography.ProtectedData]::'+method+'($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); '+
    (decrypt?'[Console]::Write([Text.Encoding]::UTF8.GetString($r))':'[Console]::Write([Convert]::ToBase64String($r))');
  return runProcess(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{input:value});
}
export async function hardware(){
  try {
    const line=(await runProcess('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'],{timeout:8000})).split('\n')[0];
    const split=line.lastIndexOf(',');return {name:line.slice(0,split).trim(),vramMB:Number(line.slice(split+1).trim())};
  } catch { return {name:'NVIDIA GPU not detected',vramMB:0}; }
}
export function localReadiness(config,gpu){
  const wsl=config.workerRuntime==='wsl'&&process.platform==='win32';
  const has=p=>!!p&&(wsl?p.startsWith('/'):fs.existsSync(p));
  const samReady=has(config.samPython)&&has(config.samCheckpoint);
  const bodyConfigured=has(config.bodyPython)&&has(config.bodyRepo)&&has(config.bodyCheckpoint)&&has(config.bodyMhr);
  const experimental=config.threeMode==='experimental';
  const threeReason=!experimental&&gpu.vramMB<32000?'Official SAM 3D Objects requires 32 GB VRAM; this GPU has '+Math.round(gpu.vramMB/1024)+' GB.':experimental&&gpu.vramMB<11000?'The experimental fork reports about 12 GB peak VRAM. This GPU has less than 11 GB.':process.platform!=='linux'&&!wsl?'Choose WSL for the Linux SAM runtime.':!has(config.threePython)||!has(config.threeRepo)||!has(config.threeConfig)?'Configure the '+(experimental?'experimental low-memory':'SAM 3D Objects')+' Python environment, repository and pipeline.yaml.':'';
  return {bodyConfigured,bodyMessage:bodyConfigured?'Body paths configured. Verify dependencies and a real human image before relying on this setup.':'Configure SAM 3D Body Python, repository, checkpoint and MHR model in Settings.',samConfigured:samReady,samMessage:samReady?'Paths configured. Run Check local setup to verify Python, CUDA and SAM 3.':'Add a Python executable with SAM 3 installed and its downloaded checkpoint in Settings.',threeReady:!threeReason,threeExperimental:experimental,threeMessage:threeReason||(experimental?'Experimental low-memory mode: around 12 GB claimed by the fork author. Not yet verified on this PC; out-of-memory failures remain possible.':'Paths and hardware checks pass; model inference still needs verification.')};
}
export function wslPath(value){
  if(!value)return value;
  if(value.startsWith('/'))return value;
  const match=value.match(/^([a-zA-Z]):[\\/](.*)$/);if(!match)throw new Error('Use an absolute Windows path or Linux path.');
  return '/mnt/'+match[1].toLowerCase()+'/'+match[2].replaceAll('\\','/');
}
export function workerCommand(config,python,args){
  if(config.workerRuntime==='wsl'&&process.platform==='win32')return {executable:'wsl.exe',args:['--distribution',config.wslDistro,'--exec',python,...args.map(v=>/^[a-zA-Z]:[\\/]/.test(v)?wslPath(v):v)]};
  return {executable:python,args};
}
