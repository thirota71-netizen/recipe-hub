const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function photoBounds(operators,OPS,viewport){
  let matrix=[1,0,0,1,0,0];const stack=[],photos=[];
  for(let i=0;i<operators.fnArray.length;i++){
    const op=operators.fnArray[i],args=operators.argsArray[i];
    if(op===OPS.save)stack.push([...matrix]);
    else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(op===OPS.transform)matrix=multiply(matrix,args);
    else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject){
      const m=multiply(viewport.transform,matrix),corners=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>point(m,x,y));
      const x=Math.max(0,Math.min(...corners.map(p=>p[0]))),y=Math.max(0,Math.min(...corners.map(p=>p[1])));
      const width=Math.min(viewport.width,Math.max(...corners.map(p=>p[0])))-x,height=Math.min(viewport.height,Math.max(...corners.map(p=>p[1])))-y;
      const area=width*height,ratio=width/height;
      // Exclude avatars, narrow decorations and full-page scans containing text.
      if(width>=40&&height>=40&&ratio>=0.35&&ratio<=3&&area<viewport.width*viewport.height*0.85)photos.push({x,y,width,height,score:area*(1+2*(1-y/viewport.height))});
    }
  }
  return photos.sort((a,b)=>b.score-a.score);
}
export async function extractPdfPhoto(page,pdfjs,signal){
  const check=()=>{if(signal?.aborted)throw new DOMException('読み取りを中止しました。','AbortError');};check();
  const size=page.getViewport({scale:1}),bounds=photoBounds(await page.getOperatorList(),pdfjs.OPS,size)[0];if(!bounds)return null;
  const scale=Math.min(2.5,Math.sqrt(4000000/(size.width*size.height))),viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas'),crop=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}),stop=()=>render.cancel();signal?.addEventListener('abort',stop,{once:true});
  try{await render.promise;check();crop.width=Math.max(1,Math.round(bounds.width*scale));crop.height=Math.max(1,Math.round(bounds.height*scale));crop.getContext('2d').drawImage(canvas,bounds.x*scale,bounds.y*scale,bounds.width*scale,bounds.height*scale,0,0,crop.width,crop.height);
    const blob=await new Promise((resolve,reject)=>crop.toBlob(value=>value?resolve(value):reject(Error('写真を取り出せませんでした。')),'image/jpeg',0.9));check();if(blob.size>2*1024*1024)throw Error('写真が大きすぎます。');return{blob,width:crop.width,height:crop.height,page:page.pageNumber};
  }finally{signal?.removeEventListener('abort',stop);canvas.width=canvas.height=crop.width=crop.height=0;}
}
