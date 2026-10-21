/** Lost import replies must recover by ID; downloads must publish complete bytes only. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,generateKeyPairSync,sign,verify} from 'node:crypto';
import {tunnelEnvironment} from './helpers/forge-http.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

it('recovers file IDs across lost replies and keeps grants out of records and partial downloads',async()=>{
  const execute=promisify(execFile),root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-files-'));
  const sid=randomUUID(),pid=randomUUID(),inputId=randomUUID(),checkpointId=randomUUID();
  const unusualPath='/workspace/result ?+#&%ü.cif';
  const inputs=new Map(),checkpoints=new Map();
  let uploaded,posts=0,puts=0,drop=true,partial=true,origin,sessionState='available';
  const signing=generateKeyPairSync('rsa',{modulusLength:2048});
  const issued=new Set();
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  function token(){
    const now=Math.floor(Date.now()/1000),head=encode({alg:'RS256',typ:'ariax-forge-access+jwt',kid:'files-fixture'});
    const body=encode({iss:'https://files-fixture.test',aud:'forge:'+sid,session_id:sid,project_id:pid,
      actor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',api_key_id:null,scopes:['forge:read','forge:write'],iat:now,nbf:now,exp:now+300});
    const input=head+'.'+body,value=input+'.'+sign('RSA-SHA256',Buffer.from(input),signing.privateKey).toString('base64url');issued.add(value);return value;
  }
  const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({data}));};
  const error=(res,status,code)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{code,message:code,retryable:false}}));};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,origin);
    const direct=/^\/__direct\/([0-9a-f-]{36})(\/v1\/.*)$/.exec(url.pathname);
    if(direct){
      const bearer=(req.headers.authorization||'').replace(/^Bearer /,''),parts=bearer.split('.');
      if(direct[1]!==sid||!issued.has(bearer)||parts.length!==3||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),signing.publicKey,Buffer.from(parts[2],'base64url')))
        return error(res,401,'unauthorized');
      url.pathname='/api/v1/forge/sessions/'+sid+(direct[2]==='/v1/session'?'':direct[2].slice(3));
    }
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts[5]==='connect')return reply(res,200,{session_id:sid,project_id:pid,endpoint:'https://'+sid.replaceAll('-','')+'.forge.test',access_token:token(),expires_at:new Date(Date.now()+300000).toISOString(),api_version:1});
    if(parts[0]==='storage'){
      assert.equal(url.searchParams.get('signature'),'temporary-secret');
      assert.equal(req.headers.authorization,undefined);
      if(req.method==='PUT'){
        puts++;let bytes=[];for await(const chunk of req)bytes.push(chunk);uploaded=Buffer.concat(bytes);res.end();return;
      }
      res.end(partial ? uploaded.subarray(0,2) : uploaded);return;
    }
    if(req.url==='/api/v1/me')return reply(res,200,{actor:{user_id:req.headers.authorization==='Bearer arx_other_file_key'?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},billing:{account_type:'user',account_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
    if(parts.length===5 && parts[3]==='sessions')return reply(res,200,{session_id:sid,project_id:pid,state:sessionState});
    let body;
    if(req.method==='POST'){posts++;let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text||'{}');}
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
        checkpoints.set(body.checkpoint_id,{bytes:Buffer.from(uploaded),state:'synced',completed_at:new Date().toISOString(),
          paths:new Set(['/workspace/result.txt',unusualPath])});
      }
      const id=req.method==='POST'?body.checkpoint_id:parts[6],cp=checkpoints.get(id);
      if(!cp)return error(res,404,'not_found');
      return reply(res,req.method==='POST'?202:200,{checkpoint_id:id,session_id:sid,state:cp.state,completed_at:cp.completed_at,file_count:cp.paths.size,size_bytes:cp.bytes.length,error:null});
    }
    if(parts[5]==='files' && !parts[6]){
      const pinned = !url.searchParams.get('cursor') || url.searchParams.get('checkpoint')===checkpointId;
      return reply(res,200,{checkpoint:pinned?checkpointId:randomUUID(),entries:[{path:pinned?'/workspace/stable.txt':'/workspace/newer.txt',kind:'file',size_bytes:1}],next_cursor:url.searchParams.get('cursor')?null:'1'});
    }
    if(parts[5]==='files' && parts[6]==='presign'){
      const chosen=body.checkpoint || checkpointId,cp=checkpoints.get(chosen);
      if(!cp)return error(res,409,'checkpoint_required');
      if(cp.state!=='synced')return error(res,409,'checkpoint_unready');
      if(!cp.paths.has(body.path))return error(res,404,'not_found');
      return reply(res,200,{path:body.path,checkpoint:chosen,download_url:origin+'/storage/output?signature=temporary-secret',expires_at:'future',size_bytes:cp.bytes.length});
    }
    return error(res,404,'not_found');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  const privateClient=await tunnelEnvironment(root,origin,process.env);
  const script=new URL('../bin/ariax.js',import.meta.url).pathname;
  async function cli(args,expected=0,key='arx_local_file_key',human=false){
    let result;
    try{result={code:0,...await execute(process.execPath,[script,human?'--no-json':'--json','--root-dir',root,'--base-url',origin,...args],{env:{...privateClient.env,ARIAX_API_KEY:key,NO_UPDATE_NOTIFIER:'1'},timeout:60000})};}
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
    const unsaved=await cli(['forge','link',sid,unusualPath],7);
    assert.match(JSON.parse(unsaved.stdout).error.action,new RegExp(`sync ${sid} --wait`));
    await cli(['forge','sync',sid,'--checkpoint-id',checkpointId,'--wait','--timeout','30']);
    assert.equal(checkpoints.size,1);sessionState='closed';
    const syncPosts=posts;
    await cli(['forge','sync',sid,'--checkpoint-id',checkpointId]);assert.equal(posts,syncPosts);
    const listing=JSON.parse((await cli(['forge','files',sid])).stdout).data;
    assert.equal(listing.checkpoint,checkpointId);
    assert.ok(listing.entries.every(e=>e.path==='/workspace/stable.txt'));
    const linked=JSON.parse((await cli(['forge','link',sid,unusualPath])).stdout).data;
    const url=new URL(linked.url);
    assert.equal(url.origin,origin);
    assert.equal(url.pathname,`/projects/forge/${pid}`);
    assert.equal(url.searchParams.get('session'),sid);
    assert.equal(url.searchParams.get('checkpoint'),checkpointId);
    assert.equal(url.searchParams.get('path'),unusualPath);
    assert.equal(linked.completed_at,checkpoints.get(checkpointId).completed_at);
    assert.equal(linked.size_bytes,uploaded.length);
    assert.doesNotMatch(JSON.stringify(linked),/temporary-secret|download_url/);
    const humanLink=await cli(['forge','link',sid,unusualPath,'--checkpoint',checkpointId],0,'arx_local_file_key',true);
    assert.match(humanLink.stdout,/url: http:/);
    await cli(['forge','link',sid,'/workspace/missing.cif'],4);
    await cli(['forge','link',sid,'/workspace/../outside'],1);
    checkpoints.get(checkpointId).state='syncing';
    await cli(['forge','link',sid,unusualPath,'--checkpoint',checkpointId],7);
    checkpoints.get(checkpointId).state='synced';
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
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});await fs.rm(privateClient.directory,{recursive:true,force:true});}
});
