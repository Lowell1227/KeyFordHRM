import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertContractPreview, createContractFixture, removeContractFixture, previewOrigin } from './contract-management-fixture';

const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
const cryptoOffice = requireApi('officecrypto-tool');
const ExcelJS = requireApi('exceljs');
const accountPassword = 'fictional-account';
const filePassword = 'fictional-file-2026';

test('identity export verifies actor password, encrypts the real download and clears credentials', async ({ page }, info) => {
  assertContractPreview(info);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  const fixture = createContractFixture();
  try {
    execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client'), bcrypt=require('bcrypt'),crypto=require('crypto'); const p=new PrismaClient();
      (async()=>{
        await p.user.update({where:{id:${JSON.stringify(fixture.operator.id)}},data:{passwordHash:await bcrypt.hash(${JSON.stringify(accountPassword)},4),mustChangePassword:false}});
        const key=crypto.createHash('sha256').update('employee-archive:'+(process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY??process.env.JWT_SECRET)).digest();
        const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update('000000200001010000'),c.final()]);
        const data={idNumberEncrypted:Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),body]),idNumberFingerprint:'fictional-fingerprint'};
        await p.employeeProfile.upsert({where:{userId:${JSON.stringify(fixture.employee.id)}},create:{userId:${JSON.stringify(fixture.employee.id)},...data},update:data});
      })().catch(()=>process.exitCode=1).finally(()=>p.$disconnect());` });
    await page.addInitScript(token => localStorage.setItem('token', token), fixture.token);
    await page.goto(previewOrigin + '/users');
    await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(fixture.employee.employeeNo);
    const queried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users' && new URL(r.url()).searchParams.get('keyword') === fixture.employee.employeeNo);
    await page.getByRole('button', { name: '查询', exact: true }).click(); await queried;
    await page.getByRole('button', { name: '导出花名册', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
    await expect(dialog.getByText('预计导出 1 条记录', { exact: true })).toBeVisible();
    const identity = dialog.getByRole('checkbox', { name: '身份证号', exact: true });
    await expect(identity).not.toBeChecked();
    await dialog.getByRole('button', { name: '清空', exact: true }).click();
    await dialog.getByText('姓名', { exact: true }).click();
    await dialog.getByText('身份证号', { exact: true }).click();
    const account = dialog.getByLabel('当前账号密码', { exact: true });
    const file = dialog.getByLabel('Excel打开密码', { exact: true });
    const confirm = dialog.getByLabel('再次输入打开密码', { exact: true });
    const submit = dialog.getByRole('button', { name: '导出 Excel', exact: true });
    await account.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sensitive-export-dialog.png'), fullPage: true, animations: 'disabled' });
    await submit.click(); await expect(dialog.getByText('请输入当前账号密码', { exact: true })).toBeVisible();
    await account.fill('wrong'); await file.fill(filePassword); await confirm.fill(filePassword);
    const denied = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users/export-sensitive');
    await submit.click(); expect((await denied).status()).toBe(403);
    await expect(dialog.getByText('账号密码不正确', { exact: true })).toBeVisible();
    await expect(account).toHaveValue(''); await expect(file).toHaveValue('');
    expect(await page.evaluate(() => Boolean(localStorage.getItem('token')))).toBe(true);
    await account.fill(accountPassword); await file.fill(filePassword); await confirm.fill(filePassword);
    const downloaded = page.waitForEvent('download');
    const sent = page.waitForRequest(r => new URL(r.url()).pathname === '/api/v1/users/export-sensitive');
    await submit.click(); const request = await sent;
    expect(request.method()).toBe('POST'); expect(new URL(request.url()).search).toBe('');
    expect(request.postDataJSON()).toMatchObject({ columns: 'name,idNumber', accountPassword, filePassword });
    const download = await downloaded;
    const stream = await download.createReadStream(); const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const encrypted = Buffer.concat(chunks);
    expect(cryptoOffice.isEncrypted(encrypted)).toBe(true);
    await expect(cryptoOffice.decrypt(encrypted, { password: 'wrong' })).rejects.toThrow();
    const restored = await cryptoOffice.decrypt(encrypted, { password: filePassword });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(restored);
    expect(book.getWorksheet('花名册').getRow(2).values.slice(1)).toEqual(['姓名', '身份证号']);
    expect(book.getWorksheet('花名册').getCell('B3').value).toBe('000000200001010000');
    const filePath = info.outputPath('fictional-encrypted-roster.xlsx'); await download.saveAs(filePath);
    // A different language/library independently verifies the Office encryption.
    const python = 'C:/Users/lwei/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
    execFileSync(python, ['-c', "import sys,io,msoffcrypto; f=msoffcrypto.OfficeFile(open(sys.argv[1],'rb')); assert f.is_encrypted(); f.load_key(password=sys.argv[2],verify_password=True); out=io.BytesIO(); f.decrypt(out,verify_integrity=True); assert out.getvalue()[:2]==b'PK'; print('verified')", filePath, filePassword], { stdio: 'pipe' });
    await page.getByRole('button', { name: '导出花名册', exact: true }).click();
    await expect(account).toHaveValue(''); await expect(file).toHaveValue(''); await expect(confirm).toHaveValue('');
    await account.fill(accountPassword); await dialog.getByText('身份证号', { exact: true }).click();
    await expect(account).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(accountPassword);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const cancel = dialog.getByRole('button', { name: '取消', exact: true }); await expect(cancel).toBeVisible(); await cancel.click();
    expect(pageErrors).toEqual([]);
  } finally { await page.close(); removeContractFixture(fixture); }
});
