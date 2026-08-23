import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fss from 'fs';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = fss.existsSync(envPath) ? dotenv.parse(fss.readFileSync(envPath)) : {};
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'test_b2_compat';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.DISABLE_CRON = 'true';
process.env.DATABASE_URL = envConfig.DATABASE_URL || 'postgresql://mock:mock@localhost:5432/mock';

import { handleUploadError } from '../src/middleware/upload';

function mr(): any {
  const r: any = {statusCode:200,jsonBody:null};
  r.status = (n: number) => { r.statusCode=n; return r; };
  r.json = (b: any) => { r.jsonBody=b; return r; };
  return r;
}

describe('UPLOAD B2 COMPAT (1.0.5)', {concurrency:1}, () => {
  it('null err retorna false', () => { assert.equal(handleUploadError(null, mr()), false); });
  it('NotImplemented->503', () => {
    const e: any=new Error('x'); e.name='NotImplemented'; e.code='NotImplemented';
    const r=mr(); handleUploadError(e,r,'c1');
    assert.equal(r.statusCode,503); assert.ok(r.jsonBody.supportCode);
  });
  it('InvalidArgument->503', () => {
    const e: any=new Error('x'); e.name='InvalidArgument';
    const r=mr(); handleUploadError(e,r,'c2'); assert.equal(r.statusCode,503);
  });
  it('BadDigest->503', () => {
    const e: any=new Error('x'); e.name='BadDigest';
    const r=mr(); handleUploadError(e,r,'c3'); assert.equal(r.statusCode,503);
  });
  it('ChecksumMismatch->503', () => {
    const e: any=new Error('x'); e.name='ChecksumMismatch';
    const r=mr(); handleUploadError(e,r,'c4'); assert.equal(r.statusCode,503);
  });
  it('XAmzContentSHA256Mismatch->503', () => {
    const e: any=new Error('x'); e.name='XAmzContentSHA256Mismatch';
    const r=mr(); handleUploadError(e,r,'c5'); assert.equal(r.statusCode,503);
  });
  it('InvalidAccessKeyId->503 sem dados', () => {
    const e: any=new Error('x'); e.name='InvalidAccessKeyId';
    const r=mr(); handleUploadError(e,r,'c6');
    assert.equal(r.statusCode,503);
    assert.ok(!JSON.stringify(r.jsonBody).includes('Access'));
  });
  it('ECONNREFUSED->503', () => {
    const e: any=new Error('x'); e.code='ECONNREFUSED';
    const r=mr(); handleUploadError(e,r,'c7'); assert.equal(r.statusCode,503);
  });
  it('LIMIT_FILE_SIZE->400', () => {
    const {MulterError}=require('multer');
    const e=new MulterError('LIMIT_FILE_SIZE');
    const r=mr(); handleUploadError(e,r);
    assert.equal(r.statusCode,400); assert.ok(r.jsonBody.error.includes('15MB'));
  });
  it('MIME invalido->400', () => {
    const e=new Error('Tipo de arquivo nao permitido. Apenas imagens e PDF.');
    const r=mr(); handleUploadError(e,r); assert.equal(r.statusCode,400);
  });
  it('Stack trace nao vaza', () => {
    const e: any=new Error('err'); e.name='NetworkingError'; e.stack='Error at upload.ts:50';
    const r=mr(); handleUploadError(e,r,'c10');
    assert.ok(!JSON.stringify(r.jsonBody).includes('upload.ts'));
  });
  it('Chave secreta sanitizada', () => {
    const e: any=new Error('keyId=MINHA_CHAVE_SECRETA falhou'); e.name='NetworkingError';
    const r=mr(); handleUploadError(e,r,'c11');
    assert.ok(!JSON.stringify(r.jsonBody).includes('MINHA_CHAVE_SECRETA'));
  });
  it('supportCode propagado', () => {
    const e: any=new Error('x'); e.code='ETIMEDOUT';
    const r=mr(); handleUploadError(e,r,'mycorr');
    assert.equal(r.jsonBody.supportCode,'mycorr');
  });
});