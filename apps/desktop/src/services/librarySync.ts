import type { LibraryMeta } from "../core/types";
import { errorCode, isOk, type AccountClient } from "./accountClient";
import { librarySyncApply, librarySyncMarkAllDirty, librarySyncMarkClean, librarySyncPending } from "./localFiles";

const BATCH = 500;
/** Pages of the pull; a library this large is unusual, but the loop stays bounded. */
const MAX_PAGES = 50;

export class AccountUnauthorized extends Error {
  constructor() {
    super("unauthorized");
  }
}

export type SyncResult = {
  /** Server cursor after the pull (store it for the next sync). */
  cursor: number;
  /** Rows sent and accepted by the server. */
  pushed: number;
  /** Rows from the account that changed this computer's library. */
  applied: number;
  /** Novel ids removed from the library on another computer (and applied here). */
  removed: string[];
};

type PushBody = { accepted: { key: string; changedAt: number }[]; rejected: string[]; cursor: number };
type PullBody = { entries: (LibraryMeta & { seq: number })[]; cursor: number; more: boolean };

function check(result: { status: number; body: unknown }) {
  if (result.status === 401) throw new AccountUnauthorized();
  if (!isOk(result)) throw new Error(errorCode(result));
}

/**
 * One sync round: push the local changes (newest change per book wins on the server), then
 * pull what changed since `cursor` and apply it (the newest wins here too). `joinAccount`
 * (right after signing in) marks the whole local library for upload first, so the books on
 * this computer join the account.
 */
export async function syncLibrary(client: AccountClient, cursor: number, options: { joinAccount?: boolean } = {}): Promise<SyncResult> {
  if (options.joinAccount) await librarySyncMarkAllDirty();
  let pushed = 0;
  const pending = await librarySyncPending();
  for (let start = 0; start < pending.length; start += BATCH) {
    const batch = pending.slice(start, start + BATCH);
    const result = await client.api<PushBody>("POST", "/v1/me/library/changes", { changes: batch });
    check(result);
    await librarySyncMarkClean(result.body.accepted);
    pushed += result.body.accepted.length;
  }
  let applied = 0;
  const removed: string[] = [];
  let since = cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.api<PullBody>("GET", `/v1/me/library?since=${since}`);
    check(result);
    const { entries, cursor: next, more } = result.body;
    if (entries.length) {
      const changed = new Set(await librarySyncApply(entries.map(({ seq: _seq, ...row }) => row)));
      applied += changed.size;
      for (const entry of entries) {
        if (entry.deletedAt && changed.has(entry.key)) removed.push(entry.key.slice("novel:".length));
      }
    }
    since = next;
    if (!more) break;
  }
  return { cursor: since, pushed, applied, removed };
}
