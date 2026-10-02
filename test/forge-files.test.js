/** Lost import replies must recover by ID; downloads must publish complete bytes only. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

it('recovers file IDs across lost replies and keeps grants out of records and partial downloads',async()=>{
  const execute=promisify(execFile),root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-files-'));
  const sid=randomUUID(),inputId=randomUUID(),checkpointId=randomUUID();
  const inputs=new Map(),checkpoints=new Map();
  let uploaded,posts=0,puts=0,drop=true,partial=true,origin;
  const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({data}));};
  const error=(res,status,code)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{code,message:code,retryable:false}}));};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,origin),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]==='storage'){
      assert.equal(url.searchParams.get('signature'),'temporary-secret');
      assert.equal(req.headers.authorization,undefined);
      if(req.method==='PUT'){
        puts++;let bytes=[];for await(const chunk of req)bytes.push(chunk);uploaded=Buffer.concat(bytes);res.end();return;
      }
      res.end(partial ? uploaded.subarray(0,2) : uploaded);return;
    }
    if(req.url==='/api/v1/me')return reply(res,200,{actor:{user_id:req.headers.authorization==='Bearer arx_other_file_key'?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},billing:{account_type:'user',account_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
    let body;
    if(req.method==='POST'){posts++;let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text);}
    if(parts[5]==='uploads')return reply(res,200,{input_id:body.input_id,upload_url:origin+'/storage/input?signature=temporary-secret',upload_method:'PUT',upload_headers:{},expires_at:'future'});
    if(parts[5]==='inputs'){
      if(req.method==='POST'){
        if(body.source.kind==='upload')assert.equal(uploaded.toString(),'local input');
        const input={input_id:body.input_id,session_id:sid,path:body.path,state:'ready',size_bytes:uploaded.length,error:null};
        inputs.set(body.input_id,input);
        if(drop){drop=false;req.socket.destroy();return;}
        return reply(res,202,input);
      }
      return inputs.has(parts[6])?reply(res,200,inputs.get(parts[6])):error(res,404,'not_found');
    }
    if(parts[5]==='checkpoints'){
      if(req.method==='POST'){
        // Copy bytes into an independent checkpoint version at the transfer boundary.
        checkpoints.set(body.checkpoint_id,{bytes:Buffer.from(uploaded),state:'synced'});
      }
      const id=req.method==='POST'?body.checkpoint_id:parts[6],cp=checkpoints.get(id);
      if(!cp)return error(res,404,'not_found');
      return reply(res,req.method==='POST'?202:200,{checkpoint_id:id,session_id:sid,state:cp.state,file_count:1,size_bytes:cp.bytes.length,error:null});
    }
    if(parts[5]==='files' && !parts[6]){
      const pinned = !url.searchParams.get('cursor') || url.searchParams.get('checkpoint')===checkpointId;
      return reply(res,200,{checkpoint:pinned?checkpointId:randomUUID(),entries:[{path:pinned?'/workspace/stable.txt':'/workspace/newer.txt',kind:'file',size_bytes:1}],next_cursor:url.searchParams.get('cursor')?null:'1'});
    }
    if(parts[5]==='files' && parts[6]==='presign')return reply(res,200,{path:body.path,checkpoint:body.checkpoint,download_url:origin+'/storage/output?signature=temporary-secret',expires_at:'future',size_bytes:uploaded.length});
    return error(res,404,'not_found');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  const script=new URL('../bin/ariax.js',import.meta.url).pathname;
  async function cli(args,expected=0,key='arx_local_file_key'){
    let result;
    try{result={code:0,...await execute(process.execPath,[script,'--json','--root-dir',root,'--base-url',origin,...args],{env:{...process.env,ARIAX_API_KEY:key,NO_UPDATE_NOTIFIER:'1'},timeout:10000})};}
    catch(error){result=error;}
    assert.equal(result.code,expected,result.stdout+'\n'+result.stderr);
    return result;
  }
  try{
    const local=path.join(root,'arbitrary.yaml');await fs.writeFile(local,'local input');
    const add=['forge','inputs','add',sid,'--file',local,'--path','targets/input.yaml','--input-id',inputId];
    await cli(add,9);
    const before=posts;
    await cli(add);
    assert.equal(posts,before);assert.equal(puts,1);assert.equal(inputs.size,1);
    await cli(add,1,'arx_other_file_key');assert.equal(posts,before);
    await cli(['forge','inputs','add',sid,'--file',local,'--path','../escape'],1);
    const urlId=randomUUID();
    await cli(['forge','inputs','add',sid,'--url','https://example.org/input?signature=external-secret','--path','remote.txt','--input-id',urlId]);
    await cli(['forge','sync',sid,'--checkpoint-id',checkpointId,'--wait','--timeout','1']);
    assert.equal(checkpoints.size,1);
    const syncPosts=posts;
    await cli(['forge','sync',sid,'--checkpoint-id',checkpointId]);assert.equal(posts,syncPosts);
    const listing=JSON.parse((await cli(['forge','files',sid])).stdout).data;
    assert.equal(listing.checkpoint,checkpointId);
    assert.ok(listing.entries.every(e=>e.path==='/workspace/stable.txt'));
    const dest=path.join(root,'result.txt');
    const download=['forge','download',sid,'/workspace/result.txt','--dest',dest,'--checkpoint',checkpointId];
    await cli(download,10);
    await assert.rejects(fs.stat(dest),{code:'ENOENT'});
    assert.equal((await fs.readdir(root)).some(name=>name.includes('.part-')),false);
    partial=false;await cli(download);assert.equal(await fs.readFile(dest,'utf8'),'local input');
    for(const file of await fs.readdir(path.join(root,'.ariax/forge'))){
      const text=await fs.readFile(path.join(root,'.ariax/forge',file),'utf8');
      assert.doesNotMatch(text,/temporary-secret|external-secret|upload_url|download_url/);
    }
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
