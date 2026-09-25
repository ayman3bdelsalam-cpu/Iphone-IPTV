(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const CACHE_TTL = 10 * 60 * 1000;
const CONTROL_HIDE_MS = 2600;
const state = {
  server:'', user:'', pass:'', proxy:'',
  categories:{LIVE:null,VOD:null,SERIES:null}, categoryAt:{LIVE:0,VOD:0,SERIES:0},
  streams:new Map(), seriesInfo:new Map(),
  currentType:null, currentCategory:'0', currentItems:[], currentSeries:null,
  favorites:loadJSON('ayman_favs',{LIVE:[],VOD:[],SERIES:[]}),
  resume:loadJSON('ayman_resume',{}),
  scale:localStorage.getItem('ayman_scale') || 'zoom',
  lastView:loadJSON('ayman_last_view',{kind:'home'}),
  lastPlayed:loadJSON('ayman_last_played',null),
  player:null, playerTarget:null, sourceIndex:0, retryCount:0, retryTimer:null, startupTimer:null,
  wakeLock:null, controlsTimer:null, progressTimer:null,
  playerQueue:null, gesture:null, gestureSeek:null, lastTapAt:0, lastTapX:0,
  isScrubbing:false,
};

function loadJSON(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
function normalizeServer(v){return (v||'').trim().replace(/\/+$/,'')}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtTime(sec){if(!Number.isFinite(sec)||sec<0)return'0:00';const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.add('hidden'),2200)}
function setView(id){['loginView','mainView','playerView'].forEach(v=>$(v).classList.toggle('active',v===id));document.body.classList.toggle('player-active',id==='playerView')}
function saveLastView(v){state.lastView=v;saveJSON('ayman_last_view',v)}
function preconnectServer(){try{const origin=new URL(state.server).origin;let l=document.querySelector('link[data-ayman-preconnect]');if(!l){l=document.createElement('link');l.rel='preconnect';l.crossOrigin='anonymous';l.dataset.aymanPreconnect='1';document.head.appendChild(l)}l.href=origin}catch{}}

async function credKey(){
  if(!crypto?.subtle) return null;
  const saved=localStorage.getItem('ayman_cred_key');
  if(saved) return crypto.subtle.importKey('raw',Uint8Array.from(atob(saved),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
  const raw=crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem('ayman_cred_key',btoa(String.fromCharCode(...raw)));
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function saveCredentials(obj){
  if(!obj){localStorage.removeItem('ayman_credentials');return}
  const key=await credKey();
  if(!key){localStorage.setItem('ayman_credentials',JSON.stringify(obj));return}
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=new TextEncoder().encode(JSON.stringify(obj));
  const enc=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  localStorage.setItem('ayman_credentials',JSON.stringify({v:1,iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...enc))}));
}
async function loadCredentials(){
  const raw=localStorage.getItem('ayman_credentials');if(!raw)return null;
  try{
    const o=JSON.parse(raw); if(!o.v)return o;
    const key=await credKey(); if(!key)return null;
    const iv=Uint8Array.from(atob(o.iv),c=>c.charCodeAt(0));
    const data=Uint8Array.from(atob(o.data),c=>c.charCodeAt(0));
    const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);
    return JSON.parse(new TextDecoder().decode(dec));
  }catch{return null}
}

function apiUrl(action, extra={}){
  const u=new URL(state.server+'/player_api.php');
  u.searchParams.set('username',state.user);u.searchParams.set('password',state.pass);
  if(action)u.searchParams.set('action',action);
  Object.entries(extra).forEach(([k,v])=>u.searchParams.set(k,v));
  const direct=u.toString();
  if(!state.proxy)return direct;
  return state.proxy.replace(/\/+$/,'')+'/?url='+encodeURIComponent(direct);
}
async function api(action,extra={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(apiUrl(action,extra),{cache:'no-store',mode:'cors',signal:controller.signal});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }finally{clearTimeout(timeout)}
}

async function login(server,user,pass,proxy,remember){
  state.server=normalizeServer(server);state.user=user.trim();state.pass=pass;state.proxy=normalizeServer(proxy);preconnectServer();
  const data=await api('',{});
  const ok=String(data?.user_info?.auth)==='1' || String(data?.user_info?.status||'').toLowerCase()==='active';
  if(!ok)throw new Error('Login rejected by IPTV server');
  if(remember)await saveCredentials({server:state.server,user:state.user,pass:state.pass,proxy:state.proxy}); else await saveCredentials(null);
  setView('mainView');await restoreLastView();
}
async function restoreLastView(){
  const v=state.lastView||{kind:'home'};
  if(v.kind==='favorites')return renderFavorites();
  if(v.kind==='continue')return renderContinue();
  if(v.kind==='search')return renderSearch();
  if(v.kind==='content'&&['LIVE','VOD','SERIES'].includes(v.type))return openContent(v.type,false,v.category||'0');
  renderHome();
}

function dashboardCard(cls,icon,title,sub,onclick){const b=document.createElement('button');b.className=`dashboard-card ${cls}`;b.innerHTML=`<div class="dashboard-icon">${icon}</div><strong>${title}</strong><span>${sub}</span>`;b.onclick=onclick;return b}
function renderHome(){
  saveLastView({kind:'home'});activateTab('home');
  const c=$('mainContent');c.innerHTML='<div class="hero"><h1>Ready to watch?</h1><p>Your IPTV library, optimized for iPhone.</p></div><div class="dashboard-grid" id="dash"></div>';
  const d=$('dash');
  d.append(dashboardCard('live','📺','LIVE TV','Channels & broadcasts',()=>openContent('LIVE')));
  d.append(dashboardCard('movies','🎬','MOVIES','VOD library',()=>openContent('VOD')));
  d.append(dashboardCard('series','🍿','SERIES','Seasons & episodes',()=>openContent('SERIES')));
  d.append(dashboardCard('cont','▶','CONTINUE','Resume watching',()=>renderContinue()));
  if(state.lastPlayed){
    const lp=dashboardCard('last','↻','PLAY LAST',state.lastPlayed.title||'Last played',()=>playSavedLast());
    lp.classList.add('dashboard-wide');d.append(lp);
  }
}
function activateTab(tab){document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab))}

