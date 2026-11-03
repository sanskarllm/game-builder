import React, {useEffect, useReducer, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StagePreview} from './components/Editor/StagePreview';
import {ScriptView} from './components/Editor/ScriptView';
import {FlowchartMap} from './components/Editor/FlowchartMap';
import {NarrativePanel} from './components/Editor/NarrativePanel';
import {OverlayEditor} from './components/Editor/OverlayEditor';
import {VisualNovelPlayer} from './components/Player/VNPlayer';
import {resolveStagingStatic} from './lib/vn-vars';
import type {SceneNode, Variable} from './lib/vn-types';
import {EditorSession, projectAssets, outlineScenes, request, sceneNode, type State, type Project, type Document} from './session';
import {Play, Save, Plus, GitBranch, FileText, SlidersHorizontal, Image as Picture, Maximize2, X} from 'lucide-react';

function Workspace({initial, initialProject}: {initial: State; initialProject: Project}) {
  const [,redraw]=useReducer(n=>n+1,0);
  const [session,setSession]=useState(()=>new EditorSession(initialProject, initial.csrf, redraw));
  const [projects,setProjects]=useState(initial.projects);
  const [active,setActive]=useState('start');
  const [view,setView]=useState('map');
  const [panel,setPanel]=useState('');
  const [full,setFull]=useState(false);
  const [play,setPlay]=useState('');
  const [notice,setNotice]=useState('');
  const [newTitle,setNewTitle]=useState('');
  const [newVariable,setNewVariable]=useState('');
  const [kind,setKind]=useState('character');
  const [uploading,setUploading]=useState(false);
  const doc=session.document, scenes=doc.scenes;
  const selected=scenes[active] || scenes.start;
  const assets=projectAssets(session.project);
  function update(patch: Partial<Document>) {session.change({...session.document,...patch});}
  function updateScenes(nodes: Record<string,SceneNode>) {
    if(!nodes.start) return setNotice('The opening scene is the entry point and must be kept.');
    const next=Object.fromEntries(Object.values(nodes).map(n=>[n.id,{...n,choices:n.choices.filter(c=>!c.nextNodeId||Object.hasOwn(nodes,c.nextNodeId)),
      hotspots:n.hotspots?.map(h=>h.targetNodeId&&!Object.hasOwn(nodes,h.targetNodeId)?{...h,targetNodeId:undefined}:h)}]));
    update({scenes:next});
    if(!next[active])setActive('start');
  }
  function updateScene(node: SceneNode) {updateScenes({...session.document.scenes,[node.id]:node});}
  function addScene(x=120,y=90) {
    const id='scene-'+crypto.randomUUID();
    updateScene(sceneNode(id,'New scene',x,y)); setActive(id);
  }
  function removeScene() {
    const next={...scenes}; delete next[selected.id]; updateScenes(next);
  }
  async function save() {
    if(!session.project.editor&&!session.dirty)session.change(doc);
    await session.flush();
  }
  function handle(action: ()=>Promise<void>) {void action().catch(e=>setNotice(e.message));}
  function openProject(project: Project) {
    localStorage.setItem('asset-studio-project',project.id);
    setSession(new EditorSession(project,initial.csrf,redraw));setActive('start');setPanel('');setPlay('');setNotice('');
  }
  async function upload(file: File) {
    if(file.size>30*1024*1024) throw new Error('Choose a file under 30 MB.');
    setUploading(true);
    try {
      const data=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.onerror=()=>reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });
      const name=file.name.replace(/\.[^.]+$/,'');
      const base='/projects/'+session.project.id;
      if(kind==='music'){
        const track=await request(base+'/tracks',session.csrf,{name,audio:data});
        session.project.music=[...(session.project.music||[]),track];
      } else {
        const asset=await request(base+'/assets',session.csrf,{name,kind,image:data});
        session.project.assets=[...session.project.assets,asset];
      }
      setNotice(name+' added to this project.');
      redraw();
    } finally {setUploading(false);}
  }
  async function goToTools(hash='story') {
    await save();
    location.assign('/workspace?project='+encodeURIComponent(session.project.id)+'#'+hash);
  }
  async function refine(node: SceneNode) {
    const line=node.dialogue;
    const result=await request('/projects/'+session.project.id+'/refine',initial.csrf,{dialogue:line,speaker:assets.characters.find(c=>c.id===node.speakerId)?.name||'Narrator',scene:node.title});
    const latest=session.document.scenes[node.id];
    if(!latest||latest.dialogue!==line) throw new Error('The line changed while Meta was working. Keep your edit and refine again if needed.');
    updateScene({...latest,dialogue:result.dialogue});setNotice('Dialogue refined.');
  }
  function importOutline() {
    const imported=outlineScenes(session.project);
    if(!imported.length)return setNotice('Analyse your manuscript in Story & assets first.');
    const pristine=Object.keys(scenes).length===1&&!scenes.start.dialogue&&!scenes.start.choices.length&&scenes.start.title==='Opening scene';
    const remap=new Map(imported.map(n=>[n.id, pristine?n.id:'scene-'+crypto.randomUUID()]));
    const next=pristine?{}:{...scenes};
    for(const node of imported){
      const id=remap.get(node.id)!;
      next[id]={...node,id,choices:node.choices.map(c=>({...c,nextNodeId:remap.get(c.nextNodeId)!}))};
    }
    updateScenes(next);setActive(remap.get('start')!);setNotice('Added the analysed scenes with their cast and locations.');
  }
  useEffect(()=>{
    const protect=(event: BeforeUnloadEvent)=>{if(session.dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',protect);
    if(session.dirty&&!session.conflict)void session.flush().catch(()=>{});
    return ()=>window.removeEventListener('beforeunload',protect);
  },[session]);
  const status=session.message || (session.dirty?'Saving edits…':'Saved on this PC');
  if(play)return <VisualNovelPlayer projectId={session.project.id} scenes={scenes} assets={assets} timeConfig={doc.time} variables={doc.variables} overlays={doc.overlays} startNodeId={play} onExit={()=>setPlay('')}/>;
  return <div className="editor-shell">
    <header className="editor-bar"><div className="editor-brand"><img src="/icon.svg" alt=""/><strong>Game Builder</strong><span>Editor</span></div>
      <div className="editor-actions"><button onClick={()=>handle(()=>goToTools())}>Story & assets</button>
      <button onClick={()=>setPanel('controls')}><SlidersHorizontal/> Story controls</button>
      <button onClick={()=>handle(save)}><Save/> Save</button><button className="play" onClick={()=>setPlay('start')}><Play/> Play</button></div></header>
    <div className="editor-columns">
    <aside className="project-rail"><label htmlFor="project-select">Project</label><select id="project-select" value={session.project.id} onChange={e=>{const id=e.target.value;handle(async()=>{await save();const fresh:State=await request('/state');setProjects(fresh.projects);openProject(fresh.projects.find(p=>p.id===id)!);});}}>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <button onClick={()=>{setNewTitle('');setPanel('new');}}><Plus/> New project</button>
      <div className="rail-section"><h2>Scenes</h2><button title="Add scene" onClick={()=>addScene(80+(Object.keys(scenes).length%3)*280,70+Math.floor(Object.keys(scenes).length/3)*220)}><Plus/></button></div>
      <nav aria-label="Scenes">{Object.values(scenes).map((s,i)=><button key={s.id} className={s.id===selected.id?'selected':''} onClick={()=>setActive(s.id)}><small>{i+1}</small>{s.title||'Untitled scene'}</button>)}</nav>
      <div className="rail-section"><h2>Cast & backgrounds</h2></div>
      {session.project.assets.filter(a=>['character','environment'].includes(a.kind)).map(a=><div className="rail-item" key={a.id}><Picture/>{a.name}</div>)}
      {(session.project.music||[]).map(t=><div className="rail-item" key={t.id}>♫ {t.name}</div>)}
      <label htmlFor="upload-kind">Import to project</label><select id="upload-kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="character">Character sprite</option><option value="environment">Background</option><option value="music">Music track</option></select>
      <label className="import-file">{uploading?'Importing…':'Choose file…'}<input disabled={uploading} type="file" accept={kind==='music'?'.mp3,.wav,.ogg':'image/png,image/jpeg,image/webp'} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)handle(()=>upload(file));}}/></label>
      <button onClick={()=>handle(()=>goToTools('assets'))}><Plus/> Manage designs</button>
      {session.project.storyAnalysis&&!session.project.storyAnalysisStale&&<button onClick={importOutline}>Add scenes from story</button>}
      <div className="save-status" role="status">{status}</div>
      {session.conflict&&<button onClick={()=>handle(async()=>{const fresh:State=await request('/state');const p=fresh.projects.find(p=>p.id===session.project.id)!;const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='editor-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);session.discardDraft();openProject(p);})}>Download draft & reopen saved version</button>}
    </aside>
    <main className="authoring"><div className="editor-stage"><StagePreview scene={{...selected,...resolveStagingStatic(scenes,selected.id)}} assets={assets} onUpdateScene={staged=>updateScene({...selected,hotspots:staged.hotspots})}/></div>
      <section className={'narrative '+(full?'expanded':'')}><div className="narrative-tabs"><h2>Narrative</h2><button aria-pressed={view==='map'} onClick={()=>setView('map')}><GitBranch/> Branch map</button><button aria-pressed={view==='script'} onClick={()=>setView('script')}><FileText/> Screenplay</button><button aria-label="Toggle expanded view" onClick={()=>setFull(!full)}>{full?<X/>:<Maximize2/>}</button></div>
        <div className="narrative-body">{view==='map'?<FlowchartMap scenes={scenes} currentSceneId={selected.id} onSelectScene={setActive} onUpdateScenes={updateScenes} onAddScene={addScene} onPlayFrom={setPlay} isExpanded={full}/>:<ScriptView scenes={scenes} assets={assets} currentSceneId={selected.id} onUpdateScenes={updateScenes} onSelectScene={setActive}/>}</div></section>
    </main>
    <div className="inspector"><NarrativePanel key={selected.id} scene={selected} assets={assets} scenes={scenes} onUpdate={updateScene} onUpdateScenes={updateScenes} onSelectScene={setActive} onDelete={selected.id==='start'?undefined:removeScene} onRefine={initial.settings.keyConfigured?refine:undefined} onNotice={setNotice} variables={doc.variables} clockEnabled={doc.time.enabled}/></div></div>
    {notice&&<div role="status" className="editor-notice"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X/></button></div>}
    {panel&&<dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={()=>setPanel('')} className="editor-dialog">
      <div className="dialog-title"><h2>{panel==='new'?'New project':'Story controls'}</h2><button aria-label="Close dialog" onClick={()=>setPanel('')}><X/></button></div>
      {panel==='new'?<form onSubmit={e=>{e.preventDefault();handle(async()=>{await save();const project=await request('/projects',initial.csrf,{title:newTitle.trim()});setProjects([...projects,project]);openProject(project);});}}><label>Project name<input autoFocus required maxLength={100} value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><button className="play">Create project</button></form>:<>
      <label><input type="checkbox" checked={doc.time.enabled} onChange={e=>update({time:{...doc.time,enabled:e.target.checked}})}/> Enable story clock</label>
      {doc.time.enabled&&<label>Start time<input type="time" value={new Date(doc.time.startMinutes*60000).toISOString().slice(11,16)} onChange={e=>{if(e.target.value){const [h,m]=e.target.value.split(':').map(Number);update({time:{...doc.time,startMinutes:60*h+m}});}}}/></label>}
      <h3>Story variables</h3>{doc.variables.map((v,i)=><div className="variable-row" key={v.name}><b>{v.name}</b><select aria-label={'Type for '+v.name} value={v.type} onChange={e=>update({variables:doc.variables.map((x,j)=>j===i?{...x,type:e.target.value as Variable['type']}:x)})}><option value="int">Number</option><option value="bool">Boolean</option><option value="string">Text</option></select><input aria-label={'Initial value for '+v.name} value={v.init} onChange={e=>update({variables:doc.variables.map((x,j)=>j===i?{...x,init:e.target.value}:x)})}/><button onClick={()=>update({variables:doc.variables.filter((_,j)=>i!==j)})}>Remove</button></div>)}
      <form className="variable-row" onSubmit={e=>{e.preventDefault();if(!/^[A-Za-z_]\w*$/.test(newVariable)||doc.variables.some(v=>v.name===newVariable)||['constructor','prototype','__proto__','time'].includes(newVariable))return setNotice('Use a unique variable name made of letters, digits and underscores.');update({variables:[...doc.variables,{name:newVariable,init:'0',type:'int'}]});setNewVariable('');}}><input aria-label="New variable name" value={newVariable} onChange={e=>setNewVariable(e.target.value)}/><button>Add variable</button></form>
      <h3>Pinned buttons</h3><OverlayEditor overlays={doc.overlays} scenes={scenes} variables={doc.variables} clockEnabled={doc.time.enabled} onChange={overlays=>update({overlays})}/></>}</dialog>}
  </div>;
}

const root=createRoot(document.getElementById('editor-root')!);
async function open() {
  const state:State=await request('/state');
  const wanted=new URLSearchParams(location.search).get('project') || localStorage.getItem('asset-studio-project');
  let project=state.projects.find(p=>p.id===wanted) || state.projects[0];
  if(!project){project=await request('/projects',state.csrf,{title:'Untitled game'});state.projects.push(project);}
  localStorage.setItem('asset-studio-project',project.id);
  root.render(<Workspace initial={state} initialProject={project}/>);
}
open().catch(error=>root.render(<div role="alert">Could not open the editor. {error.message} <button onClick={()=>location.reload()}>Retry</button></div>));

