import { ValidationPipe } from '@nestjs/common';
import { SelfEvalSummaryDto } from './submit-self-eval.dto';
import { ManagerEvalSummaryDto } from './save-manager-evaluation-draft.dto';

describe('legacy task attachments through HTTP transformation', () => {
  it.each([SelfEvalSummaryDto, ManagerEvalSummaryDto])('retains JSON object fields for %s', async (metatype) => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } });
    const attachment = { name: 'evidence.txt', url: '/storage/download?key=uploads%2Fevidence.txt', size: 4 };
    const dto = await pipe.transform({ attachments: [attachment] }, { type: 'body', metatype });
    expect(JSON.parse(JSON.stringify(dto)).attachments).toEqual([attachment]);
  });
});