async function getCategories(type,force=false){
  if(!force&&state.categories[type]&&Date.now()-state.categoryAt[type]<CACHE_TTL)return state.categories[type];
  const action=type==='LIVE'?'get_live_categories':type==='VOD'?'get_vod_categories':'get_series_categories';
  const list=await api(action);state.categories[type]=Array.isArray(list)?list:[];state.categoryAt[type]=Date.now();return state.categories[type];
}
async function getStreams(type,cat='0',force=false){
  const key=`${type}:${cat}`;const cached=state.streams.get(key);
  if(!force&&cached&&Date.now()-cached.at<CACHE_TTL)return cached.data;
  const action=type==='LIVE'?'get_live_streams':type==='VOD'?'get_vod_streams':'get_series';
  const extra=cat&&cat!=='0'?{category_id:cat}:{};
  const list=await api(action,extra);const data=Array.isArray(list)?list:[];state.streams.set(key,{at:Date.now(),data});return data;
}
function itemId(type,it){return String(type==='SERIES'?(it.series_id??it.id):(it.stream_id??it.id))}
function itemName(it){return it.name||it.title||'Untitled'}
function itemPoster(it){return it.stream_icon||it.cover||it.info?.movie_image||''}
function isFav(type,it){return (state.favorites[type]||[]).includes(itemId(type,it))}
function toggleFav(type,it){const id=itemId(type,it);const a=state.favorites[type]||[];const i=a.indexOf(id);if(i>=0)a.splice(i,1);else a.push(id);state.favorites[type]=a;saveJSON('ayman_favs',state.favorites);toast(i>=0?'Removed from favorites':'Added to favorites')}

