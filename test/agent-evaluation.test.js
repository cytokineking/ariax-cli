import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { recordEvaluation } from '../scripts/record-agent-evaluation.js';
it('separates accepted configuration from refusal and rejects changed exact constraints', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ariax-agent-evidence-'));
  try {
    const put=(name,value)=>{fs.writeFileSync(path.join(dir,name),JSON.stringify(value));return path.join(dir,name);};
    const definition=put('case.json',{schema_version:1,id:'exact',expected_completion:'completed',checks:[{pointer:'/hotspots',op:'equals',value:'A88'}]});
    put('build.json',{data:{version:'0.1.0',channel:'github',source_revision:'a'.repeat(40),source_dirty:false}});
    put('job.json',{hotspots:'A88'});
    put('validation.json',{data:{normalized_job_spec:{hotspots:'A88'},job_spec_hash:'b'.repeat(64)}});
    const evidence={schema_version:1,agent:{name:'test-agent',model:'fixture'},completion:'refused',commands:[],artifacts:{cli_build:'build.json',config:'job.json',validation:'validation.json'}};
    const file=put('evidence.json',evidence);
    const refused=recordEvaluation(definition,file);
    assert.equal(refused.validation_status,'accepted');assert.equal(refused.completion,'refused');assert.equal(refused.fidelity_passed,false);
    put('evidence.json',{...evidence,completion:'completed'});
    assert.equal(recordEvaluation(definition,file).fidelity_passed,true);
    put('job.json',{hotspots:'A84-91'});
    const broadened=recordEvaluation(definition,file);
    assert.equal(broadened.fidelity_passed,false);
    assert.notEqual(broadened.artifacts.config.sha256,refused.artifacts.config.sha256);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
