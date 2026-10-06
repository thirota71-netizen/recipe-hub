import {fetchPage,boundedText,robotsAllowed,importRecipe} from './index.js';

export const SOURCES=[
  {host:'www.kikkoman.co.jp',name:'キッコーマン',fallback:'https://www.kikkoman.co.jp/homecook/sitemap-images.xml',recipe:/^\/homecook\/search\/recipe\//},
  {host:'delishkitchen.tv',mapHost:'misc.delishkitchen.tv',name:'DELISH KITCHEN',fallback:'https://delishkitchen.tv/sitemap.xml.gz',recipe:/^\/recipes\//},
  {host:'cookien.com',name:'つくおき',fallback:'https://cookien.com/sitemap.xml',recipe:/^\/recipe\/\d+\//},
  {host:'www.justonecookbook.com',name:'Just One Cookbook',fallback:'https://www.justonecookbook.com/sitemap_index.xml',mapPattern:/post-sitemap/,recipe:/^\/(?!about\/|contact\/|privacy-policy\/|start-here\/)[a-z0-9-]+\/$/}
];
const DAY=86400000;
const CRAWLER_VERSION=3;
// The collection day starts at 06:00 Japan time, matching the cloud schedule.
export const runWindow=ms=>Math.floor((ms+3*60*60000)/DAY);
const LIMIT=4;
function allowedSourceUrl(raw,source,map=false){try{const u=new URL(raw);return u.protocol==='https:'&&(u.hostname===source.host||(map&&u.hostname===source.mapHost&&/^\/sitemaps\/[^/]+\.xml(?:\.gz)?$/.test(u.pathname)))&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}}
export function sitemapEntries(xml,source){const isIndex=/<(?:\w+:)?sitemapindex\b/i.test(xml);const values=[];for(const m of xml.matchAll(/<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc>/gi)){const raw=m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim().replace(/&amp;/g,'&');const url=allowedSourceUrl(raw,source,isIndex);if(url&&(isIndex||source.recipe.test(new URL(url).pathname)))values.push(url);}return{isIndex,urls:[...new Set(values)]};}
function robotsDelay(text){let agents=[],delay=1,groupDelay=0;function apply(){if(agents.some(a=>a==='*'||'recipehub'.startsWith(a)))delay=Math.max(delay,groupDelay);}for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim(),i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();if(key==='user-agent'){if(groupDelay){apply();agents=[];groupDelay=0;}agents.push(v.toLowerCase());}else if(key==='crawl-delay'){groupDelay=Number(v)||0;}}apply();return delay;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function state(db,key,initial){const row=await db.prepare('SELECT body FROM crawl_state WHERE key=?').bind(key).first();return row?JSON.parse(row.body):initial;}
async function saveState(db,key,value){await db.prepare('INSERT INTO crawl_state (key,body) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').bind(key,JSON.stringify(value)).run();}
export async function readSitemap(response,source,skip=0){
  const encoded=response.url?.endsWith('.gz')&&!response.headers.get('Content-Encoding');
  const body=encoded?response.body.pipeThrough(new DecompressionStream('gzip')):response.body;
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,index=false,seen=0;const urls=[];
  while(true){const {value,done}=await reader.read();if(done){if(index)return{...sitemapEntries(buffer,source),finished:true,nextOffset:0};return{isIndex:false,urls,finished:true,nextOffset:seen};}
    bytes+=value.length;buffer+=decoder.decode(value,{stream:true});
    if(/<(?:\w+:)?sitemapindex\b/i.test(buffer))index=true;
    if(index){if(bytes>6000000){await reader.cancel();throw Error('サイトマップ索引が大きすぎます。');}continue;}
    let match;const re=/<(?:\w+:)?url\b[^>]*>[\s\S]*?<\/(?:\w+:)?url>/gi;
    let consumed=0;
    while((match=re.exec(buffer))){consumed=re.lastIndex;for(const url of sitemapEntries('<urlset>'+match[0]+'</urlset>',source).urls){seen++;if(seen>skip)urls.push(url);}if(urls.length>=100){await reader.cancel();return{isIndex:false,urls,finished:false,nextOffset:seen};}}
    if(consumed)buffer=buffer.slice(consumed);
    if(buffer.length>200000||bytes>20000000){await reader.cancel();throw Error('このサイトマップは今回の読取上限に達しました。');}
  }
}

async function collectSource(source,db,now){
  const report={site:source.name,discovered:0,imported:0,skipped:0,errors:[]};
  let robots='';
  const rr=await fetchPage('https://'+source.host+'/robots.txt');
  if(rr.status!==404){if(!rr.ok)throw Error('robots.txtを確認できませんでした。');robots=await boundedText(rr,500000);}
  const interval=robotsDelay(robots);
  if(interval>10)throw Error('サイトの指定するアクセス間隔が長いため、この実行では巡回しません。');
  let info=await state(db,source.host,{maps:[],visited:[],pending:[],resetAt:0});
  if(!info.maps.length&&!info.pending.length&&(!info.resetAt||now-info.resetAt>30*DAY)){
    const maps=[...robots.matchAll(/^sitemap:\s*(.+)$/gim)].map(m=>allowedSourceUrl(m[1].trim(),source)).filter(Boolean);
    // Start with recipe-focused sitemap when the source publishes one.
    info={maps:source.host==='www.kikkoman.co.jp'?[source.fallback,...maps.filter(x=>x!==source.fallback)]:maps.length?maps:[source.fallback],visited:[],pending:[],resetAt:now};
  }
  // At most two sitemap documents per source/run; retain the frontier for tomorrow.
  for(let i=0;i<2&&info.maps.length&&info.pending.length<20;i++){
    const url=info.maps.shift();if(info.visited.includes(url))continue;
    if(!robotsAllowed(robots,url)){report.errors.push('サイトマップの取得が禁止されています。');continue;}
    if(new URL(url).hostname!==source.host){const extra=await fetchPage(new URL('/robots.txt',url).href);if(extra.status!==404){if(!extra.ok||!robotsAllowed(await boundedText(extra,500000),url)){report.errors.push('サイトマップ配信先の取得が許可されていません。');continue;}}}
    await sleep(interval*1000);
    const response=await fetchPage(url);
    if(!response.ok){report.errors.push('サイトマップ取得失敗: '+response.status);info.maps.push(url);break;}
    let entries;try{entries=await readSitemap(response,source,info.offsets?.[url]||0);}catch(e){report.errors.push('サイトマップ読み込み失敗: '+e.message);info.maps.push(url);break;}
    if(entries.finished){info.visited.push(url);info.visited=info.visited.slice(-500);}else{info.offsets??={};info.offsets[url]=entries.nextOffset;info.maps.unshift(url);}
    if(entries.isIndex)info.maps.push(...entries.urls.filter(u=>(!source.mapPattern||source.mapPattern.test(new URL(u).pathname))&&!info.visited.includes(u)&&!info.maps.includes(u)).slice(0,200));
    else info.pending.push(...entries.urls.slice(0,10000));
  }
  const urls=info.pending.splice(0,20).filter(u=>robotsAllowed(robots,u));
  if(urls.length){await db.batch(urls.map(url=>db.prepare('INSERT INTO crawl_queue (url,host) VALUES (?,?) ON CONFLICT(url) DO NOTHING').bind(url,source.host)));report.discovered=urls.length;}
  await saveState(db,source.host,info);
  const {results}=await db.prepare('SELECT url FROM crawl_queue WHERE host=? AND next_at<=? ORDER BY next_at ASC,url ASC LIMIT ?').bind(source.host,now,LIMIT).all();
  for(const row of results){
    if(!robotsAllowed(robots,row.url)){report.skipped++;await db.prepare('UPDATE crawl_queue SET status=?,next_at=?,error=? WHERE url=?').bind('blocked',now+30*DAY,'robots.txtで禁止',row.url).run();continue;}
    await sleep(interval*1000);
    try{await importRecipe(row.url,db,robots);report.imported++;await db.prepare('UPDATE crawl_queue SET status=?,next_at=?,error=NULL WHERE url=?').bind('done',now+30*DAY,row.url).run();}
    catch(e){report.skipped++;report.errors.push(e.message);await db.prepare('UPDATE crawl_queue SET status=?,next_at=?,error=? WHERE url=?').bind('error',now+7*DAY,String(e.message).slice(0,500),row.url).run();}
  }
  return report;
}

export async function crawlStatus(db){const last=await state(db,'last_run',null);const counts=await db.prepare('SELECT COUNT(*) AS recipes FROM recipes').first();const queue=await db.prepare('SELECT COUNT(*) AS queued FROM crawl_queue WHERE status=?').bind('pending').first();return{sources:SOURCES.map(s=>s.name),last,total:counts?.recipes||0,queued:queue?.queued||0};}

export async function runCrawl(db){
  const now=Date.now();
  await db.prepare('INSERT INTO crawl_state (key,body,busy_until) VALUES (?,?,0) ON CONFLICT(key) DO NOTHING').bind('lock','{}').run();
  const lease=await db.prepare('UPDATE crawl_state SET busy_until=? WHERE key=? AND busy_until<?').bind(now+5*60000,'lock',now).run();
  if(!lease.meta?.changes)return{status:'busy',message:'収集はすでに実行中です。'};
  try{
    const previous=await state(db,'last_run',null);
    if(previous?.version===CRAWLER_VERSION&&previous?.finishedAt&&runWindow(now)===runWindow(Date.parse(previous.finishedAt)))return{status:'already_run',last:previous};
    const report={version:CRAWLER_VERSION,status:'succeeded',startedAt:new Date(now).toISOString(),finishedAt:null,imported:0,sources:[]};
    for(const source of SOURCES){try{const r=await collectSource(source,db,now);report.sources.push(r);report.imported+=r.imported;}catch(e){report.sources.push({site:source.name,imported:0,errors:[String(e.message)]});}}
    report.status=report.imported?'succeeded':'no_imports';report.finishedAt=new Date().toISOString();
    await saveState(db,'last_run',report);
    return report;
  }finally{await db.prepare('UPDATE crawl_state SET busy_until=0 WHERE key=? AND busy_until=?').bind('lock',now+5*60000).run();}
}
