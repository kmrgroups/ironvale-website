import Busboy from 'busboy';

export const config = { api: { bodyParser: false } };

function parseMultipart(req){
  return new Promise((resolve,reject)=>{
    const bb=Busboy({headers:req.headers, limits:{files:1,fileSize:20*1024*1024}});
    let fileBufs=[], fileName='', mime='';
    bb.on('file',(name,file,info)=>{
      fileName=info.filename||'drawing'; mime=info.mimeType||'application/octet-stream';
      file.on('data',d=>fileBufs.push(d));
      file.on('limit',()=>reject(new Error('Drawing exceeds 20MB.')));
    });
    bb.on('finish',()=>resolve({buffer:Buffer.concat(fileBufs),fileName,mime}));
    bb.on('error',reject);
    req.pipe(bb);
  });
}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Use POST'});
  try{
    const url=process.env.DRAWING_CONVERTER_URL;
    if(!url) return res.status(503).json({ok:false,error:'CAD conversion is not configured. Set DRAWING_CONVERTER_URL to a converter service that accepts multipart field "file" and returns JSON {dataUrl}. PDF conversion is handled in the browser.'});
    const {buffer,fileName,mime}=await parseMultipart(req);
    if(!buffer.length) return res.status(400).json({ok:false,error:'No drawing file received.'});
    const fd=new FormData();
    fd.append('file',new Blob([buffer],{type:mime}),fileName);
    const r=await fetch(url,{method:'POST',body:fd});
    const text=await r.text();
    let j={}; try{j=JSON.parse(text);}catch(e){}
    if(!r.ok || !j.dataUrl) return res.status(502).json({ok:false,error:j.error||'The CAD conversion service did not return an AI-readable image.'});
    return res.status(200).json({ok:true,dataUrl:j.dataUrl,fileName:(j.fileName||fileName.replace(/\.[^.]+$/i,'.jpg'))});
  }catch(e){ console.log('DRAWING ERROR:',e.message); return res.status(500).json({ok:false,error:e.message}); }
}