async function openContent(type,force=false,category='0'){
  state.currentType=type;state.currentCategory=String(category||'0');saveLastView({kind:'content',type,category:state.currentCategory});activateTab('home');
  const c=$('mainContent');c.innerHTML='<div class="loading">Loading…</div>';
  try{
    const [cats,items]=await Promise.all([getCategories(type,force),getStreams(type,state.currentCategory,force)]);state.currentItems=items;renderContent(type,cats,items,state.currentCategory);
  }catch(e){renderApiError(e,()=>openContent(type,true,state.currentCategory))}
}
function renderContent(type,cats,items,selected='0'){
  const c=$('mainContent');
  c.innerHTML=`<div class="section-head"><button class="back-link" id="sectionBack">‹ Home</button><h2>${type==='LIVE'?'Live TV':type==='VOD'?'Movies':'Series'}</h2><span></span></div><div class="searchbox"><input id="contentSearch" type="search" placeholder="Search..."></div><div class="chips" id="chips"></div><div class="grid" id="contentGrid"></div>`;
  $('sectionBack').onclick=renderHome;
  const chips=$('chips');[{category_id:'0',category_name:'All'},...cats].forEach(cat=>{const cid=String(cat.category_id);const b=document.createElement('button');b.className='chip'+(cid===String(selected)?' active':'');b.textContent=cat.category_name;b.onclick=async()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.currentCategory=cid;saveLastView({kind:'content',type,category:cid});$('contentGrid').innerHTML='<div class="loading">Loading…</div>';try{state.currentItems=await getStreams(type,cid);drawItems(type,state.currentItems)}catch(e){renderApiError(e,()=>openContent(type,true,cid))}};chips.appendChild(b)});
  drawItems(type,items);
  let t;$('contentSearch').oninput=(e)=>{clearTimeout(t);t=setTimeout(()=>{const q=e.target.value.trim().toLowerCase();drawItems(type,q?state.currentItems.filter(x=>itemName(x).toLowerCase().includes(q)):state.currentItems)},250)};
}
function drawItems(type,items){
  const g=$('contentGrid');if(!g)return;g.innerHTML='';if(!items.length){g.innerHTML='<div class="empty">Nothing found</div>';return}
  const frag=document.createDocumentFragment();items.slice(0,1500).forEach(it=>{
    const b=document.createElement('div');b.className='card '+(type==='LIVE'?'live-card':'');b.setAttribute('role','button');b.tabIndex=0;
    const poster=itemPoster(it);b.innerHTML=`<div class="poster">${poster?`<img loading="lazy" decoding="async" src="${escapeHtml(poster)}" alt="">`:'<div class="fallback-logo">A</div>'}</div><button class="fav-btn" aria-label="Favorite">${isFav(type,it)?'♥':'♡'}</button><div class="name">${escapeHtml(itemName(it))}</div>`;
    b.querySelector('.fav-btn').onclick=(ev)=>{ev.stopPropagation();toggleFav(type,it);ev.currentTarget.textContent=isFav(type,it)?'♥':'♡'};
    b.onclick=()=>type==='SERIES'?openSeries(it):playItem(type,it);
    frag.appendChild(b);
  });g.appendChild(frag);
}

async function openSeries(series){
  state.currentSeries=series;const c=$('mainContent');c.innerHTML='<div class="loading">Loading series…</div>';
  try{
    const sid=itemId('SERIES',series);let info=state.seriesInfo.get(sid);if(!info){info=await api('get_series_info',{series_id:sid});state.seriesInfo.set(sid,info)}
    c.innerHTML=`<div class="section-head"><button class="back-link" id="seriesBack">‹ Series</button><h2>${escapeHtml(itemName(series))}</h2><span></span></div><div id="seasons"></div>`;$('seriesBack').onclick=()=>openContent('SERIES',false,state.currentCategory);
    const host=$('seasons');const eps=info?.episodes||{};Object.keys(eps).sort((a,b)=>Number(a)-Number(b)).forEach(season=>{const sec=document.createElement('section');sec.className='season';sec.innerHTML=`<h3>Season ${escapeHtml(season)}</h3><div class="episode-list"></div>`;const list=sec.querySelector('.episode-list');(eps[season]||[]).forEach(ep=>{const b=document.createElement('button');b.className='episode';b.innerHTML=`<strong>Episode ${escapeHtml(ep.episode_num??'')}</strong><span>${escapeHtml(ep.title||'Play')}</span>`;b.onclick=()=>playEpisode(series,ep);list.appendChild(b)});host.appendChild(sec)});
  }catch(e){renderApiError(e,()=>openSeries(series))}
}

function liveUrls(it){const id=itemId('LIVE',it),base=`${state.server}/live/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${id}`;return[`${base}.m3u8`,`${base}.ts`]}
function vodUrls(it){const id=itemId('VOD',it),ext=it.container_extension||'mp4';return[`${state.server}/movie/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${id}.${ext}`]}
function epUrls(ep){const ext=ep.container_extension||'mp4';return[`${state.server}/series/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${ep.id}.${ext}`]}
function buildTarget(type,it){const urls=type==='LIVE'?liveUrls(it):vodUrls(it);const key=`${type}:${itemId(type,it)}`;return{type,title:itemName(it),icon:itemPoster(it),itemId:itemId(type,it),ext:it.container_extension||'mp4',urls,seekable:type!=='LIVE',resumeKey:key,start:Number(state.resume[key]?.time||0)}}
function playItem(type,it){
  if(type==='LIVE'){const usable=state.currentType==='LIVE'&&state.currentItems.some(x=>itemId(type,x)===itemId(type,it));const items=usable?state.currentItems.slice():[it];const idx=items.findIndex(x=>itemId(type,x)===itemId(type,it));state.playerQueue={type:'LIVE',items,index:Math.max(0,idx)}}else state.playerQueue=null;
  startPlayer(buildTarget(type,it));
}
function playEpisode(series,ep){state.playerQueue=null;const key=`SERIES:${ep.id}`;startPlayer({type:'SERIES',title:`${itemName(series)} · Episode ${ep.episode_num??''}`,icon:itemPoster(series),itemId:String(ep.id),ext:ep.container_extension||'mp4',urls:epUrls(ep),seekable:true,resumeKey:key,start:Number(state.resume[key]?.time||0)})}
function rememberLastPlayed(target){state.lastPlayed={type:target.type,title:target.title,icon:target.icon,itemId:target.itemId,ext:target.ext||'mp4'};saveJSON('ayman_last_played',state.lastPlayed)}
function playSavedLast(){const r=state.lastPlayed;if(!r)return;if(r.type==='LIVE'){startPlayer({type:'LIVE',title:r.title,icon:r.icon,itemId:String(r.itemId),ext:'ts',urls:[`${state.server}/live/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${r.itemId}.m3u8`,`${state.server}/live/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${r.itemId}.ts`],seekable:false,resumeKey:`LIVE:${r.itemId}`,start:0});return}const root=r.type==='VOD'?'movie':'series';const key=`${r.type}:${r.itemId}`;startPlayer({type:r.type,title:r.title,icon:r.icon,itemId:String(r.itemId),ext:r.ext||'mp4',urls:[`${state.server}/${root}/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${r.itemId}.${r.ext||'mp4'}`],seekable:true,resumeKey:key,start:Number(state.resume[key]?.time||0)})}

