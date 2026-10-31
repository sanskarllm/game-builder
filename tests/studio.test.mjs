import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio,imageExtension} from '../server.mjs';
import {planAssets,generateImage,validatePlan,validateScene,imageBody,decodeImage,META_BASE} from '../lib/meta.mjs';
import {wslPath,workerCommand,localReadiness,protectKey} from '../lib/local.mjs';
import {makeZip} from '../lib/zip.mjs';
import {analyseStory,validateStoryAnalysis,mergeStoryAnalysis,storySceneProject} from '../lib/story.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.test-runs');fs.mkdirSync(base,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hQAAAABJRU5ErkJggg==','base64');
const plan={title:'Test forest',summary:'A sample pack.',styleGuide:'Moss and gold.',assets:[{name:'Lantern',kind:'prop',prompt:'A brass lantern on a plain background.',objectLabel:'lantern',notes:'Whole object.'}]};
async function harness(t,provider){
  const dir=fs.mkdtempSync(path.join(base,'run-'));let app=await createStudio({dataDir:dir,port:0,gpuOverride:{name:'Test GPU',vramMB:12227},provider});
  const ctx={dir,get app(){return app;},url:()=> 'http://127.0.0.1:'+app.port,token:'',async refresh(){const r=await fetch(ctx.url()+'/api/state');const s=await r.json();ctx.token=s.csrf;return s;},async call(route,body,method='POST',extra={}){const r=await fetch(ctx.url()+route,{method,headers:{'Content-Type':'application/json','X-Studio-Token':ctx.token,...extra},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},async restart(){await app.close();app=await createStudio({dataDir:dir,port:0,gpuOverride:{name:'Test GPU',vramMB:12227},provider});await ctx.refresh();}};
  t.after(async()=>{await app.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(base+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});await ctx.refresh();return ctx;
}
async function finished(ctx){for(let i=0;i<100;i++){const state=await ctx.refresh();if(!state.jobs.some(j=>['running','queued'].includes(j.status)))return state;await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish.');}
test('Meta planner uses only the Meta endpoint, validates and parses the structured plan',async()=>{
  const calls=[];const result=await planAssets({brief:'Test forest game assets',count:4,style:'Painterly',engine:'Godot',assets:[]},{key:'fake-secret',model:'muse-spark-1.3',fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}));}});
  assert.equal(result.assets[0].name,'Lantern');assert.equal(calls[0].url,META_BASE+'/chat/completions');assert.equal(calls[0].opts.headers.Authorization,'Bearer fake-secret');assert.equal(JSON.parse(calls[0].opts.body).response_format.type,'json_schema');
});
test('Muse image generation and refinement preserve references and accept PNG outputs',async()=>{
  const body=imageBody(plan.assets[0],plan,'muse-image-1.0','data:image/png;base64,x');assert.equal(body.input[0].content[1].type,'input_image');assert.equal(body.tools[0].enable_web_search,false);
  const output=await generateImage(plan.assets[0],plan,{key:'fake',model:'muse-image-1.0',fetchImpl:async(url)=>{assert.equal(url,'https://api.meta.ai/v1/responses');return new Response(JSON.stringify({status:'completed',output:[{type:'image_generation_call',result:png.toString('base64')}]}));}});assert.deepEqual(output,png);
  assert.throws(()=>decodeImage({status:'incomplete',output:[]}));assert.throws(()=>decodeImage({output:[{type:'image_generation_call',result:Buffer.from('<html>').toString('base64')}]}));
});
test('Untrusted model output cannot reference unknown assets or exceed pack bounds',()=>{
  assert.throws(()=>validatePlan({...plan,assets:Array(9).fill(plan.assets[0])}));assert.throws(()=>validatePlan({...plan,assets:[{...plan.assets[0],kind:'shell'}]}));
  assert.throws(()=>validateScene({description:'x',backgroundAssetId:'',layers:[{assetId:'unknown',x:0,y:0,width:1,rotation:0,z:0}]},[]));
});
test('Mutations require a token and reject cross-origin requests; secrets never enter state',async t=>{
  const ctx=await harness(t);assert.equal((await ctx.call('/api/projects',{},'POST',{'X-Studio-Token':''})).status,403);
  assert.equal((await ctx.call('/api/projects',{},'POST',{Origin:'https://evil.example'})).status,403);
  assert.equal((await ctx.call('/api/settings',{apiKey:'test-meta-key-123',remember:false})).status,200);
  const s=await ctx.refresh();assert.equal(s.settings.keyConfigured,true);assert.ok(!JSON.stringify(s).includes('test-meta-key-123'));assert.ok(!fs.readFileSync(path.join(ctx.dir,'settings.json'),'utf8').includes('test-meta-key-123'));
  assert.equal((await ctx.call('/api/jobs',{type:'mcp',projectId:'no'})).status,404);
});
test('Projects, imported images and scene layouts survive a full server restart; ZIP excludes secrets',async t=>{
  const ctx=await harness(t);const created=await ctx.call('/api/projects',{title:'Forest',brief:'A forest pack for a game.'});const id=created.body.id;
  const added=await ctx.call('/api/projects/'+id+'/assets',{name:'Tree',kind:'prop',image:png.toString('base64')});assert.equal(added.status,201);
  await ctx.call('/api/projects/'+id+'/scene',{description:'One tree.',backgroundAssetId:'',layers:[{assetId:added.body.id,x:50,y:50,width:20,rotation:0,z:1}]});await ctx.restart();const s=await ctx.refresh();assert.equal(s.projects[0].assets.length,1);assert.equal(s.projects[0].scene.layers[0].x,50);
  const bytes=Buffer.from(await (await fetch(ctx.url()+'/files/'+id+'/'+added.body.files.source)).arrayBuffer());assert.deepEqual(bytes,png);
  const zip=Buffer.from(await (await fetch(ctx.url()+'/api/projects/'+id+'/export')).arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('project.json')));assert.ok(!zip.includes(Buffer.from('settings.json')));
  assert.equal((await fetch(ctx.url()+'/api/mcp')).status,404);
});
test('AI jobs persist successful files and preserve them after a later provider failure',async t=>{
  let calls=0;const ctx=await harness(t,{planAssets:async()=>structuredClone(plan),generateImage:async()=>{calls++;if(calls>1)throw new Error('Provider test failure');return png;},composeScene:async()=>({description:'Scene',backgroundAssetId:'',layers:[]})});
  await ctx.call('/api/settings',{apiKey:'mock-only',remember:false});const id=(await ctx.call('/api/projects',{brief:'Create a forest game asset pack.'})).body.id;
  assert.equal((await ctx.call('/api/jobs',{projectId:id,type:'plan'})).status,202);let s=await finished(ctx);const aid=s.projects[0].assets[0].id;
  await ctx.call('/api/jobs',{projectId:id,type:'images',assetIds:[aid]});s=await finished(ctx);const source=s.projects[0].assets[0].files.source;assert.ok(source);assert.equal(s.jobs[0].status,'completed');
  await ctx.call('/api/jobs',{projectId:id,type:'images',assetIds:[aid]});s=await finished(ctx);assert.equal(s.jobs[0].status,'failed');assert.equal(s.projects[0].assets[0].files.source,source);
  await ctx.restart();s=await ctx.refresh();assert.equal(s.projects[0].assets[0].files.source,source);
});
test('Cancel active jobs without creating fake image outputs',async t=>{
  const ctx=await harness(t,{planAssets:async(_p,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')));}),generateImage:async()=>png});
  await ctx.call('/api/settings',{apiKey:'fake',remember:false});const id=(await ctx.call('/api/projects',{brief:'A long enough brief for cancellation.'})).body.id;const job=(await ctx.call('/api/jobs',{projectId:id,type:'plan'})).body;
  await ctx.call('/api/cancel',{id:job.id});const s=await finished(ctx);assert.equal(s.jobs[0].status,'cancelled');assert.equal(s.projects[0].assets.length,0);
});
test('WSL arguments keep paths with spaces intact and experimental mode does not bypass setup',()=>{
  assert.equal(wslPath('C:\\Users\\Test User\\asset.png'),'/mnt/c/Users/Test User/asset.png');assert.throws(()=>wslPath('../bad'));
  const cmd=workerCommand({workerRuntime:'wsl',wslDistro:'PCMClawUbuntu'},'/env/bin/python',['C:\\Studio Folder\\worker.py','--check']);if(process.platform==='win32'){assert.equal(cmd.executable,'wsl.exe');assert.ok(cmd.args.includes('/mnt/c/Studio Folder/worker.py'));assert.ok(cmd.args.includes('--check'));}
  const ready=localReadiness({threeMode:'experimental',workerRuntime:'wsl',threePython:'',threeRepo:'',threeConfig:''},{vramMB:12227});assert.equal(ready.threeReady,false);assert.equal(ready.threeExperimental,true);
});
test('Image import rejects active content and ZIP is a bounded standard archive',()=>{assert.throws(()=>imageExtension(Buffer.from('<svg/>')));assert.equal(imageExtension(png),'png');const zip=makeZip([{name:'hello.txt',data:'world'}]);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);});
test('Windows credential encryption round trips without plaintext', {skip:process.platform!=='win32'},async()=>{const encoded=await protectKey('non-secret-test-value');assert.ok(!encoded.includes('non-secret-test-value'));assert.equal(await protectKey(encoded,true),'non-secret-test-value');});

const story='Mira wore a red coat. She met Tomas at the lantern shop. Tomas adjusted his round glasses. Together they planned to find the lost bridge.';
const breakdown={title:'The Lost Bridge',summary:'Mira and Tomas meet at the lantern shop.',styleGuide:'Warm painterly illustration.',characters:[{name:'Mira',aliases:['The traveller'],role:'Protagonist',species:'human',appearance:'Not specified in the story',personality:'Not specified in the story',outfit:'Red coat',proposedDetails:['A brown satchel'],sourceEvidence:['Mira wore a red coat.'],designPrompt:'One full-body human Mira, red coat, suggested brown satchel, plain background.',expressions:['Hopeful','Worried']},{name:'Tomas',aliases:[],role:'Clockmaker',species:'human',appearance:'Round glasses',personality:'Not specified in the story',outfit:'Not specified in the story',proposedDetails:[],sourceEvidence:['Tomas adjusted his round glasses.'],designPrompt:'One full-body human Tomas wearing round glasses on a plain background.',expressions:['Thoughtful']}],locations:[{name:'Lantern shop',description:'Meeting place',sourceEvidence:['at the lantern shop'],designPrompt:'Interior of a lantern shop, warm illustration, no characters.'}],scenes:[{title:'The meeting',summary:'Mira and Tomas plan their search.',locationName:'Lantern shop',characterNames:['Mira','Tomas'],props:['Round glasses']}],questions:['What color is Mira’s hair?']};
test('Story analysis calls Meta with actual story text and separates facts from design proposals',async()=>{
  const result=await analyseStory({story,brief:'Warm colors',style:'Painterly',engine:'Godot',assets:[]},{key:'fake',model:'muse-spark-1.3',fetchImpl:async(url,opts)=>{assert.equal(url,META_BASE+'/chat/completions');const b=JSON.parse(opts.body);assert.equal(JSON.parse(b.messages[1].content).story,story);assert.equal(b.response_format.json_schema.name,'story_design_breakdown');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(breakdown)}}]}));}});
  assert.equal(result.characters[0].outfit,'Red coat');assert.deepEqual(result.characters[0].proposedDetails,['A brown satchel']);
  const fake=structuredClone(breakdown);fake.characters[0].sourceEvidence=['Mira wore silver armour.'];assert.throws(()=>validateStoryAnalysis(fake,story),/citation/);
  const duplicate=structuredClone(breakdown);duplicate.characters[1].aliases=['Mira'];assert.throws(()=>validateStoryAnalysis(duplicate,story),/duplicate/);
  const unknown=structuredClone(breakdown);unknown.scenes[0].characterNames=['Unwritten stranger'];assert.throws(()=>validateStoryAnalysis(unknown,story),/unknown/);
});
test('Re-analysis matches aliases while retaining edited prompts, files and stable design identifiers',()=>{
  const p={story,assets:[],styleGuide:''};Object.assign(p,mergeStoryAnalysis(p,breakdown));const first=p.assets[0];first.prompt='User approved design';first.files.source='kept.png';
  const second=structuredClone(breakdown);second.characters[0].name='The traveller';second.characters[0].aliases=['Mira'];second.scenes[0].characterNames=['The traveller','Tomas'];
  Object.assign(p,mergeStoryAnalysis(p,second));assert.equal(p.assets.length,3);assert.equal(p.assets[0].id,first.id);assert.equal(p.assets[0].prompt,'User approved design');assert.equal(p.assets[0].files.source,'kept.png');assert.equal(p.storyAnalysis.characters[0].existingDesignKept,true);
});
test('Story scenes require their own illustrated cast and preserve exact story on restart/export',async t=>{
  const ctx=await harness(t,{analyseStory:async()=>structuredClone(breakdown)});await ctx.call('/api/settings',{apiKey:'mock',remember:false});
  const id=(await ctx.call('/api/projects',{story})).body.id;await ctx.call('/api/jobs',{type:'story',projectId:id});let s=await finished(ctx);assert.equal(s.projects[0].assets.length,3);
  assert.equal((await ctx.call('/api/jobs',{type:'compose',projectId:id,storySceneIndex:0})).status,400);
  await ctx.restart();s=await ctx.refresh();assert.equal(s.projects[0].story,story);assert.equal(s.projects[0].storyAnalysis.characters[0].name,'Mira');assert.equal(s.projects[0].storyAnalysisStale,false);
  const zip=Buffer.from(await (await fetch(ctx.url()+'/api/projects/'+id+'/export')).arrayBuffer());assert.ok(zip.includes(Buffer.from('story.txt')));assert.ok(zip.includes(Buffer.from('story-breakdown.json')));
  await ctx.call('/api/projects/'+id,{story:story+' A new chapter begins.'},'PATCH');s=await ctx.refresh();assert.equal(s.projects[0].storyAnalysisStale,true);
  assert.equal((await ctx.call('/api/projects/'+id,{story:'x'.repeat(80001)},'PATCH')).status,400);
  const p=structuredClone(s.projects[0]);p.story=story;for(const a of p.assets)a.files.source='test.png';p.assets.push({id:'unrelated',name:'Unrelated',files:{source:'unrelated.png'}});assert.equal(storySceneProject(p,0).assets.length,3);
});
test('Expression generation uses the base character as an image reference and preserves its source',async t=>{
  let sawReference=false;const ctx=await harness(t,{generateImage:async(_a,_p,options)=>{sawReference=options.reference.startsWith('data:image/png;base64,');return png;}});
  await ctx.call('/api/settings',{apiKey:'mock',remember:false});const id=(await ctx.call('/api/projects',{story})).body.id;
  const parent=(await ctx.call('/api/projects/'+id+'/assets',{name:'Mira',kind:'character',prompt:'Mira in a red coat',image:png.toString('base64')})).body;
  const variant=(await ctx.call('/api/projects/'+id+'/variants',{assetId:parent.id,expression:'Worried'})).body;
  assert.equal(variant.referenceAssetId,parent.id);await ctx.call('/api/jobs',{type:'images',projectId:id,assetIds:[variant.id]});const s=await finished(ctx);
  assert.equal(sawReference,true);assert.equal(s.projects[0].assets[0].files.source,parent.files.source);assert.ok(s.projects[0].assets[1].files.source);
  assert.equal((await ctx.call('/api/jobs',{type:'body',projectId:id,assetIds:[parent.id]})).status,400);
  assert.equal((await ctx.call('/api/jobs',{type:'body',projectId:id,assetIds:[parent.id],singleHumanConfirmed:true})).status,409);
});
