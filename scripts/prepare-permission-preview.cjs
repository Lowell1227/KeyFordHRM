'use strict';
const { execFileSync } = require('node:child_process');
const demo = process.argv.includes('--demo');
const code = `const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
  require('./test/permissions/permission-fixture.cjs').createFixture(db,${demo})
    .then(f=>process.stdout.write(JSON.stringify(f))).finally(()=>db.$disconnect())
    .catch(e=>{process.stderr.write(JSON.stringify({name:e.name,code:e.code}));process.exitCode=1});`;
try {
  process.stdout.write(execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
  }));
} catch { throw Error('Guarded fictional permission fixture could not be prepared'); }