async function startPlayer(target){
  const v=$('video');state.playerTarget=target;state.sourceIndex=0;state.retryCount=0;rememberLastPlayed(target);setView('playerView');applyScale();showControls(true);$('playerTitle').textContent=target.title;$('seekWrap').classList.toggle('hidden',!target.seekable);$('retryBtn').classList.add('hidden');$('playerStatus').textContent='Loading…';$('playerHint').classList.add('hidden');
  const liveQueue=target.type==='LIVE'&&state.playerQueue?.items?.length>1;$('prevBtn').classList.toggle('hidden',!liveQueue);$('nextBtn').classList.toggle('hidden',!liveQueue);
  try{if(document.documentElement.requestFullscreen && !document.fullscreenElement)await document.documentElement.requestFullscreen()}catch{}
  try{if(screen.orientation?.lock)await screen.orientation.lock('landscape')}catch{}
  updateRotateHint();await acquireWakeLock();attachPlayerEvents();loadSource(0,target.start||0);
}
function loadSource(index,start=0){
  const t=state.playerTarget,v=$('video');if(!t||index>=t.urls.length){fatalPlayerError('Stream failed');return}
  state.sourceIndex=index;clearTimeout(state.startupTimer);$('retryBtn').classList.add('hidden');$('playerStatus').textContent=index?'Trying fallback stream…':'Loading…';v.pause();v.removeAttribute('src');v.src=t.urls[index];
  if(start>0){v.addEventListener('loadedmetadata',function s(){v.removeEventListener('loadedmetadata',s);try{v.currentTime=Math.min(start,Math.max(0,(v.duration||start)-5))}catch{}},{once:true})}
  const timeout=t.type==='LIVE'?7000:12000;state.startupTimer=setTimeout(()=>{if(state.playerTarget!==t||!v.paused||v.readyState>=3)return;if(state.sourceIndex+1<t.urls.length){$('playerStatus').textContent='Switching stream format…';loadSource(state.sourceIndex+1,t.seekable?v.currentTime:0)}else handlePlaybackError()},timeout);
  v.play().catch(()=>{$('playerStatus').textContent='Tap play to start';showControls(true)});
}
function attachPlayerEvents(){
  const v=$('video');if(v._aymanBound)return;v._aymanBound=true;
  v.addEventListener('playing',()=>{clearTimeout(state.startupTimer);$('playerStatus').textContent='';$('playPauseBtn').textContent='❚❚';state.retryCount=0;startProgressSaver();showControls()});
  v.addEventListener('pause',()=>{$('playPauseBtn').textContent='▶';persistResume();showControls(true)});
  v.addEventListener('waiting',()=>{$('playerStatus').textContent='Buffering…'});
  v.addEventListener('timeupdate',()=>{if(!state.playerTarget?.seekable||state.isScrubbing)return;const d=v.duration||0;if(d>0){$('seekBar').value=String(Math.floor((v.currentTime/d)*1000));$('currentTime').textContent=fmtTime(v.currentTime);$('durationTime').textContent=fmtTime(d)}});
  v.addEventListener('ended',()=>{clearResume();closePlayer()});
  v.addEventListener('error',()=>handlePlaybackError());
  v.addEventListener('webkitpresentationmodechanged',updatePipButton);
  v.addEventListener('enterpictureinpicture',updatePipButton);v.addEventListener('leavepictureinpicture',updatePipButton);
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&state.playerTarget){await acquireWakeLock();if(v.paused&&!v.ended&&document.pictureInPictureElement!==v)v.play().catch(()=>{})}});
  attachGestures();
}
function handlePlaybackError(){
  const t=state.playerTarget;if(!t)return;clearTimeout(state.startupTimer);
  if(!navigator.onLine){$('playerStatus').textContent='Offline — waiting for network';showControls(true);return}
  if(state.sourceIndex+1<t.urls.length){loadSource(state.sourceIndex+1,t.seekable?$('video').currentTime:0);return}
  if(state.retryCount<3){const delay=[1000,2000,4000][state.retryCount++];$('playerStatus').textContent=`Reconnecting in ${delay/1000}s…`;clearTimeout(state.retryTimer);state.retryTimer=setTimeout(()=>loadSource(state.sourceIndex,t.seekable?$('video').currentTime:0),delay);return}
  fatalPlayerError('Unable to play this stream');
}
function fatalPlayerError(msg){$('playerStatus').textContent=msg;$('retryBtn').classList.remove('hidden');$('playerHint').textContent=navigator.onLine?'Try Retry or another channel/source.':'Check your internet connection.';$('playerHint').classList.remove('hidden');showControls(true)}
function applyScale(){const pv=$('playerView');pv.classList.remove('fit','fill','zoom');pv.classList.add(state.scale);$('scaleBtn').textContent=state.scale.toUpperCase();localStorage.setItem('ayman_scale',state.scale)}
function cycleScale(){state.scale=state.scale==='fit'?'fill':state.scale==='fill'?'zoom':'fit';applyScale();toast(`Display: ${state.scale.toUpperCase()}`);showControls()}
function showControls(sticky=false){const c=$('playerControls');c.classList.add('visible');clearTimeout(state.controlsTimer);if(!sticky)state.controlsTimer=setTimeout(()=>{if(!$('video').paused&&!state.isScrubbing&&$('sheet').classList.contains('hidden'))hideControls()},CONTROL_HIDE_MS)}
function hideControls(){if(state.isScrubbing)return;$('playerControls').classList.remove('visible')}
function startProgressSaver(){clearInterval(state.progressTimer);state.progressTimer=setInterval(persistResume,45000)}
function persistResume(){const t=state.playerTarget,v=$('video');if(!t?.seekable||v.currentTime<10)return;const d=Number.isFinite(v.duration)?v.duration:0;if(d&&v.currentTime>=d-30){clearResume();return}state.resume[t.resumeKey]={time:Math.floor(v.currentTime),duration:Math.floor(d),timestamp:Date.now(),name:t.title,icon:t.icon,type:t.type,itemId:t.itemId,ext:t.ext};saveJSON('ayman_resume',state.resume)}
function clearResume(){const t=state.playerTarget;if(t?.resumeKey&&state.resume[t.resumeKey]){delete state.resume[t.resumeKey];saveJSON('ayman_resume',state.resume)}}
async function acquireWakeLock(){try{if('wakeLock'in navigator){if(state.wakeLock&&!state.wakeLock.released)return;state.wakeLock=await navigator.wakeLock.request('screen')}}catch{}}
async function releaseWakeLock(){try{await state.wakeLock?.release()}catch{}state.wakeLock=null}
async function closePlayer(){persistResume();clearInterval(state.progressTimer);clearTimeout(state.retryTimer);clearTimeout(state.startupTimer);const v=$('video');v.pause();v.removeAttribute('src');v.load();await releaseWakeLock();try{if(document.fullscreenElement)await document.exitFullscreen()}catch{}try{screen.orientation?.unlock?.()}catch{}state.playerTarget=null;state.playerQueue=null;state.gesture=null;state.gestureSeek=null;setView('mainView');renderLastViewAfterPlayer()}
function renderLastViewAfterPlayer(){const v=state.lastView;if(v?.kind==='content'&&v.type)return openContent(v.type,false,v.category||'0');if(v?.kind==='favorites')return renderFavorites();if(v?.kind==='continue')return renderContinue();if(v?.kind==='search')return renderSearch();renderHome()}
function updateRotateHint(){const portrait=matchMedia('(orientation: portrait)').matches;$('rotateHint').classList.toggle('hidden',!portrait||!state.playerTarget)}
addEventListener('orientationchange',updateRotateHint);addEventListener('resize',updateRotateHint);
function updatePipButton(){const v=$('video');let active=false;try{active=(v.webkitPresentationMode==='picture-in-picture')||document.pictureInPictureElement===v}catch{}$('pipBtn').classList.toggle('pip-active',active);$('pipBtn').textContent=active?'▣':'▣'}

