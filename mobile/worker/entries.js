const MAX_FILE=10*1024*1024;
const MAX_PHOTO=2*1024*1024;
const fields={title:200,description:10000,servings:200,author:200};
function text(value,max,label){if(typeof value!=='string'||value.length>max)throw Error(label+'の文字数を確認してください。');return value.trim();}
export function validateEntry(data){
  if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(data.id||''))throw Error('登録情報を作り直してお試しください。');
  const recipe={id:data.id,url:'recipehub:'+data.id,image:'',site:'手入力',sourceType:'manual'};
  for(const [field,max] of Object.entries(fields))recipe[field]=text(data[field]??'',max,field==='title'?'料理名':'入力内容');
  if(!recipe.title)throw Error('料理名を入力してください。');
  for(const field of ['ingredients','steps']){if(!Array.isArray(data[field])||data[field].length>200)throw Error('材料・手順は各200行以内で入力してください。');recipe[field]=data[field].map(value=>text(value,5000,'材料・手順')).filter(Boolean);}
  if(!recipe.ingredients.length||!recipe.steps.length)throw Error('材料と作り方を入力してください。');
  if(data.minutes!==null&&(!Number.isInteger(data.minutes)||data.minutes<1||data.minutes>10080))throw Error('調理時間は1〜10080分、または空欄にしてください。');
  recipe.minutes=data.minutes;return recipe;
}
async function requestBytes(request){const reader=request.body?.getReader();if(!reader)throw Error('ファイルを選択してください。');const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE+MAX_PHOTO+300000){await reader.cancel();throw Error('添付ファイルのサイズを確認してください。');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}
async function existing(db,id){const row=await db.prepare('SELECT body FROM recipes WHERE id=?').bind(id).first();return row?JSON.parse(row.body):null;}
export async function saveEntry(request,env){
  const multipart=request.headers.get('Content-Type')?.startsWith('multipart/form-data');let data,file,photo;
  if(multipart){const bytes=await requestBytes(request);const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();const raw=form.get('recipe');if(typeof raw!=='string'||raw.length>200000)throw Error('入力内容が長すぎます。');data=JSON.parse(raw);file=form.get('file');photo=form.get('photo');if(!file||typeof file.arrayBuffer!=='function')throw Error('ファイルを選択してください。');}
  else{const bytes=await requestBytes(request);if(bytes.length>200000)throw Error('入力内容が長すぎます。');data=JSON.parse(new TextDecoder().decode(bytes));}
  const recipe=validateEntry(data),previous=await existing(env.DB,recipe.id);if(previous)return previous;
  let key,photoKey;const cleanup=async()=>{for(const item of [key,photoKey])if(item){try{await env.FILES.delete(item);}catch{console.error('Recipe attachment cleanup failed');}}};
  if(file){
    if(!env.FILES)throw Error('ファイル保存が利用できません。入力内容は残っています。後でもう一度お試しください。');
    if(!file.size||file.size>MAX_FILE)throw Error('ファイルは空ではない10MB以内のものを選んでください。');
    const ext=file.name.toLowerCase().split('.').pop(),types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'};
    if(!types[ext])throw Error('PDF・Word（.docx）・テキスト（.txt）に対応しています。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(ext==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('PDFファイルの形式を確認してください。');
    if(ext==='docx'&&(bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4))throw Error('Wordファイルの形式を確認してください。');
    let photoBytes;if(photo){if(ext!=='pdf'||typeof photo.arrayBuffer!=='function'||photo.type!=='image/jpeg'||!photo.size||photo.size>MAX_PHOTO)throw Error('完成写真は2MB以内のJPEGにしてください。');photoBytes=new Uint8Array(await photo.arrayBuffer());if(photoBytes[0]!==255||photoBytes[1]!==216||photoBytes.at(-2)!==255||photoBytes.at(-1)!==217)throw Error('完成写真の形式を確認してください。');}
    key='recipes/'+recipe.id+'/'+crypto.randomUUID()+'.'+ext;
    try{await env.FILES.put(key,bytes,{httpMetadata:{contentType:types[ext]}});if(photoBytes){photoKey='recipes/'+recipe.id+'/'+crypto.randomUUID()+'.jpg';await env.FILES.put(photoKey,photoBytes,{httpMetadata:{contentType:'image/jpeg'}});recipe.sourcePhoto={key:photoKey,size:photoBytes.length,type:'image/jpeg'};recipe.image='/api/entry-images/'+recipe.id;}}catch{await cleanup();throw Error('ファイルを保存できませんでした。入力内容を残しているので再度お試しください。');}
    recipe.site='ファイルから追加';recipe.sourceType='file';recipe.sourceFile={name:file.name.replace(/[\r\n\u0000]/g,'').slice(0,240),size:file.size,type:types[ext],key};
  }
  try{const result=await env.DB.prepare('INSERT INTO recipes (id,url,body,created) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(recipe.id,recipe.url,JSON.stringify(recipe),new Date().toISOString()).run();if(result.meta?.changes===0){await cleanup();return await existing(env.DB,recipe.id);}return recipe;}
  catch{await cleanup();throw Error('レシピを保存できませんでした。入力内容は残っています。再度お試しください。');}
}
export async function downloadPhoto(id,env,headers){const recipe=await existing(env.DB,id);if(!recipe?.sourcePhoto)return new Response('Not found',{status:404});if(!env.FILES)return new Response('File storage unavailable',{status:503});const photo=await env.FILES.get(recipe.sourcePhoto.key);if(!photo)return new Response('Not found',{status:404});return new Response(photo.body,{headers:{...headers,'Content-Type':'image/jpeg','Content-Length':String(recipe.sourcePhoto.size),'Cache-Control':'no-store'}});}
export async function downloadFile(id,env,headers){const recipe=await existing(env.DB,id);if(!recipe?.sourceFile)return new Response('Not found',{status:404});if(!env.FILES)return new Response('File storage unavailable',{status:503});const file=await env.FILES.get(recipe.sourceFile.key);if(!file)return new Response('Not found',{status:404});return new Response(file.body,{headers:{...headers,'Content-Type':recipe.sourceFile.type,'Content-Length':String(recipe.sourceFile.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(recipe.sourceFile.name),'Cache-Control':'no-store'}});}
