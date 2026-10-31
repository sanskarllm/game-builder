import {initStoryUI,renderStoryBreakdown} from './story-ui.js';
initStoryUI();
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,activeId=localStorage.getItem('asset-studio-project'),focusedId=null,view='story',filter='all',preview='source',selected=new Set(),lastProjects='',toastTimer,busy=false;
$('#sam-python').closest('.settings-section').insertAdjacentHTML('afterbegin','<div class="form-grid"><label>Local model runtime<select id="worker-runtime"><option value="wsl">WSL Linux on this PC</option><option value="native">Native Python</option></select></label><label>WSL distribution<input id="wsl-distro" value="PCMClawUbuntu"></label></div><p class="footnote">For WSL, enter Linux paths below. Selected images travel through a local pipe; no Windows drive mount is needed. The app and library remain on this PC.</p>');
$('#three-status').insertAdjacentHTML('beforebegin','<label>Memory profile<select id="three-mode"><option value="experimental">Experimental · stage offloading (~12 GB reported)</option><option value="official">Official · 32 GB or more</option></select></label>');
$('#three-status').parentElement.querySelector('.footnote').textContent='Experimental mode uses a pinned community fork that unloads stages to system RAM. A 12 GB GPU is borderline, and RTX 50-series dependency compatibility must be tested. Output is a GLB mesh and optional PLY splat; game optimization and rigging are separate.';
$('#three-config').closest('label').insertAdjacentHTML('afterend','<button type="button" class="button secondary" data-action="three-check">Check 3D environment</button><pre id="three-check-result" class="check-result" hidden></pre>');
$('[data-action="plan"]').insertAdjacentHTML('afterend','<button class="text-button" style="margin:12px 0" data-action="save-brief">Save brief without generating</button>');
for(const [id,value] of [['sam-python','/home/you/sam3-env/bin/python'],['sam-checkpoint','/home/you/models/sam3.pt'],['sam-repo','/home/you/script-sprite-models/sam3']])$('#'+id).placeholder=value;
const p=()=>state?.projects.find(x=>x.id===activeId);
const a=()=>p()?.assets.find(x=>x.id===focusedId);
const fileURL=(project,name)=>'/files/'+project.id+'/'+name;
const symbols={character:'♙',prop:'◇',environment:'⌂',texture:'▦',interface:'▣'};
const activeJob=()=>state?.jobs.find(j=>j.projectId===activeId&&['queued','running'].includes(j.status));
function toast(message,error=false){const t=$('#toast');t.textContent=message;t.className=error?'error':'';t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,error?12000:5000);}
async function api(route,body,method='POST'){
  const response=await fetch('/api'+route,{method:body===undefined?'GET':method,headers:body===undefined?{}:{'Content-Type':'application/json','X-Studio-Token':state.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed.');return result;
}
async function refresh(force=false){
  const next=await api('/state');const signature=JSON.stringify(next.projects);const changed=signature!==lastProjects;
  state=next;lastProjects=signature;
  if(!p()&&state.projects.length){activeId=state.projects[0].id;force=true;}
  if(force||changed){if(force)loadBrief();render();}else renderStatus();
}
function selectProject(id){activeId=id;localStorage.setItem('asset-studio-project',id);focusedId=null;selected.clear();preview='source';loadBrief();render();}
function loadBrief(){const project=p();$('#story').value=project?.story||'';$('#brief').value=project?.brief||'';$('#style').value=project?.style||'Painterly fantasy';$('#engine').value=project?.engine||'Godot';$('#count').value=project?.count||4;$('#count-label').textContent=$('#count').value+' assets';}
async function ensureProject(){if(p())return p();const created=await api('/projects',{title:'Untitled story'});await refresh();selectProject(created.id);return p();}
async function saveBrief(){const values={story:$('#story').value,brief:$('#brief').value,style:$('#style').value,engine:$('#engine').value,count:Number($('#count').value)};const project=await ensureProject();await api('/projects/'+project.id,values,'PATCH');await refresh();loadBrief();}
function renderStatus(){
  $('#gpu-label').textContent=state.hardware.name+' · '+Math.round(state.hardware.vramMB/1024)+' GB';
  $('#asset-count').textContent=p()?.assets.length||0;$('#job-count').textContent=state.jobs.filter(j=>['queued','running'].includes(j.status)).length;
  const banner=$('#connection-banner');banner.hidden=!!state.settings.keyConfigured;
  if(!banner.hidden)banner.innerHTML='<span>✦</span><span>Connect your Meta API key to start creating. Your library stays on this PC.</span><button class="text-button" data-action="settings">Open settings ↗</button>';
  const job=activeJob(),jobBanner=$('#job-banner');jobBanner.hidden=!job;
  if(job)jobBanner.innerHTML='<span class="spinner"></span><span>'+esc(job.message)+'</span><button class="text-button" data-cancel="'+job.id+'">Cancel</button>';
  const briefChanged=$('#story').value!==(p()?.story||'')||$('#brief').value!==(p()?.brief||'')||$('#style').value!==(p()?.style||'Painterly fantasy')||$('#engine').value!==(p()?.engine||'Godot');
  $('#story-count').textContent=$('#story').value.length.toLocaleString()+' / 80,000 characters';
  $('#save-status').textContent=job?'Working · files saved as completed':briefChanged?'Story has unsaved changes':'Saved on your PC';
  $('#generate-button').textContent=selected.size?'Generate selected ('+selected.size+')':'Generate selected';
  $('#generate-button').disabled=!selected.size||!!job||busy;
  $('[data-action="plan"]').disabled=!!job||busy;
  $('[data-action="analyse-story"]').disabled=!!job||busy;
  $('[data-action="save-story"]').disabled=!!job||busy;
  $('#export-button').disabled=!p();
  if(view==='jobs')renderJobs();
}
function render(){
  const project=p();
  $('#project-list').innerHTML=state.projects.map(x=>'<button class="project-item '+(x.id===activeId?'active':'')+'" data-project="'+x.id+'" title="'+esc(x.title)+'"><i>◇</i><span>'+esc(x.title)+'</span></button>').join('');
  $('#project-title').textContent=project?.title||'Every character starts with a story.';
  $('#project-subtitle').textContent=project?.summary||'Write the story. Discover the cast. Bring them to life.';
  $('#library-count').textContent=project?.assets.length||0;
  if(project&&!a()&&project.assets.length)focusedId=project.assets[0].id;
  selected=new Set([...selected].filter(id=>project?.assets.some(x=>x.id===id)));
  renderPreview();renderLibrary();renderScene();renderStoryBreakdown(project,esc);renderStatus();
  const guide=$('#style-guide');guide.hidden=!project?.styleGuide;if(!guide.hidden)guide.innerHTML='<h3>YOUR SHARED ART DIRECTION</h3><p>'+esc(project.styleGuide)+'</p>';
}
function renderPreview(){
  const asset=a(),project=p(),box=$('#asset-preview');
  $('#preview-label').textContent=asset?asset.name.toUpperCase():'YOUR CREATIVE CANVAS';
  $$('#preview-switch button').forEach(b=>{b.classList.toggle('active',b.dataset.preview===preview);b.disabled=!asset?.files[b.dataset.preview];});
  if(!asset){box.innerHTML='<div class="empty-preview"><img src="/sample-world.webp" alt="Painterly fantasy village studio illustration"><span class="sample-label">STUDIO ILLUSTRATION · YOUR ASSETS APPEAR HERE</span><span class="float-star">✦</span><p class="preview-overline">IMAGINE SOMETHING WONDERFUL</p><h2>A small idea.<br>An entire world.</h2><p>Characters with personality. Places to explore. Every little detail, made yours.</p></div>';$('#asset-details').innerHTML='';return;}
  const image=asset.files[preview]||asset.files.source;
  box.innerHTML=image?'<img src="'+fileURL(project,image)+'" alt="'+esc(asset.name)+'">':'<div class="no-preview"><span>'+symbols[asset.kind]+'</span><h2>'+esc(asset.name)+'</h2><p>Your plan is ready. Select this asset below and generate its first image with Muse Image.</p></div>';
  const job=activeJob(),disabled=job?' disabled':'';
  let links='';for(const kind of ['source','cutout','mask','model','splat'])if(asset.files[kind])links+='<a class="button subtle" href="'+fileURL(project,asset.files[kind])+'" download="'+esc(asset.name.replace(/[^a-z0-9 -]/gi,'').trim()||'asset')+'-'+kind+'.'+asset.files[kind].split('.').pop()+'">↓ '+({source:'Image',cutout:'Cutout',mask:'Mask',model:'GLB mesh',splat:'PLY splat'}[kind])+'</a>';
  $('#asset-details').innerHTML='<div class="asset-detail-top"><h3>'+esc(asset.name)+'</h3><small>'+esc(asset.generatedBy||'Planned asset')+'</small></div><div class="asset-detail-actions"><button class="button subtle" data-action="edit-asset"'+disabled+'>Edit prompt ↗</button>'+(asset.files.source?'<button class="button subtle" data-action="refine"'+disabled+'>✦ Refine image</button><button class="button subtle" data-action="cutout"'+disabled+'>✂ SAM cutout</button><button class="button subtle" data-action="mesh"'+disabled+'>◇ Create 3D</button>':'')+'</div><p class="asset-prompt">'+esc(asset.prompt)+'</p>'+(asset.files.source?'<div class="asset-detail-actions" style="margin-top:14px">'+links+'</div>':'')+(asset.files.source&&!state.readiness.threeReady?'<p class="local-note">3D setup: '+esc(state.readiness.threeMessage)+'</p>':'');
  if(asset.kind==='character'&&asset.files.source)$('#asset-details .asset-detail-actions').insertAdjacentHTML('beforeend','<button class="button subtle" data-action="variant"'+disabled+'>＋ Create expression</button>');
  if(asset.kind==='character'&&asset.files.source)$('#asset-details .asset-detail-actions').insertAdjacentHTML('beforeend','<button class="button subtle" data-action="body"'+disabled+'>♙ Human body · SAM 3D</button>');
  if(asset.files.bodyModel)$('#asset-details').insertAdjacentHTML('beforeend','<a class="button subtle" href="'+fileURL(project,asset.files.bodyModel)+'" download="human-body.glb">↓ Human body GLB</a><p class="body-note">Untextured body-shape mesh. Clothing, materials and rig export are separate.</p>');
}
function renderLibrary(){
  const project=p(),assets=(project?.assets||[]).filter(x=>filter==='all'||x.kind===filter);
  if(!assets.length){$('#asset-grid').innerHTML='<div class="empty-library"><h3>'+(filter==='all'?'Your world is waiting.':'No '+esc(filter)+' assets yet.')+'</h3><p>Start with the creative brief, add an asset yourself, or import artwork you already have.</p></div>';return;}
  $('#asset-grid').innerHTML=assets.map(x=>'<article tabindex="0" role="button" aria-label="Preview '+esc(x.name)+'" class="asset-card '+(x.id===focusedId?'focused':'')+'" data-asset="'+x.id+'"><label title="Select for image generation"><input aria-label="Select '+esc(x.name)+'" type="checkbox" data-select="'+x.id+'" '+(selected.has(x.id)?'checked':'')+'></label><div class="card-visual">'+(x.files.source?'<img loading="lazy" src="'+fileURL(project,x.files.cutout||x.files.source)+'" alt="'+esc(x.name)+'">':'<span class="card-placeholder">'+symbols[x.kind]+'</span>')+'<span class="card-category">'+esc(x.kind)+'</span></div><div class="card-copy"><h3>'+esc(x.name)+'</h3><p>'+(x.files.model?'3D mesh available':x.files.cutout?'Cutout ready':x.files.source?'Image saved':'Ready to create')+'</p></div></article>').join('');
}
function renderJobs(){
  const jobs=state.jobs.filter(j=>j.projectId===activeId);
  $('#jobs-list').innerHTML=jobs.length?jobs.map(j=>'<article class="job-row"><span class="job-state '+j.status+'">'+esc(j.status)+'</span><div><b>'+({story:'Muse Spark · Story & cast',plan:'Muse Spark · Asset plan',images:'Muse Image · Artwork',compose:'Muse Spark · Scene composition',cutout:'SAM 3 · Local cutout',mesh:'SAM 3D Objects · Reconstruction',body:'SAM 3D Body · Human mesh'}[j.type])+'</b><p>'+esc(j.message)+'</p><small>'+new Date(j.createdAt).toLocaleString()+'</small></div>'+(['queued','running'].includes(j.status)?'<button class="text-button" data-cancel="'+j.id+'">Cancel</button>':'')+'</article>').join(''):'<div class="empty-library"><h3>A fresh canvas.</h3><p>Your generation and processing jobs will appear here.</p></div>';
}
function renderScene(){
  const project=p(),scene=project?.scene,canvas=$('#scene-canvas');
  if(!scene){canvas.innerHTML='<div class="scene-empty"><span>▧</span><p>Your assets, arranged into a scene.</p></div>';return;}
  const byId=new Map(project.assets.map(x=>[x.id,x]));let html='';
  const bg=byId.get(scene.backgroundAssetId);if(bg?.files.source)html='<img class="scene-bg" src="'+fileURL(project,bg.files.source)+'" alt="'+esc(bg.name)+'">';
  for(const l of [...scene.layers].sort((x,y)=>x.z-y.z)){const item=byId.get(l.assetId);if(!item?.files.source)continue;html+='<img class="scene-layer" draggable="false" data-layer="'+l.assetId+'" src="'+fileURL(project,item.files.cutout||item.files.source)+'" alt="'+esc(item.name)+'" style="left:'+l.x+'%;top:'+l.y+'%;width:'+l.width+'%;--rotation:'+l.rotation+'deg;z-index:'+l.z+'">';}
  canvas.innerHTML=html;$('#scene-description').textContent=scene.description;
}
function setView(next){const changed=view!==next;view=next;for(const name of ['story','assets','scene','jobs'])$('#'+name+'-view').hidden=name!==view;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='jobs')renderJobs();if(view==='scene')renderScene();if(changed)window.scrollTo(0,0);}
function openSettings(){
  const c=state.settings;$('#api-key').value='';$('#key-status').textContent=c.keyConfigured?(c.keySaved?'Key configured and encrypted for this Windows user.':'Key configured for this session/environment.'):'No Meta key configured yet.';
  for(const [id,key]of [['spark-model','sparkModel'],['image-model','imageModel'],['sam-python','samPython'],['sam-checkpoint','samCheckpoint'],['sam-repo','samRepo'],['three-python','threePython'],['three-repo','threeRepo'],['three-config','threeConfig']])$('#'+id).value=c[key]||'';
  if($('#three-mode'))$('#three-mode').value=c.threeMode||'official';if($('#worker-runtime'))$('#worker-runtime').value=c.workerRuntime||'native';if($('#wsl-distro'))$('#wsl-distro').value=c.wslDistro||'Ubuntu';
  for(const [id,key]of [['body-python','bodyPython'],['body-repo','bodyRepo'],['body-checkpoint','bodyCheckpoint'],['body-mhr','bodyMhr']])$('#'+id).value=c[key]||'';
  $('#body-status').textContent=state.readiness.bodyMessage;
  $('#three-status').textContent=state.readiness.threeMessage;$('#data-path').textContent='Local data folder: '+state.dataDirectory;$('#settings-dialog').showModal();
}
async function saveSettings(close=true){
  const body={apiKey:$('#api-key').value,remember:$('#remember-key').checked};
  for(const [id,key]of [['spark-model','sparkModel'],['image-model','imageModel'],['sam-python','samPython'],['sam-checkpoint','samCheckpoint'],['sam-repo','samRepo'],['three-python','threePython'],['three-repo','threeRepo'],['three-config','threeConfig'],['three-mode','threeMode'],['worker-runtime','workerRuntime'],['wsl-distro','wslDistro']])if($('#'+id))body[key]=$('#'+id).value;
  for(const [id,key]of [['body-python','bodyPython'],['body-repo','bodyRepo'],['body-checkpoint','bodyCheckpoint'],['body-mhr','bodyMhr']])body[key]=$('#'+id).value;
  await api('/settings',body);$('#api-key').value='';await refresh();if(close)$('#settings-dialog').close();toast('Settings saved on this PC.');
}
function openAsset(edit=false){const asset=edit?a():null;$('#editing-asset').value=asset?.id||'';$('#asset-name').value=asset?.name||'';$('#asset-kind').value=asset?.kind||'prop';$('#asset-kind').disabled=!!asset;$('#asset-prompt').value=asset?.prompt||'';$('#asset-label').value=asset?.objectLabel||'';$('#asset-dialog').showModal();}
async function startJob(type,extra={}){
  if(['story','plan','images','compose'].includes(type)&&!state.settings.keyConfigured){openSettings();toast('Add your Meta Model API key to continue.');return;}
  await api('/jobs',{projectId:p().id,type,...extra});await refresh();renderPreview();toast('Operation started. You can follow it in Activity.');
}
async function downloadScene(){
  const project=p(),scene=project?.scene;if(!scene)throw new Error('Compose a scene first.');
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');
  const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not load a scene image.'));image.src=src;});
  const bg=project.assets.find(x=>x.id===scene.backgroundAssetId);ctx.fillStyle='#eef2e7';ctx.fillRect(0,0,1920,1080);
  if(bg?.files.source){const image=await load(fileURL(project,bg.files.source));const ratio=Math.max(1920/image.width,1080/image.height),w=image.width*ratio,h=image.height*ratio;ctx.drawImage(image,(1920-w)/2,(1080-h)/2,w,h);}
  for(const l of [...scene.layers].sort((x,y)=>x.z-y.z)){const asset=project.assets.find(x=>x.id===l.assetId);if(!asset?.files.source)continue;const img=await load(fileURL(project,asset.files.cutout||asset.files.source));const w=1920*l.width/100,h=w*img.height/img.width;ctx.save();ctx.translate(l.x*19.2,l.y*10.8);ctx.rotate(l.rotation*Math.PI/180);ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();}
  canvas.toBlob(blob=>{const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='scene-board.png';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);},'image/png');
}
const actions={
  settings:()=>openSettings(),
  'new-project':async()=>{const created=await api('/projects',{title:'Untitled story'});await refresh();selectProject(created.id);setView('story');$('#story').focus();},
  'save-story':async()=>{await saveBrief();toast('Story saved on this PC.');},
  'analyse-story':async()=>{if($('#story').value.trim().length<40)throw new Error('Paste at least 40 characters of your story first.');await saveBrief();await startJob('story');},
  'import-story':()=>$('#story-upload').click(),
  'story-example':()=>{$('#story').value='At dusk, Mira reached the lantern shop. Her red coat was still wet from the crossing. Behind the counter, an elderly clockmaker named Tomas looked up from a silver pocket watch.\n\n"The bridge has vanished," Mira said. "My brother is still on the other side."\n\nTomas pushed his round glasses up his nose. "Then we must light the old beacon."\n\nThey climbed to the abandoned lighthouse. Mira carried a brass lantern while Tomas held the watch close to his ear. At the top, a small blue bird called Pip landed on the railing.\n\n"You are late," Pip chirped. Mira laughed for the first time that evening, and opened the lantern.';renderStatus();},
  variant:()=>{$('#variant-expression').value='';$('#variant-dialog').showModal();},
  body:()=>{if(!state.readiness.bodyConfigured){openSettings();throw new Error(state.readiness.bodyMessage);}$('#single-human').checked=false;$('#body-dialog').showModal();},
  'body-check':async()=>{await saveSettings(false);const result=await api('/local-check',{type:'body'});$('#body-check-result').hidden=false;$('#body-check-result').textContent=JSON.stringify(result,null,2);},
  plan:async()=>{await saveBrief();await startJob('plan');},
  'save-brief':async()=>{await saveBrief();toast('Brief saved on this PC.');},
  generate:async()=>{if(selected.size>8)throw new Error('Generate at most eight images at a time.');await startJob('images',{assetIds:[...selected]});},
  'add-asset':async()=>{await ensureProject();openAsset();},
  'edit-asset':()=>openAsset(true),
  import:()=>$('#image-upload').click(),
  refine:()=>{$('#refine-text').value='';$('#refine-dialog').showModal();},
  cutout:async()=>{if(!state.readiness.samConfigured){openSettings();throw new Error(state.readiness.samMessage);}await startJob('cutout',{assetIds:[a().id]});},
  mesh:async()=>{if(!state.readiness.threeReady){openSettings();throw new Error(state.readiness.threeMessage);}await startJob('mesh',{assetIds:[a().id]});},
  compose:async()=>{await ensureProject();await startJob('compose');},
  export:()=>{if(p())window.location.href='/api/projects/'+p().id+'/export';},
  'scene-export':downloadScene,
  'local-check':async()=>{await saveSettings(false);const result=await api('/local-check',{});$('#local-check-result').hidden=false;$('#local-check-result').textContent=JSON.stringify(result,null,2);},
  'three-check':async()=>{await saveSettings(false);const result=await api('/local-check',{type:'mesh'});$('#three-check-result').hidden=false;$('#three-check-result').textContent=JSON.stringify(result,null,2);},
  'forget-key':async()=>{await api('/settings',{clearKey:true});await refresh();$('#api-key').value='';$('#key-status').textContent='Meta key removed.';toast('Saved key removed.');}
};
document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a,[data-asset]');if(!target)return;
  try{
    if(target.dataset.close){$('#'+target.dataset.close).close();return;}
    if(target.dataset.view){setView(target.dataset.view);return;}
    if(target.dataset.characterDesign){focusedId=target.dataset.characterDesign;selected=new Set([focusedId]);filter='all';preview='source';setView('assets');render();return;}
    if(target.dataset.storyScene){await startJob('compose',{storySceneIndex:Number(target.dataset.storyScene)});setView('scene');return;}
    if(target.dataset.project){selectProject(target.dataset.project);return;}
    if(target.dataset.filter){filter=target.dataset.filter;$$('[data-filter]').forEach(b=>b.classList.toggle('active',b===target));renderLibrary();return;}
    if(target.dataset.preview){preview=target.dataset.preview;renderPreview();return;}
    if(target.dataset.example){$('#brief').value={cozy:'A cozy woodland shopkeeping game. I need a friendly fox shopkeeper, a little wooden shop, a mushroom lamp and a forest clearing. Warm hand-painted colors, soft morning light, consistent storybook proportions.',fantasy:'A fantasy adventure set in an ancient floating city. Create a young explorer, an enchanted compass, a stone portal and an island vista. Painterly style, moss green and warm gold palette.',space:'A welcoming science fiction outpost on a red desert planet. Create a mechanic character, a friendly cargo robot, a communications terminal and a station courtyard. Soft stylized shapes and turquoise accents.'}[target.dataset.example];return;}
    if(target.dataset.cancel){await api('/cancel',{id:target.dataset.cancel});await refresh();return;}
    if(target.dataset.asset&&!event.target.closest('label')){focusedId=target.dataset.asset;preview='source';renderPreview();renderLibrary();return;}
    if(target.dataset.action&&actions[target.dataset.action]){if(busy)return;busy=true;renderStatus();try{await actions[target.dataset.action]();}finally{busy=false;renderStatus();}}
  }catch(e){toast(e.message,true);}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-asset]')){e.preventDefault();e.target.click();}});
