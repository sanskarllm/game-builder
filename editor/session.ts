import { DEFAULT_TIME_CONFIG, type SceneNode, type CharacterPosition, type Variable, type OverlayButton, type TimeConfig, type ProjectAssets } from './lib/vn-types';

export interface Document { scenes: Record<string, SceneNode>; variables: Variable[]; overlays: OverlayButton[]; time: TimeConfig }
interface Design { id: string; name: string; kind: string; files: Record<string,string> }
export interface Project {
  id: string; title: string; assets: Design[]; music?: {id:string;name:string;file:string}[];
  editor?: { revision: number; document: Document };
  storyAnalysisStale?: boolean;
  storyAnalysis?: { scenes: { title: string; summary: string; characterNames: string[]; locationName: string }[]; characters: {name:string;assetId:string}[]; locations: {name:string;assetId:string}[] };
}
export interface State { csrf: string; projects: Project[]; settings: {keyConfigured: boolean} }
export async function request(path: string, csrf?: string, body?: object) {
  const response = await fetch('/api' + path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type':'application/json','X-Studio-Token':csrf!}, body:JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not save.'), {status:response.status});
  return data;
}
export const sceneNode = (id: string, title: string, x=80, y=70): SceneNode =>
  ({id,title,dialogue:'',speakerId:'',choices:[],visualPosition:{x,y}});
export function outlineScenes(project: Project): SceneNode[] {
  if (project.storyAnalysisStale || !project.storyAnalysis) return [];
  const outline = project.storyAnalysis;
  return outline.scenes.map((s,i) => {
    const node = sceneNode(i ? 'outline-'+i : 'start', s.title, 80+i%3*280, 70+Math.floor(i/3)*220);
    node.dialogue=s.summary;
    const positions: CharacterPosition[] = s.characterNames.length === 1 ? ['center'] : ['left','right','center','far-left','far-right'];
    node.characters=outline.characters.filter(c=>s.characterNames.includes(c.name)).map((c,index)=>({characterId:c.assetId,position:positions[index%positions.length]}));
    node.backgroundId=outline.locations.find(l=>l.name===s.locationName)?.assetId || '';
    if (i+1<outline.scenes.length) node.choices=[{text:'Continue',nextNodeId:'outline-'+(i+1)}];
    return node;
  });
}
export function projectAssets(project: Project): ProjectAssets {
  const image = (a: Design) => {
    const file = a.files.cutout || a.files.source;
    return file ? '/files/'+project.id+'/'+file : '';
  };
  return {
    characters:project.assets.filter(a=>a.kind==='character').map(a=>({id:a.id,name:a.name,url:image(a),expression:'Neutral'})),
    backgrounds:project.assets.filter(a=>a.kind==='environment').map(a=>({id:a.id,name:a.name,url:image(a)})), music:(project.music||[]).map(t=>({id:t.id,name:t.name,url:'/files/'+project.id+'/'+t.file}))
  };
}
function initialDocument(project: Project): Document {
  const nodes=outlineScenes(project);
  if (!nodes.length) nodes.push(sceneNode('start','Opening scene'));
  return {scenes:Object.fromEntries(nodes.map(n=>[n.id,n])),variables:[],overlays:[],time:{...DEFAULT_TIME_CONFIG}};
}

// One save at a time. A draft survives refresh while a request is in flight.
// Revisions protect edits made from another tab.
export class EditorSession {
  document: Document;
  revision: number;
  dirty=false;
  conflict=false;
  message='';
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly key: string;
  constructor(readonly project: Project, readonly csrf: string, readonly redraw: ()=>void) {
    this.key='game-builder.editor.'+project.id;
    this.revision=project.editor?.revision || 0;
    this.document=project.editor?.document || initialDocument(project);
    try {
      const saved=JSON.parse(localStorage.getItem(this.key) || 'null');
      if (saved?.document?.scenes?.start) {
        if (JSON.stringify(saved.document) === JSON.stringify(this.document)) localStorage.removeItem(this.key);
        else {
          this.document=saved.document; this.dirty=true;
          this.conflict=saved.revision !== this.revision;
          if(this.conflict)this.message='Another tab saved a different version. Download your draft or reopen the saved version.';
        }
      }
    } catch { this.message='The local draft could not be read.'; }
  }
  private keepDraft() {
    try { localStorage.setItem(this.key,JSON.stringify({revision:this.revision,document:this.document})); }
    catch { this.message='Browser draft storage is unavailable. Save before closing.'; }
  }
  change(next: Document) {
    this.document=next; this.dirty=true; this.keepDraft(); this.redraw();
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{ void this.flush().catch(()=>{}); },350);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if(this.pending) return this.pending;
    if(this.conflict) return Promise.reject(new Error(this.message));
    this.pending=this.write().finally(()=>{this.pending=undefined;this.redraw();});
    return this.pending;
  }
  private async write() {
    try {
      while(this.dirty) {
        const snapshot=this.document;
        const saved=await request('/projects/'+this.project.id+'/editor',this.csrf,{revision:this.revision,document:snapshot});
        this.revision=saved.revision;
        this.project.editor={revision:saved.revision,document:snapshot};
        this.dirty=this.document!==snapshot;
        this.message='';
        if(this.dirty)this.keepDraft();
        else localStorage.removeItem(this.key);
      }
    } catch(e) {
      this.conflict=(e as {status?:number}).status===409;
      this.message=(e as Error).message; this.redraw(); throw e;
    }
  }
  discardDraft() {clearTimeout(this.timer);localStorage.removeItem(this.key);}
}

