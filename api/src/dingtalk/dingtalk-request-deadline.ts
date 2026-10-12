export class DingtalkDeadlineError extends Error {
  constructor() {
    super('DingTalk request timed out');
  }
}

// One budget covers token retrieval, the request and its body, including stalled transports.
export async function withDingtalkDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer!: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DingtalkDeadlineError();
      controller.abort(error);
      reject(error);
    }, 10_000);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