function zapChannel(delta){
  const q=state.playerQueue;if(!q||q.type!=='LIVE'||!q.items.length)return;
  state.retryCount=0;
  q.index=(q.index+delta+q.items.length)%q.items.length;const it=q.items[q.index];const target=buildTarget('LIVE',it);target.start=0;state.playerTarget=target;rememberLastPlayed(target);$('playerTitle').textContent=target.title;$('playerStatus').textContent='Changing channel…';showControls();loadSource(0,0);
}
function gestureMessage(text){const g=$('gestureOverlay');g.textContent=text;g.classList.remove('hidden');clearTimeout(g._x);g._x=setTimeout(()=>g.classList.add('hidden'),650)}
function attachGestures(){
  const pv=$('playerView');if(pv._gestureBound)return;pv._gestureBound=true;
  pv.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||e.target.closest('button,input,.player-bottom,.player-top'))return;
    const t=e.touches[0];state.gesture={x:t.clientX,y:t.clientY,time:Date.now(),moved:false};state.gestureSeek=null;
  },{passive:true});
  pv.addEventListener('touchmove',e=>{
    if(!state.gesture||e.touches.length!==1)return;const t=e.touches[0],dx=t.clientX-state.gesture.x,dy=t.clientY-state.gesture.y;if(Math.abs(dx)<18&&Math.abs(dy)<18)return;state.gesture.moved=true;
    if(Math.abs(dx)>Math.abs(dy)*1.15){
      const v=$('video');if(state.playerTarget?.seekable&&Number.isFinite(v.duration)&&v.duration>0){const delta=Math.round((dx/window.innerWidth)*180);const next=Math.max(0,Math.min(v.duration,v.currentTime+delta));state.gestureSeek=next;gestureMessage(`${delta>=0?'+':''}${delta}s · ${fmtTime(next)}`)}
      else if(Math.abs(dx)>55)gestureMessage(dx>0?'Previous channel':'Next channel');
    }
  },{passive:true});
  pv.addEventListener('touchend',e=>{
    if(!state.gesture)return;const g=state.gesture;state.gesture=null;
    if(g.moved){
      if(state.gestureSeek!=null&&state.playerTarget?.seekable){$('video').currentTime=state.gestureSeek;state.gestureSeek=null;showControls();return}
      const touch=e.changedTouches?.[0];if(touch&&!state.playerTarget?.seekable){const dx=touch.clientX-g.x;if(Math.abs(dx)>70)zapChannel(dx>0?-1:1)}return;
    }
    const touch=e.changedTouches?.[0];if(!touch)return;const now=Date.now();
    if(now-state.lastTapAt<320&&Math.abs(touch.clientX-state.lastTapX)<90){
      state.lastTapAt=0;const v=$('video');if(state.playerTarget?.seekable){const delta=touch.clientX<window.innerWidth/2?-10:10;v.currentTime=Math.max(0,Math.min(v.duration||Infinity,v.currentTime+delta));gestureMessage(`${delta>0?'+':''}${delta}s`)}else zapChannel(touch.clientX<window.innerWidth/2?-1:1);showControls();return;
    }
    state.lastTapAt=now;state.lastTapX=touch.clientX;setTimeout(()=>{if(state.lastTapAt===now){state.lastTapAt=0;if($('playerControls').classList.contains('visible'))hideControls();else showControls()}},330);
  },{passive:true});
}

