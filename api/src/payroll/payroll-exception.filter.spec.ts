import { BadRequestException, Logger } from '@nestjs/common';
import { PayrollExceptionFilter } from './payroll-exception.filter';

describe('private payroll errors', () => {
  afterEach(() => jest.restoreAllMocks());
  function response() {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;
    return { res, host };
  }
  it('never returns or logs private database payloads', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { res, host } = response();
    new PayrollExceptionFilter().catch(new Error('private-fixture-amount-and-query'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-fixture');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-fixture');
  });
  it.each(['P2002', 'P2034'])('turns concurrency %s into a private conflict', code => {
    const { res, host } = response();
    new PayrollExceptionFilter().catch({ code, message: 'private-fixture-query' }, host);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-fixture');
  });
  it('preserves deliberate business validation', () => {
    const { res, host } = response();
    new PayrollExceptionFilter().catch(new BadRequestException('请填写确认依据'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('请填写确认依据');
  });
});
