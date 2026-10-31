export function initStoryUI(){
  document.title='Game Builder';
  document.querySelector('.brand small').textContent='LOCAL WORKSPACE';
  document.querySelector('.new-world').textContent='＋ New story';
  document.querySelector('.workspace-heading .eyebrow').textContent='FROM THE PAGE TO YOUR WORLD';
  document.querySelector('#settings-form>.muted').textContent='The app runs on this PC. Story analysis, composition and image-generation requests go to Meta’s API.';
  document.querySelector('#export-button').innerHTML='Export project <span>↗</span>';
  document.querySelector('.workspace-footer span:last-child').textContent='Game Builder · Local workspace';
  document.querySelector('.workspace-nav').insertAdjacentHTML('afterbegin','<button data-view="story" class="active"><span>▤</span> Story & cast</button>');
  document.querySelector('[data-view="assets"]').innerHTML='<span>♙</span> Design studio <b id="asset-count">0</b>';
  document.querySelector('#assets-view').insertAdjacentHTML('beforebegin',`
    <section id="story-view">
      <div class="story-workbench">
        <div class="story-manuscript">
          <div class="panel-label"><span class="spark">✦</span> 01 / YOUR MANUSCRIPT <button class="text-button" data-action="import-story">Import .txt / .md ↗</button></div>
          <label for="story">Your story or chapter</label>
          <p class="muted">Paste the actual story, including dialogue. Muse Spark will identify who appears, what they look like, and where each scene takes place.</p>
          <textarea id="story" maxlength="80000" rows="16" placeholder="At dusk, Mira reached the lantern shop. Her red coat was still wet from the crossing. Behind the counter, an elderly clockmaker looked up…"></textarea>
          <div class="story-editor-footer"><small id="story-count">0 / 80,000 characters</small><button class="text-button" data-action="story-example">Try a short story</button></div>
          <div class="story-actions"><button class="button secondary" data-action="save-story">Save story</button><button class="button primary" data-action="analyse-story">✦ Discover characters & scenes <span>→</span></button></div>
          <p class="footnote">Analysis sends this story to Meta. Review the cast before generating images. Saving stays on this PC.</p>
        </div>
        <aside class="story-direction">
          <div class="story-cover"><img src="/sample-world.webp" alt="Illustrated fantasy world"><span>YOUR WORDS. THEIR WORLD.</span></div>
          <h2>Let the story<br><em>lead the design.</em></h2>
          <div id="story-options"></div>
          <ol class="story-steps"><li><b>Read the story</b><span>Extract the cast and locations.</span></li><li><b>Review each design</b><span>Facts and suggestions stay separate.</span></li><li><b>Create their artwork</b><span>Base designs, expressions and scenes.</span></li></ol>
        </aside>
      </div>
      <div id="story-breakdown"></div>
    </section>`);
  const options=document.querySelector('#story-options');
  options.append(document.querySelector('#style').closest('.form-grid'));
  const label=document.querySelector('label[for="brief"]');label.textContent='Design notes (optional)';options.append(label,document.querySelector('#brief'));
  document.querySelector('#brief').placeholder='Keep the palette warm and the character designs consistent…';
  document.querySelector('#brief').rows=3;
  document.querySelector('.brief-panel').hidden=true;
  document.querySelector('.studio-grid').classList.add('story-design-preview');
  document.querySelector('#assets-view').hidden=true;
  document.querySelector('#scene-view .muted').textContent='Choose a scene in the story breakdown to arrange its cast and location, or compose freely from your designs.';
  document.querySelector('#scene-view .footnote').textContent='A composition board for your story. Exports images and coordinates; it does not yet export a playable visual novel.';
  document.body.insertAdjacentHTML('beforeend',`<input type="file" id="story-upload" accept=".txt,.md,text/plain,text/markdown" hidden>
    <dialog id="variant-dialog"><form id="variant-form"><div class="dialog-heading"><h2>Another side of the same character.</h2><button type="button" class="icon-button" data-close="variant-dialog" aria-label="Close expression dialog">×</button></div><p class="muted">Creates a separate design linked to this image. Your base character stays unchanged.</p><label>Expression or pose<input id="variant-expression" required maxlength="300" placeholder="A warm smile, with the same outfit and pose"></label><div class="dialog-actions"><button class="button primary" type="submit">Add expression design</button></div></form></dialog>`);
  document.querySelector('#data-path').insertAdjacentHTML('beforebegin',`<details class="settings-section"><summary>04 / SAM 3D Body · human characters</summary><p class="body-note">Uses a single human design without extra detector or field-of-view models. The output is a body-shape mesh; clothing, hair, materials and a game-ready rig are not included. GPU compatibility and memory still need a real test.</p><label>Body Python executable<input id="body-python" placeholder="/home/you/sam-body-env/bin/python"></label><label>Body repository<input id="body-repo" placeholder="/home/you/game-builder-models/sam-3d-body"></label><label>Body checkpoint<input id="body-checkpoint" placeholder="/home/you/models/sam-3d-body/model.ckpt"></label><label>MHR model<input id="body-mhr" placeholder="/home/you/models/sam-3d-body/assets/mhr_model.pt"></label><p class="notice" id="body-status"></p><button type="button" class="button secondary" data-action="body-check">Check Body environment</button><pre id="body-check-result" class="check-result" hidden></pre></details>`);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="body-dialog"><form id="body-form"><div class="dialog-heading"><h2>A body foundation for your character.</h2><button type="button" class="icon-button" data-close="body-dialog" aria-label="Close body dialog">×</button></div><p class="muted">SAM 3D Body estimates human body shape and pose. It does not recreate clothing, hair, textures or a finished animation rig. Use one clear full-body human image; creatures and group scenes need another workflow.</p><label class="checkbox-row"><input type="checkbox" id="single-human" required> This image shows one human character.</label><div class="dialog-actions"><button class="button primary" type="submit">Create local body mesh</button></div></form></dialog>`);
}

export function renderStoryBreakdown(project,esc){
  const target=document.querySelector('#story-breakdown'),analysis=project?.storyAnalysis;
  if(!analysis){target.innerHTML='<div class="story-empty"><span>02 / THE CAST IS WAITING IN YOUR WORDS</span><h2>First, tell their story.</h2><p>Characters, locations and scene notes appear here after analysis. You decide which designs to create.</p></div>';return;}
  const design=id=>project.assets.find(a=>a.id===id),quotes=items=>items.map(q=>'<blockquote>“'+esc(q)+'”</blockquote>').join('');
  target.innerHTML=(project.storyAnalysisStale?'<p class="notice">Your story has changed since this breakdown. Analyse it again to update the cast and scenes; existing designs will be kept.</p>':'')+
    '<div class="library-heading"><div><p class="eyebrow">02 / MEET YOUR CAST</p><h2>'+analysis.characters.length+' characters. One story.</h2></div><button class="button secondary" data-view="assets">Open design studio ↗</button></div><p class="story-summary">'+esc(analysis.summary)+'</p>'+
    '<div class="cast-grid">'+analysis.characters.map(c=>{
      const asset=design(c.assetId),profile=asset?.character||c;
      return '<article class="cast-card">'+(asset?.files.source?'<img class="cast-image" src="/files/'+project.id+'/'+asset.files.source+'" alt="'+esc(c.name)+'">':'<div class="cast-monogram">'+esc(c.name.slice(0,1))+'</div>')+
        '<div class="cast-copy"><p class="eyebrow">'+esc(profile.species||'CHARACTER')+'</p><h3>'+esc(c.name)+'</h3><p>'+esc(c.role)+'</p>'+
        (c.aliases.length?'<small>Also known as '+esc(c.aliases.join(', '))+'</small>':'')+
        '<details><summary>Story facts & design notes</summary><dl><dt>Appearance</dt><dd>'+esc(profile.appearance)+'</dd><dt>Personality</dt><dd>'+esc(profile.personality)+'</dd><dt>Outfit</dt><dd>'+esc(profile.outfit)+'</dd></dl>'+
        (profile.proposedDetails.length?'<h4>Suggested additions — review these</h4><ul>'+profile.proposedDetails.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')+
        '<h4>From your story</h4>'+quotes(c.sourceEvidence)+(c.expressions.length?'<p><b>Useful expressions:</b> '+esc(c.expressions.join(', '))+'</p>':'')+'</details>'+
        (c.existingDesignKept?'<p class="footnote">Existing design and edits kept. Review the latest story facts before changing its prompt.</p>':'')+
        '<button class="button secondary" data-character-design="'+c.assetId+'">'+(asset?.files.source?'View character':'Review & design')+' ↗</button></div></article>';
    }).join('')+'</div>'+
    '<div class="library-heading"><div><p class="eyebrow">THE PLACES THEY BELONG</p><h2>Locations</h2></div></div><div class="location-grid">'+analysis.locations.map(l=>'<article class="location-card"><h3>'+esc(l.name)+'</h3><p>'+esc(l.description)+'</p><button class="text-button" data-character-design="'+l.assetId+'">Review background design ↗</button></article>').join('')+'</div>'+
    '<div class="library-heading"><div><p class="eyebrow">THE STORY, SCENE BY SCENE</p><h2>Your scene breakdown</h2></div></div><div class="story-scenes">'+analysis.scenes.map((s,i)=>'<article class="story-scene"><span class="scene-number">'+String(i+1).padStart(2,'0')+'</span><div><h3>'+esc(s.title)+'</h3><p>'+esc(s.summary)+'</p><small>'+esc(s.locationName||'Location unspecified')+' · '+esc(s.characterNames.join(', ')||'No on-screen cast')+'</small>'+(s.props.length?'<p class="footnote">Props: '+esc(s.props.join(', '))+'</p>':'')+'</div><button class="text-button" data-story-scene="'+i+'">Compose scene ↗</button></article>').join('')+'</div>'+
    (analysis.questions.length?'<div class="story-questions"><h3>Details to decide</h3><ul>'+analysis.questions.map(q=>'<li>'+esc(q)+'</li>').join('')+'</ul></div>':'');
}
