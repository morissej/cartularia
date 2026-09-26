import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectTrustedUpload } from '../scripts/lib/private-upload-command.mjs';
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fixture = name => readFile(new URL(`./fixtures/passive-documents/${name}.docx`, import.meta.url));
const inspect = async (bytes, fileName='report.docx', declaredMimeType=mime, overrides={}) => {
 const folder=await mkdtemp(join(tmpdir(),'cartularia-passive-document-'));
 const path=join(folder,fileName);
 try { await writeFile(path,bytes); return await inspectTrustedUpload({path,fileName,declaredMimeType,expectedDigest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),expectedSize:bytes.length,...overrides}); }
 finally { await rm(folder,{recursive:true,force:true}); }
};
test('Jam 18 : un Word structuré et un Markdown UTF-8 restent des originaux privés sans copie publique', async()=>{
 for(const args of [[await fixture('valid')], [Buffer.from('# Rapport\n\nÉtat décrit, sans certification.'),'report.md','text/markdown']]){
  const result=await inspect(...args);
  assert.equal(result.accepted,true);assert.equal(result.kind,'document');assert.equal(result.publicationEligible,false);assert.equal(result.derivative,null);assert.equal(result.derivativeStatus,'private_only');assert.equal(result.malwareScanStatus,'not_available_private_only');
 }
});
for(const [name,code] of [['macro','active_document_content'],['external','active_document_content'],['traversal','invalid_docx'],['expansion','invalid_docx']]) test(`Word refuse ${name}`,async()=>assert.rejects(inspect(await fixture(name)),{code}));
test('Word refuse un ZIP tronqué et un contenu comprimé altéré',async()=>{
 const bytes=await fixture('valid');
 await assert.rejects(inspect(bytes.subarray(0,bytes.length-8)),{code:'invalid_docx'});
 const changed=Buffer.from(bytes);changed[60]^=255;
 await assert.rejects(inspect(changed),{code:'invalid_docx'});
});
test('Markdown refuse données binaires, encodage invalide et contenu actif',async()=>{
 for(const [bytes,code] of [[Buffer.from([0,1,2]),'invalid_document_text'],[Buffer.from([0xff,0xfe]),'invalid_document_text'],[Buffer.from('<script>alert(1)</script>'),'active_document_content']]) await assert.rejects(inspect(bytes,'report.md','text/markdown'),{code});
});
test('Word conserve les contrôles de MIME, taille et empreinte',async()=>{
 const bytes=await fixture('valid');
 await assert.rejects(inspect(bytes,'report.docx','text/plain'),{code:'mime_mismatch'});
 await assert.rejects(inspect(bytes,'report.docx',mime,{expectedSize:bytes.length+1}),{code:'size_mismatch'});
 await assert.rejects(inspect(bytes,'report.docx',mime,{expectedDigest:'sha256:'+'0'.repeat(64)}),{code:'digest_mismatch'});
});
