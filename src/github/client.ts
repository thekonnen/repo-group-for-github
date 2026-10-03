import { browser } from 'wxt/browser';
import type { ErrorInfo, Request, Response } from './messages';

export class CallError extends Error {
  constructor(public info: ErrorInfo) {
    super(info.message);
  }
}

export type Call = <T = unknown>(req: Request) => Promise<T>;

/** Typed messages to the background worker, which owns the token and every API call. */
export const call: Call = async <T,>(req: Request): Promise<T> => {
  const res = (await browser.runtime.sendMessage(req)) as Response<T> | undefined;
  if (!res) throw new CallError({ kind: 'other', message: 'The extension background did not answer. Reload the page.' });
  if (!res.ok) throw new CallError(res.error);
  return res.data;
};
