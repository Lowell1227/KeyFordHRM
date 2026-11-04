import { repairMultipartFilename } from './upload-file.interceptor';

describe('repairMultipartFilename', () => {
  it('repairs UTF-8 Chinese names misdecoded as latin1', () => {
    // “附件11月销售数据明细表.xlsx” 经 latin1 误解码后的形态
    const garbled = Buffer.from('附件11月销售数据明细表.xlsx', 'utf8').toString('latin1');
    expect(garbled).not.toBe('附件11月销售数据明细表.xlsx');
    expect(repairMultipartFilename(garbled)).toBe('附件11月销售数据明细表.xlsx');
  });

  it('repairs mixed Chinese-ASCII names from real browsers', () => {
    const garbled = Buffer.from('11月销售数据明细表（最终版）.xlsx', 'utf8').toString('latin1');
    expect(repairMultipartFilename(garbled)).toBe('11月销售数据明细表（最终版）.xlsx');
  });

  it('keeps pure ASCII names untouched', () => {
    expect(repairMultipartFilename('report.xlsx')).toBe('report.xlsx');
    expect(repairMultipartFilename('Q3-Report (final).PDF')).toBe('Q3-Report (final).PDF');
  });

  it('keeps already-valid UTF-8 names untouched', () => {
    expect(repairMultipartFilename('附件11月销售数据明细表.xlsx')).toBe('附件11月销售数据明细表.xlsx');
    expect(repairMultipartFilename('测评表（最终版）.docx')).toBe('测评表（最终版）.docx');
  });

  it('keeps names that are genuine latin1 text rather than misdecoded UTF-8', () => {
    // “Größe” 是真实 latin1 内容，重解码为 UTF-8 会产生替换符，必须原样保留
    expect(repairMultipartFilename('Größe.txt')).toBe('Größe.txt');
  });

  it('handles empty names', () => {
    expect(repairMultipartFilename('')).toBe('');
  });
});