document.addEventListener('change',e=>{if(e.target.dataset.select){e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);renderStatus();}});
$('#count').addEventListener('input',()=>$('#count-label').textContent=$('#count').value+' assets');
for(const control of ['#story','#brief','#style','#engine','#count'])$(control).addEventListener('input',()=>renderStatus());
$('#story-upload').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(!/\.(txt|md)$/i.test(file.name)||file.size>500000)throw new Error('Choose a .txt or .md story under 500 KB.');const text=await file.text();if(text.length>80000)throw new Error('Import a chapter under 80,000 characters.');$('#story').value=text;renderStatus();toast('Story imported. Save or analyse it when ready.');}catch(err){toast(err.message,true);}finally{e.target.value='';}});
$('#variant-form').addEventListener('submit',async e=>{e.preventDefault();try{const item=await api('/projects/'+p().id+'/variants',{assetId:a().id,expression:$('#variant-expression').value});focusedId=item.id;selected=new Set([item.id]);$('#variant-dialog').close();await refresh();toast('Expression design added. Generate it using the original character as reference.');}catch(err){toast(err.message,true);}});
$('#body-form').addEventListener('submit',async e=>{e.preventDefault();try{await startJob('body',{assetIds:[a().id],singleHumanConfirmed:$('#single-human').checked});$('#body-dialog').close();}catch(err){toast(err.message,true);}});
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();try{await saveSettings();}catch(err){toast(err.message,true);}});
$('#asset-form').addEventListener('submit',async e=>{e.preventDefault();try{const id=$('#editing-asset').value;const project=await ensureProject();const asset=await api('/projects/'+project.id+'/assets'+(id?'/'+id:''),{name:$('#asset-name').value,kind:$('#asset-kind').value,prompt:$('#asset-prompt').value,objectLabel:$('#asset-label').value},id?'PATCH':'POST');focusedId=asset.id;selected.add(asset.id);$('#asset-dialog').close();await refresh();toast('Asset saved.');}catch(err){toast(err.message,true);}});
$('#refine-form').addEventListener('submit',async e=>{e.preventDefault();try{await startJob('images',{assetIds:[a().id],refine:true,instruction:$('#refine-text').value});$('#refine-dialog').close();}catch(err){toast(err.message,true);}});
$('#image-upload').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>30*1024*1024)throw new Error('Choose an image smaller than 30 MB.');const project=await ensureProject();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const asset=await api('/projects/'+project.id+'/assets',{name:file.name.replace(/\.[^.]+$/,''),kind:'prop',prompt:'Imported artwork. Edit this prompt before regenerating.',objectLabel:'object',image:data});focusedId=asset.id;await refresh();toast('Image imported and saved to this PC.');}catch(err){toast(err.message,true);}finally{e.target.value='';}});
let drag=null;
$('#scene-canvas').addEventListener('pointerdown',e=>{const target=e.target.closest('[data-layer]');if(!target)return;const layer=p().scene.layers.find(l=>l.assetId===target.dataset.layer);drag={target,layer,box:$('#scene-canvas').getBoundingClientRect(),startX:e.clientX,startY:e.clientY,x:layer.x,y:layer.y};target.setPointerCapture(e.pointerId);});
$('#scene-canvas').addEventListener('pointermove',e=>{if(!drag)return;const d=drag;d.layer.x=Math.max(0,Math.min(100,d.x+(e.clientX-d.startX)/d.box.width*100));d.layer.y=Math.max(0,Math.min(100,d.y+(e.clientY-d.startY)/d.box.height*100));d.target.style.left=d.layer.x+'%';d.target.style.top=d.layer.y+'%';});
$('#scene-canvas').addEventListener('pointerup',async()=>{if(!drag)return;drag=null;try{await api('/projects/'+p().id+'/scene',p().scene);await refresh();}catch(e){toast(e.message,true);}});
try{await refresh(true);setView('story');}catch(e){toast('Could not open the local library: '+e.message,true);}
setInterval(()=>{if(!drag&&!document.hidden)refresh().catch(()=>{});},2500);
