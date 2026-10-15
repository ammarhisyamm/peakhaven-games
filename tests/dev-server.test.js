import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

test('Preview survives malformed URLs, unreadable files and an interrupted API body',async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=fileURLToPath(new URL('../arcade/',import.meta.url)),name=`__audit_${process.pid}.txt`,path=root+'build/'+name;
 await mkdir(root+'build',{recursive:true});await writeFile(path,'private fixture');await chmod(path,0);
 const server=spawn(process.execPath,['dev-server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)}});let error='';server.stderr.on('data',d=>error+=d);
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(Error(error)));});
  const base=`http://localhost:${port}`;
  assert.equal((await fetch(base+'/%E0%A4%A')).status,400);
  if(process.getuid?.()!==0)assert.equal((await fetch(base+'/'+name)).status,404);
  const {connect}=await import('node:net');const socket=connect(port,'localhost');await once(socket,'connect');socket.write('POST /api/join HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');socket.destroy();
  const healthy=await fetch(base+'/api/config');assert.equal(healthy.status,200);assert.equal((await healthy.json()).accounts,true);assert.equal(server.exitCode,null);assert.equal(error,'');
 }finally{server.kill();await chmod(path,0o600);await rm(path,{force:true});}
});
