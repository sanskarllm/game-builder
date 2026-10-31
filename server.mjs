import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {planAssets,generateImage,composeScene,validateScene} from './lib/meta.mjs';
import {hardware,localReadiness,protectKey,runProcess,wslPath,workerCommand} from './lib/local.mjs';
import {makeZip} from './lib/zip.mjs';
import {analyseStory,mergeStoryAnalysis,storyHash,storySceneProject} from './lib/story.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS={sparkModel:'muse-spark-1.3',imageModel:'muse-image-1.0',samPython:'',samCheckpoint:'',samRepo:'',threePython:'',threeRepo:'',threeConfig:'',threeMode:'experimental',bodyPython:'',bodyRepo:'',bodyCheckpoint:'',bodyMhr:'',workerRuntime:process.platform==='win32'?'wsl':'native',wslDistro:'PCMClawUbuntu'};
const UUID=/^[a-f0-9-]{36}$/;
const FILE=/^[a-f0-9-]{36}\.(png|jpg|webp|glb|ply)$/;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.ply':'application/octet-stream','.md':'text/plain; charset=utf-8'};
const clean=(s,n=5000)=>typeof s==='string'?s.trim().slice(0,n):'';
function error(message,status=400){return Object.assign(new Error(message),{status});}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
function readJSON(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error('Could not read saved data: '+path.basename(file)+'. Keep this file and restore from a backup.');}}
export function imageExtension(buffer){
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'jpg';
  if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'webp';
  throw error('Import a PNG, JPEG or WebP image.');
}
export async function createStudio({dataDir=process.env.ASSET_STUDIO_DATA||path.join(ROOT,'data'),port=Number(process.env.PORT||8977),provider={planAssets,generateImage,composeScene,analyseStory},gpuOverride}={}){
  const root=path.resolve(dataDir),dbPath=path.join(root,'library.json'),configPath=path.join(root,'settings.json');
  fs.mkdirSync(root,{recursive:true});
  const db=readJSON(dbPath,{version:1,projects:[],jobs:[]});
  let config={...DEFAULTS,...readJSON(configPath,{})},key=process.env.MODEL_API_KEY||'',keyWarning='';
  if(!key&&fs.existsSync(path.join(root,'meta-key.dpapi'))){try{key=await protectKey(fs.readFileSync(path.join(root,'meta-key.dpapi'),'utf8'),true);}catch{keyWarning='Could not decrypt the saved key for this Windows user. Enter it again.';}}
  const gpu=gpuOverride||await hardware(),csrf=randomBytes(32).toString('hex');
  const running=new Map();let draining=false,closing=false;
  for(const j of db.jobs)if(['queued','running'].includes(j.status)){j.status='interrupted';j.message='Studio restarted. Start this operation again when ready.';}
  const save=()=>atomic(dbPath,db);save();
  const project=id=>{const p=db.projects.find(p=>p.id===id);if(!p)throw error('Project not found.',404);return p;};
  const asset=(p,id)=>{const a=p.assets.find(a=>a.id===id);if(!a)throw error('Asset not found.',404);return a;};
  const projectDir=id=>{if(!UUID.test(id))throw error('Invalid project identifier.');return path.join(root,'projects',id);};
  const imagePath=(p,name)=>{if(!FILE.test(name))throw error('Invalid asset filename.');return path.join(projectDir(p.id),name);};
  const writeFile=(p,bytes,ext)=>{const name=randomUUID()+'.'+ext;fs.mkdirSync(projectDir(p.id),{recursive:true});fs.writeFileSync(imagePath(p,name),bytes);return name;};
  const view=()=>({application:'game-builder',projects:db.projects.map(p=>({...p,storyAnalysisStale:!!p.storyAnalysis&&p.storyAnalysis.storyHash!==storyHash(p.story)})),jobs:db.jobs.slice(-40).reverse(),settings:{...config,keyConfigured:!!key,keySaved:fs.existsSync(path.join(root,'meta-key.dpapi')),keyWarning},hardware:{...gpu,ramGB:Math.round(os.totalmem()/1073741824),os:process.platform},readiness:localReadiness(config,gpu),dataDirectory:root});
  async function execute(job,signal){
    const p=project(job.projectId);job.status='running';job.startedAt=new Date().toISOString();save();
    const timed=ms=>AbortSignal.any([signal,AbortSignal.timeout(ms)]);
    if(job.type==='story'){
      job.message='Muse Spark is reading your story and identifying the cast, locations and scenes.';save();
      const analysis=await provider.analyseStory(structuredClone(p),{key,model:config.sparkModel,signal:timed(240000)});signal.throwIfAborted();
      Object.assign(p,mergeStoryAnalysis(p,analysis));
    }else if(job.type==='plan'){
      job.message='Muse Spark is planning the asset pack.';save();
      const plan=await provider.planAssets(structuredClone(p),{key,model:config.sparkModel,signal:timed(180000)});signal.throwIfAborted();
      p.title=plan.title;p.summary=plan.summary;p.styleGuide=plan.styleGuide;
      for(const a of plan.assets)p.assets.push({...a,id:randomUUID(),files:{},createdAt:new Date().toISOString()});
    }else if(job.type==='images'){
      for(let i=0;i<job.assetIds.length;i++){
        signal.throwIfAborted();const a=asset(p,job.assetIds[i]);job.message='Muse Image: '+a.name+' ('+(i+1)+'/'+job.assetIds.length+')';save();
        let reference;
        if(job.refine&&a.files.source){const name=a.files.source;reference='data:'+MIME[path.extname(name)]+';base64,'+fs.readFileSync(imagePath(p,name)).toString('base64');}
        else if(a.referenceAssetId){const parent=asset(p,a.referenceAssetId);if(!parent.files.source)throw error('Generate the base character design first.');const name=parent.files.source;reference='data:'+MIME[path.extname(name)]+';base64,'+fs.readFileSync(imagePath(p,name)).toString('base64');}
        const bytes=await provider.generateImage({...a,prompt:job.refine?job.instruction:a.prompt},p,{key,model:config.imageModel,signal:timed(300000),reference});signal.throwIfAborted();
        const name=writeFile(p,bytes,'png');a.versions=[...(a.versions||[]),{files:a.files,at:new Date().toISOString()}].filter(v=>v.files.source);a.files={source:name};a.generatedBy=config.imageModel;a.updatedAt=new Date().toISOString();job.completed=i+1;save();
      }
    }else if(job.type==='compose'){
      job.message='Muse Spark is arranging your scene.';save();const compositionProject=job.storySceneIndex===undefined?p:storySceneProject(p,job.storySceneIndex);p.scene=await provider.composeScene(compositionProject,{key,model:config.sparkModel,signal:timed(180000)});signal.throwIfAborted();
    }else if(['cutout','mesh','body'].includes(job.type)){
      const a=asset(p,job.assetIds[0]),is3d=job.type==='mesh',isBody=job.type==='body',ready=localReadiness(config,gpu);
      if(!a.files.source)throw error('Generate or import an image first.');
      if(is3d&&!ready.threeReady)throw error(ready.threeMessage);
      if(isBody&&!ready.bodyConfigured)throw error(ready.bodyMessage);
      if(!is3d&&!isBody&&!ready.samConfigured)throw error(ready.samMessage);
      if(is3d&&!a.files.mask)throw error('Create a SAM cutout before reconstructing a 3D object.');
      const reqFile=path.join(projectDir(p.id),job.id+'.job.json');
      const outputId=randomUUID(),prefix=path.join(projectDir(p.id),outputId);
      const request={operation:job.type,experimental:config.threeMode==='experimental',image:imagePath(p,a.files.source),outputPrefix:prefix,label:a.objectLabel||a.name,checkpoint:isBody?config.bodyCheckpoint:config.samCheckpoint,mhr:config.bodyMhr,repo:isBody?config.bodyRepo:is3d?config.threeRepo:config.samRepo,pipeline:config.threeConfig,mask:is3d?imagePath(p,a.files.mask):undefined};
      const useWSL=config.workerRuntime==='wsl'&&process.platform==='win32';
      atomic(reqFile,request);job.message=isBody?'SAM 3D Body is estimating one human body on this PC.':is3d?'SAM 3D Objects is reconstructing a mesh on this PC.':'SAM 3 is finding “'+request.label+'” on this PC.';save();
      try{
        const localEnv={...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};delete localEnv.MODEL_API_KEY;delete localEnv.OPENAI_API_KEY;
        const worker=path.join(ROOT,'workers','sam_worker.py');
        let input='';
        if(useWSL)input=JSON.stringify({...request,imageData:fs.readFileSync(request.image).toString('base64'),maskData:request.mask?fs.readFileSync(request.mask).toString('base64'):undefined});
        const command=workerCommand(config,isBody?config.bodyPython:is3d?config.threePython:config.samPython,useWSL?['-c',fs.readFileSync(worker,'utf8'),'--stdio']:[worker,'--request',reqFile]);
        const raw=await runProcess(command.executable,command.args,{input,signal,timeout:30*60*1000,env:localEnv,maxOutput:96*1024*1024});signal.throwIfAborted();
        const line=raw.split(/\r?\n/).reverse().find(l=>l.startsWith('STUDIO_RESULT '));if(!line)throw new Error('Local worker returned no result.');
        const result=JSON.parse(line.slice(14));if(result.error)throw new Error(result.error);
        for(const [kind,file] of Object.entries(result.files||{})){
          if(useWSL){
            if(!['cutout','mask','model','bodyModel','splat'].includes(kind)||typeof file.data!=='string')throw new Error('Invalid output from WSL worker.');
            const bytes=Buffer.from(file.data,'base64'),ext={cutout:'png',mask:'png',model:'glb',bodyModel:'glb',splat:'ply'}[kind];
            if(bytes.length>64*1024*1024||!bytes.length)throw new Error('Local output exceeds file limits.');
            if((ext==='png'&&imageExtension(bytes)!=='png')||(ext==='glb'&&bytes.toString('ascii',0,4)!=='glTF')||(ext==='ply'&&bytes.toString('ascii',0,3)!=='ply'))throw new Error('Local worker returned an invalid file.');
            a.files[kind]=writeFile(p,bytes,ext);continue;
          }
          if(!['cutout','mask','model','bodyModel','splat'].includes(kind)||!FILE.test(file)||!fs.existsSync(imagePath(p,file)))throw new Error('Invalid output from local worker.');
          a.files[kind]=file;
        }
        if(is3d&&!a.files.model)throw new Error('SAM produced no GLB mesh.');
        if(isBody&&!a.files.bodyModel)throw new Error('SAM 3D Body produced no body mesh.');
        if(!is3d&&!isBody&&!a.files.cutout)throw new Error('SAM found no cutout. Try a more specific object label.');
      }finally{fs.rmSync(reqFile,{force:true});}
    }
    p.updatedAt=new Date().toISOString();job.status='completed';job.message='Finished. Saved to this PC.';job.finishedAt=p.updatedAt;save();
  }
  async function drain(){
    if(draining||closing)return;draining=true;
    try{for(let job;(job=db.jobs.find(j=>j.status==='queued'))&&!closing;){
      const ctrl=new AbortController();running.set(job.id,ctrl);
      try{await execute(job,ctrl.signal);}catch(e){job.status=ctrl.signal.aborted?'cancelled':'failed';job.message=ctrl.signal.aborted?'Cancelled. Completed files were kept.':clean(e.message,1200).replaceAll(key||'__no_key__','[redacted]');job.finishedAt=new Date().toISOString();save();}finally{running.delete(job.id);}
    }}finally{draining=false;}
  }
  function enqueue(body){
    const p=project(body.projectId),type=body.type;
    if(!['story','plan','images','compose','cutout','mesh','body'].includes(type))throw error('Unknown operation.');
    if(db.jobs.some(j=>j.projectId===p.id&&['queued','running'].includes(j.status)))throw error('This project already has an active operation.',409);
    if(['story','plan','images','compose'].includes(type)&&!key)throw error('Add your Meta Model API key in Settings first.',409);
    if(type==='story'&&(!p.story||p.story.trim().length<40))throw error('Paste a story or chapter with at least 40 characters.');
    if(type==='compose'&&body.storySceneIndex!==undefined){try{storySceneProject(p,body.storySceneIndex);}catch(e){throw error(e.message);}}
    if(type==='plan'&&(p.brief.length<20||p.assets.length>180))throw error('Describe your game in at least 20 characters. Keep each pack below 200 assets.');
    const ids=Array.isArray(body.assetIds)?[...new Set(body.assetIds)]:[];
    if(['images','cutout','mesh','body'].includes(type)&&(!ids.length||ids.length>8))throw error('Select between one and eight assets.');
    ids.forEach(id=>asset(p,id));
    if(['cutout','mesh','body'].includes(type)&&ids.length!==1)throw error('Select one asset for local processing.');
    if(type==='body'&&(asset(p,ids[0]).kind!=='character'||!body.singleHumanConfirmed))throw error('SAM 3D Body needs a single human character image. Confirm this in the body dialog.');
    if(type==='body'&&!localReadiness(config,gpu).bodyConfigured)throw error(localReadiness(config,gpu).bodyMessage,409);
    if(type==='mesh'&&!localReadiness(config,gpu).threeReady)throw error(localReadiness(config,gpu).threeMessage,409);
    if(type==='cutout'&&!localReadiness(config,gpu).samConfigured)throw error(localReadiness(config,gpu).samMessage,409);
    if(body.refine&&(!clean(body.instruction)||ids.length!==1||!asset(p,ids[0]).files.source))throw error('Choose one existing image and describe your change.');
    const job={id:randomUUID(),projectId:p.id,type,storySceneIndex:type==='compose'?body.storySceneIndex:undefined,assetIds:ids,refine:!!body.refine,instruction:clean(body.instruction),status:'queued',message:'Waiting to start.',createdAt:new Date().toISOString(),completed:0};db.jobs.push(job);if(db.jobs.length>200)db.jobs.splice(0,db.jobs.length-200);save();setImmediate(drain);return job;
  }
  const server=http.createServer(async(req,res)=>{
    const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
    Object.entries(security).forEach(([k,v])=>res.setHeader(k,v));
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try{
      const actualPort=server.address()?.port,allowedHosts=['127.0.0.1:'+actualPort,'localhost:'+actualPort];
      if(!allowedHosts.includes(req.headers.host))throw error('Only local studio access is allowed.',403);
      const origin=req.headers.origin;
      if(origin&&!allowedHosts.some(h=>origin==='http://'+h))throw error('Cross-site requests are not allowed.',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw error('Cross-site requests are not allowed.',403);
      const url=new URL(req.url,'http://127.0.0.1'),route=url.pathname;
      let body;
      if(['POST','PATCH','DELETE'].includes(req.method)){
        const supplied=Buffer.from(String(req.headers['x-studio-token']||'')),expected=Buffer.from(csrf);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw error('Reload this studio tab before making changes.',403);
        if(!String(req.headers['content-type']).startsWith('application/json'))throw error('JSON is required.',415);
        const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>42*1024*1024)throw error('Upload exceeds 30 MB.',413);chunks.push(c);}try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw error('Invalid JSON.');}
      }
      if(route==='/api/state'&&req.method==='GET')return json({...view(),csrf});
      if(route==='/api/settings'&&req.method==='POST'){
        const next={...config};
        for(const k of Object.keys(DEFAULTS))if(k in body)next[k]=clean(body[k],1000);
        if(!/^muse-spark-[a-z0-9.-]+$/.test(next.sparkModel)||!/^muse-image-[a-z0-9.-]+$/.test(next.imageModel))throw error('Use a Muse Spark model and a Muse Image model.');
        if(!['official','experimental'].includes(next.threeMode)||!['native','wsl'].includes(next.workerRuntime)||!/^[-a-zA-Z0-9_.]+$/.test(next.wslDistro))throw error('Invalid local runtime settings.');
        const keyPath=path.join(root,'meta-key.dpapi');
        if(body.clearKey){key='';fs.rmSync(keyPath,{force:true});}
        else if(clean(body.apiKey,4096)){
          const candidate=clean(body.apiKey,4096);if(/[\r\n]/.test(candidate))throw error('Invalid API key.');
          if(body.remember)fs.writeFileSync(keyPath,await protectKey(candidate),{mode:0o600});else fs.rmSync(keyPath,{force:true});
          key=candidate;keyWarning='';
        }
        config=next;atomic(configPath,config);return json(view());
      }
      if(route==='/api/local-check'&&req.method==='POST'){
        const mesh=body.type==='mesh',human=body.type==='body',python=human?config.bodyPython:mesh?config.threePython:config.samPython;
        if(!python)throw error('Set the '+(mesh?'3D':'SAM')+' Python executable in Settings.');
        const worker=path.join(ROOT,'workers','sam_worker.py');
        const repo=human?config.bodyRepo:mesh?config.threeRepo:config.samRepo;
        const checkArgs=['--check',...(mesh?['--three']:[]),...(human?['--body']:[]),...(repo?['--repo',repo]:[])];
        const command=workerCommand(config,python,config.workerRuntime==='wsl'&&process.platform==='win32'?['-c',fs.readFileSync(worker,'utf8'),...checkArgs]:[worker,...checkArgs]);
        const localEnv={...process.env};delete localEnv.MODEL_API_KEY;delete localEnv.OPENAI_API_KEY;
        const check=JSON.parse(await runProcess(command.executable,command.args,{timeout:30000,env:localEnv}));return json(check);
      }
      if(route==='/api/projects'&&req.method==='POST'){
        if(db.projects.length>=100)throw error('This library supports up to 100 projects.');
        if(typeof body.story==='string'&&body.story.length>80000)throw error('Use a story or chapter under 80,000 characters.');
        const now=new Date().toISOString(),p={id:randomUUID(),title:clean(body.title,100)||'Untitled story',story:clean(body.story,80000),brief:clean(body.brief,10000),style:clean(body.style,100)||'Painterly fantasy',engine:clean(body.engine,100)||'Godot',count:Math.min(8,Math.max(1,Number(body.count)||4)),summary:'',styleGuide:'',assets:[],scene:null,createdAt:now,updatedAt:now};db.projects.push(p);save();return json(p,201);
      }
      const match=route.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(assets|scene|export|variants))?(?:\/([a-f0-9-]{36}))?$/);
      if(match){const p=project(match[1]);
        if(req.method==='PATCH'&&!match[2]){
          if(db.jobs.some(j=>j.projectId===p.id&&['queued','running'].includes(j.status)))throw error('Wait for the current operation before editing this project.',409);
          if('story'in body){if(typeof body.story!=='string'||body.story.length>80000)throw error('Use a story or chapter under 80,000 characters.');p.story=body.story.trim();}
          for(const k of ['title','brief','style','engine','styleGuide'])if(k in body)p[k]=clean(body[k],k==='brief'?10000:k==='styleGuide'?4000:100);
          if('count'in body)p.count=Math.min(8,Math.max(1,Math.round(Number(body.count)||4)));p.updatedAt=new Date().toISOString();save();return json(p);
        }
        if(match[2]==='assets'&&req.method==='PATCH'&&match[3]){
          if(db.jobs.some(j=>j.projectId===p.id&&['queued','running'].includes(j.status)))throw error('Wait for the current operation before editing assets.',409);
          const a=asset(p,match[3]);for(const k of ['name','prompt','objectLabel'])if(k in body)a[k]=clean(body[k],k==='prompt'?5000:200);save();return json(a);
        }
        if(match[2]==='variants'&&req.method==='POST'){
          if(db.jobs.some(j=>j.projectId===p.id&&['queued','running'].includes(j.status)))throw error('Wait for the current operation before adding a variation.',409);
          const parent=asset(p,body.assetId),expression=clean(body.expression,300);
          if(parent.kind!=='character'||!parent.files.source||!expression)throw error('Choose a generated character and describe the expression or pose.');
          if(p.assets.length>=200)throw error('This project already contains 200 designs.');
          const variant={id:randomUUID(),name:clean(parent.name+' — '+expression,100),kind:'character',prompt:clean('Same character as the reference. Preserve face, species, age, body proportions, hair, outfit and palette. Change only: '+expression+'. Original design: '+parent.prompt,5000),objectLabel:parent.objectLabel,notes:'Character variation: '+expression,character:parent.character?structuredClone(parent.character):undefined,referenceAssetId:parent.id,files:{},createdAt:new Date().toISOString()};
          p.assets.push(variant);save();return json(variant,201);
        }
        if(match[2]==='assets'&&req.method==='POST'&&!match[3]){
          if(p.assets.length>=200)throw error('This pack already contains 200 assets.');
          const a={id:randomUUID(),name:clean(body.name,100)||'New asset',kind:['character','prop','environment','texture','interface'].includes(body.kind)?body.kind:'prop',prompt:clean(body.prompt),objectLabel:clean(body.objectLabel,200),notes:'',files:{},createdAt:new Date().toISOString()};
          if(body.image){const bytes=Buffer.from(String(body.image),'base64');if(bytes.length>30*1024*1024)throw error('Image exceeds 30 MB.');a.files.source=writeFile(p,bytes,imageExtension(bytes));a.generatedBy='Imported by you';}
          p.assets.push(a);save();return json(a,201);
        }
        if(match[2]==='scene'&&req.method==='POST'){p.scene=validateScene(body,p.assets);save();return json(p.scene);}
        if(match[2]==='export'&&req.method==='GET'){
          const entries=[{name:'project.json',data:JSON.stringify(p,null,2)},{name:'story.txt',data:p.story||''},{name:'story-breakdown.json',data:JSON.stringify(p.storyAnalysis||null,null,2)},{name:'README.txt',data:'Game Builder export\nOriginal story, extracted cast/locations/scenes, linked designs, PNG/JPEG/WebP images, optional SAM masks/cutouts, optional GLB/PLY outputs, and project.json.\nScene positions are percentage coordinates relative to a 16:9 canvas. Import images/GLB into your engine. Meshes may require retopology, rigging and material cleanup; they are not automatically game-ready.\n'}];let total=0;
          for(const a of p.assets)for(const [kind,name]of Object.entries(a.files)){const file=imagePath(p,name);const size=fs.statSync(file).size;total+=size;if(total>200*1024*1024)throw error('Pack exceeds the 200 MB ZIP limit. Copy files from the local data folder instead.');entries.push({name:'assets/'+a.id+'/'+kind+path.extname(name),data:fs.readFileSync(file)});}
          const zip=makeZip(entries);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="asset-pack-'+p.id+'.zip"'});res.end(zip);return;
        }
      }
      if(route==='/api/jobs'&&req.method==='POST')return json(enqueue(body),202);
      if(route==='/api/cancel'&&req.method==='POST'){
        const j=db.jobs.find(j=>j.id===body.id);if(!j)throw error('Job not found.',404);if(j.status==='queued'){j.status='cancelled';j.message='Cancelled before starting.';save();}running.get(j.id)?.abort();return json({ok:true});
      }
      if(req.method==='GET'&&route.startsWith('/files/')){
        const parts=route.split('/');if(parts.length!==4)throw error('File not found.',404);const p=project(parts[2]);const name=parts[3];
        if(!p.assets.some(a=>Object.values(a.files).includes(name)))throw error('File not found.',404);
        const file=imagePath(p,name);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(res);return;
      }
      if(req.method==='GET'&&!route.startsWith('/api/')){
        const relative=route==='/'?'index.html':decodeURIComponent(route.slice(1));
        const file=path.resolve(ROOT,'public',relative),publicRoot=path.join(ROOT,'public')+path.sep;
        if(!file.startsWith(publicRoot)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error('Page not found.',404);
        res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);return;
      }
      throw error('Route not found.',404);
    }catch(e){if(!res.headersSent)json({error:e.status?e.message:clean(e.message,1200).replaceAll(key||'__no_key__','[redacted]')},e.status||500);else res.end();}
  });
  server.requestTimeout=60000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,port:server.address().port,close:async()=>{closing=true;for(const c of running.values())c.abort();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createStudio();console.log('Game Builder: http://127.0.0.1:'+app.port);console.log('Local library: '+path.resolve(process.env.ASSET_STUDIO_DATA||path.join(ROOT,'data')));
  process.on('SIGINT',async()=>{await app.close();process.exit(0);});process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
