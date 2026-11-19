import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertContractPreview, createContractFixture, removeContractFixture, previewOrigin } from './contract-management-fixture';

const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
const office = requireApi('officecrypto-tool'), ExcelJS = requireApi('exceljs');
const accountPassword = '135790', filePassword = '4567';
const bankAccount = '0000000000000000001', identity = '000000200001010000';

test('favicon is a real ICO resource', async ({ request }) => {
  const response = await request.get(previewOrigin + '/favicon.ico');
  expect(response.status()).toBe(200);
  expect([...Buffer.from(await response.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
});

for (const includeIdentity of [false, true]) {
  test(`bank account encrypted download${includeIdentity ? ' with identity' : ' alone'}`, async ({ page }, info) => {
    assertContractPreview(info);
    const fixture = createContractFixture();
    try {
      execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', input: `
        require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const {PrismaClient}=require('@prisma/client'),bcrypt=require('bcrypt'),crypto=require('crypto');const p=new PrismaClient();
        (async()=>{const key=crypto.createHash('sha256').update('employee-archive:'+(process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY??process.env.JWT_SECRET)).digest();
          const encrypt=text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),body]);};
          await p.user.update({where:{id:${JSON.stringify(fixture.operator.id)}},data:{passwordHash:await bcrypt.hash(${JSON.stringify(accountPassword)},4),mustChangePassword:false}});
          const data={bankAccountEncrypted:encrypt(${JSON.stringify(bankAccount)}),idNumberEncrypted:${includeIdentity ? `encrypt(${JSON.stringify(identity)})` : 'Buffer.from([0])'}};
          await p.employeeProfile.upsert({where:{userId:${JSON.stringify(fixture.employee.id)}},create:{userId:${JSON.stringify(fixture.employee.id)},...data},update:data});
        })().finally(()=>p.$disconnect()).catch(()=>process.exitCode=1);` });
      await page.addInitScript(token => localStorage.setItem('token', token), fixture.token);
      await page.goto(previewOrigin + '/users');
      await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(fixture.employee.employeeNo);
      const queried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/users' && new URL(r.url()).searchParams.get('keyword') === fixture.employee.employeeNo);
      await page.getByRole('button', { name: '查询', exact: true }).click(); await queried;
      await page.getByRole('button', { name: '导出花名册', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
      await expect(dialog.getByText('选择字段（9）', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('checkbox', { name: '合同类型', exact: true })).not.toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: '银行卡号', exact: true })).not.toBeChecked();
      await dialog.getByRole('button', { name: '清空', exact: true }).click();
      await dialog.getByText('姓名', { exact: true }).click();
      await dialog.getByText('银行卡号', { exact: true }).click();
      if (includeIdentity) await dialog.getByText('身份证号', { exact: true }).click();
      await expect(dialog.getByRole('heading', { name: '安全验证', exact: true })).toBeVisible();
      await expect(dialog.getByText(includeIdentity ? '含身份证号、银行卡号' : '含银行卡号', { exact: true })).toBeVisible();
      const account = dialog.getByLabel('当前账号密码', { exact: true });
      const file = dialog.getByLabel('Excel打开密码', { exact: true });
      const confirm = dialog.getByLabel('再次输入打开密码', { exact: true });
      const submit = dialog.getByRole('button', { name: '导出 Excel', exact: true });
      await submit.click(); await expect(dialog.getByText('请输入当前账号密码', { exact: true })).toBeVisible();
      await account.fill(accountPassword); await file.fill(filePassword); await confirm.fill(filePassword);
      const downloaded = page.waitForEvent('download'); await submit.click();
      const stream = await (await downloaded).createReadStream(), chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const encrypted = Buffer.concat(chunks);
      expect(office.isEncrypted(encrypted)).toBe(true);
      await expect(office.decrypt(encrypted, { password: 'wrong' })).rejects.toThrow();
      const book = new ExcelJS.Workbook(); await book.xlsx.load(await office.decrypt(encrypted, { password: filePassword }));
      const sheet = book.getWorksheet('花名册');
      expect(sheet.getRow(2).values.slice(1)).toEqual(includeIdentity ? ['姓名', '身份证号', '银行卡号'] : ['姓名', '银行卡号']);
      expect(sheet.getCell(includeIdentity ? 'C3' : 'B3').value).toBe(bankAccount);
      if (includeIdentity) expect(sheet.getCell('B3').value).toBe(identity);
      const headers = { authorization: 'Bearer ' + fixture.token };
      const columns = includeIdentity ? 'idNumber,bankAccount' : 'bankAccount';
      expect((await page.request.get(previewOrigin + '/api/v1/users/export', { headers, params: { columns } })).status()).toBe(400);
      expect((await page.request.post(previewOrigin + '/api/v1/users/export-sensitive', { headers, data: { columns, accountPassword: 'wrong', filePassword } })).status()).toBe(403);
      await page.getByRole('button', { name: '导出花名册', exact: true }).click();
      await expect(account).toHaveValue(''); await expect(file).toHaveValue(''); await expect(confirm).toHaveValue('');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally { await page.close(); removeContractFixture(fixture); }
  });
}