function renderContinue(){
  saveLastView({kind:'continue'});activateTab('continue');const c=$('mainContent');const list=Object.entries(state.resume).filter(([,r])=>r&&r.time>10).sort((a,b)=>b[1].timestamp-a[1].timestamp);c.innerHTML='<div class="section-head"><h2>Continue Watching</h2><button class="back-link" id="clearContinue">Clear all</button></div><div class="grid" id="continueGrid"></div>';const g=$('continueGrid');
  $('clearContinue').onclick=()=>{state.resume={};saveJSON('ayman_resume',state.resume);renderContinue()};
  if(!list.length){g.innerHTML='<div class="empty">Nothing to resume yet</div>';return}
  list.forEach(([key,r])=>{const b=document.createElement('div');b.className='card';b.setAttribute('role','button');const pct=r.duration?Math.min(100,(r.time/r.duration)*100):0;b.innerHTML=`<div class="poster">${r.icon?`<img loading="lazy" decoding="async" src="${escapeHtml(r.icon)}" alt="">`:'<div class="fallback-logo">A</div>'}</div><button class="fav-btn remove-resume" aria-label="Remove">×</button><div class="progress"><span style="width:${pct}%"></span></div><div class="name">${escapeHtml(r.name)}</div>`;b.querySelector('.remove-resume').onclick=ev=>{ev.stopPropagation();delete state.resume[key];saveJSON('ayman_resume',state.resume);renderContinue()};b.onclick=()=>{const urls=r.type==='VOD'?[`${state.server}/movie/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${r.itemId}.${r.ext||'mp4'}`]:[`${state.server}/series/${encodeURIComponent(state.user)}/${encodeURIComponent(state.pass)}/${r.itemId}.${r.ext||'mp4'}`];startPlayer({type:r.type,title:r.name,icon:r.icon,itemId:String(r.itemId),ext:r.ext||'mp4',urls,seekable:true,resumeKey:key,start:r.time})};g.appendChild(b)})
}
async function renderFavorites(){
  saveLastView({kind:'favorites'});activateTab('favorites');const c=$('mainContent');c.innerHTML='<div class="section-head"><h2>Favorites</h2></div><div class="loading">Loading…</div>';
  try{const sections=[];for(const type of ['LIVE','VOD','SERIES']){const ids=state.favorites[type]||[];if(!ids.length)continue;const items=await getStreams(type,'0');sections.push([type,items.filter(x=>ids.includes(itemId(type,x)))])}c.innerHTML='';if(!sections.length){c.innerHTML='<div class="empty">No favorites yet</div>';return}sections.forEach(([type,items])=>{const h=document.createElement('div');h.className='section-head';h.innerHTML=`<h2>${type==='LIVE'?'Live':type==='VOD'?'Movies':'Series'}</h2>`;const g=document.createElement('div');g.className='grid';c.append(h,g);items.forEach(it=>{const b=document.createElement('div');b.className='card '+(type==='LIVE'?'live-card':'');b.setAttribute('role','button');b.innerHTML=`<div class="poster">${itemPoster(it)?`<img loading="lazy" decoding="async" src="${escapeHtml(itemPoster(it))}" alt="">`:'<div class="fallback-logo">A</div>'}</div><button class="fav-btn" aria-label="Remove favorite">♥</button><div class="name">${escapeHtml(itemName(it))}</div>`;b.querySelector('.fav-btn').onclick=ev=>{ev.stopPropagation();toggleFav(type,it);renderFavorites()};b.onclick=()=>type==='SERIES'?openSeries(it):playItem(type,it);g.appendChild(b)})})}catch(e){renderApiError(e,renderFavorites)}
}
async function renderSearch(){saveLastView({kind:'search'});activateTab('search');const c=$('mainContent');c.innerHTML='<div class="section-head"><h2>Search</h2></div><div class="searchbox"><input id="globalSearch" type="search" placeholder="Search live, movies and series..."></div><div id="searchResults" class="empty">Type at least 2 characters</div>';let t;$('globalSearch').oninput=e=>{clearTimeout(t);t=setTimeout(()=>globalSearch(e.target.value),250)}}
async function globalSearch(q){q=q.trim().toLowerCase();const host=$('searchResults');if(q.length<2){host.className='empty';host.innerHTML='Type at least 2 characters';return}host.className='loading';host.textContent='Searching…';try{const all=await Promise.all(['LIVE','VOD','SERIES'].map(t=>getStreams(t,'0')));host.className='';host.innerHTML='';['LIVE','VOD','SERIES'].forEach((type,i)=>{const matches=all[i].filter(x=>itemName(x).toLowerCase().includes(q)).slice(0,100);if(!matches.length)return;const h=document.createElement('div');h.className='section-head';h.innerHTML=`<h2>${type==='LIVE'?'Live':type==='VOD'?'Movies':'Series'}</h2>`;const g=document.createElement('div');g.className='grid';host.append(h,g);matches.forEach(it=>{const b=document.createElement('button');b.className='card '+(type==='LIVE'?'live-card':'');b.innerHTML=`<div class="poster">${itemPoster(it)?`<img loading="lazy" decoding="async" src="${escapeHtml(itemPoster(it))}" alt="">`:'<div class="fallback-logo">A</div>'}</div><div class="name">${escapeHtml(itemName(it))}</div>`;b.onclick=()=>type==='SERIES'?openSeries(it):playItem(type,it);g.appendChild(b)})});if(!host.children.length){host.className='empty';host.textContent='No results'}}catch(e){renderApiError(e,()=>globalSearch(q))}}
function renderApiError(e,retry){const c=$('mainContent');const raw=e?.message||String(e);let title='Connection error',hint='';if(/abort/i.test(raw)){title='Server took too long';hint='<p>The request timed out. Try again or refresh the cache.</p>'}else if(/Failed to fetch/i.test(raw)){title='Network/CORS error';hint=state.proxy?'<p>Check the IPTV server or Cloudflare Worker.</p>':'<p>Deploy the included Cloudflare Worker and paste its URL in Connection settings.</p>'}c.innerHTML=`<div class="empty error-card"><h3>${title}</h3><p>${escapeHtml(raw)}</p>${hint}<button class="secondary" id="retryApi">Retry</button></div>`;$('retryApi').onclick=retry}

function showSheet(title,options,onPick){$('sheetTitle').textContent=title;const b=$('sheetBody');b.innerHTML='';options.forEach((o,i)=>{const x=document.createElement('button');x.className='sheet-option'+(o.active?' active':'');x.textContent=o.label;x.onclick=()=>{onPick(o,i);closeSheet()};b.appendChild(x)});$('sheet').classList.remove('hidden');showControls(true)}
function closeSheet(){$('sheet').classList.add('hidden');showControls()}
function openAudio(){const v=$('video'),a=v.audioTracks;if(!a||!a.length){toast('No selectable audio tracks');return}showSheet('Audio track',Array.from(a).map((t,i)=>({label:t.label||t.language||`Track ${i+1}`,active:t.enabled})),(_,i)=>{for(let n=0;n<a.length;n++)a[n].enabled=n===i})}
function openSubs(){const v=$('video'),t=v.textTracks;if(!t||!t.length){toast('No subtitles available');return}const opts=[{label:'Off',active:Array.from(t).every(x=>x.mode!=='showing')},...Array.from(t).map((x,i)=>({label:x.label||x.language||`Subtitle ${i+1}`,active:x.mode==='showing',idx:i}))];showSheet('Subtitles',opts,(o)=>{for(let n=0;n<t.length;n++)t[n].mode='disabled';if(o.idx!=null)t[o.idx].mode='showing'})}
async function togglePip(){const v=$('video');try{if(v.webkitSupportsPresentationMode&&typeof v.webkitSetPresentationMode==='function'){v.webkitSetPresentationMode(v.webkitPresentationMode==='picture-in-picture'?'inline':'picture-in-picture')}else if(document.pictureInPictureElement){await document.exitPictureInPicture()}else if(v.requestPictureInPicture){await v.requestPictureInPicture()}else toast('Picture in Picture is not available here')}catch{toast('Picture in Picture could not start')}updatePipButton()}

$('loginForm').onsubmit=async e=>{e.preventDefault();const err=$('loginError');err.classList.add('hidden');const btn=e.submitter;btn.disabled=true;btn.textContent='CONNECTING…';try{await login($('serverInput').value,$('usernameInput').value,$('passwordInput').value,$('proxyInput').value,$('rememberInput').checked)}catch(ex){err.textContent=(ex.message||String(ex))+(!state.proxy?' — If credentials are correct, this may be a CORS restriction.':'');err.classList.remove('hidden')}finally{btn.disabled=false;btn.textContent='CONNECT'}};
$('logoutBtn').onclick=async()=>{await saveCredentials(null);state.server=state.user=state.pass=state.proxy='';setView('loginView')};
$('refreshBtn').onclick=()=>{state.categories={LIVE:null,VOD:null,SERIES:null};state.categoryAt={LIVE:0,VOD:0,SERIES:0};state.streams.clear();state.seriesInfo.clear();toast('Cache cleared');restoreLastView()};
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{const t=b.dataset.tab;if(t==='home')renderHome();else if(t==='favorites')renderFavorites();else if(t==='continue')renderContinue();else renderSearch()});
$('playerBack').onclick=closePlayer;$('playPauseBtn').onclick=()=>{const v=$('video');v.paused?v.play():v.pause();showControls(true)};$('prevBtn').onclick=()=>zapChannel(-1);$('nextBtn').onclick=()=>zapChannel(1);$('scaleBtn').onclick=cycleScale;$('audioBtn').onclick=openAudio;$('subBtn').onclick=openSubs;$('pipBtn').onclick=togglePip;$('retryBtn').onclick=()=>loadSource(state.sourceIndex,$('video').currentTime||0);$('seekBar').oninput=e=>{state.isScrubbing=true;const v=$('video');if(Number.isFinite(v.duration)&&v.duration>0){const next=(Number(e.target.value)/1000)*v.duration;$('currentTime').textContent=fmtTime(next)}showControls(true)};$('seekBar').onchange=e=>{const v=$('video');if(Number.isFinite(v.duration)&&v.duration>0)v.currentTime=(Number(e.target.value)/1000)*v.duration;state.isScrubbing=false;showControls()};$('sheetClose').onclick=closeSheet;$('sheet').onclick=e=>{if(e.target===$('sheet'))closeSheet()};

addEventListener('online',()=>{if(state.playerTarget){toast('Internet restored');loadSource(state.sourceIndex,$('video').currentTime||0)}});addEventListener('offline',()=>{if(state.playerTarget){$('playerStatus').textContent='Offline — waiting for network';showControls(true)}});
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

(async function init(){
  const creds=await loadCredentials();if(creds){$('serverInput').value=creds.server||'';$('usernameInput').value=creds.user||'';$('passwordInput').value=creds.pass||'';$('proxyInput').value=creds.proxy||'';try{await login(creds.server,creds.user,creds.pass,creds.proxy,true);return}catch{}}
  setView('loginView');
})();
})();
