import path from "node:path";

/**
 * WHERE THIS APP IS ALLOWED TO WRITE
 *
 * The whole app was built to run from files under the project directory - the
 * store, the weather cache, the call ledger, recorded Mireye fixtures. That is
 * exactly right on a laptop and fatal on a serverless host: Vercel and Lambda
 * mount the deployment read-only, and the only writable directory is /tmp. The
 * first `mkdir data/store` at request time throws ENOENT and takes the page
 * with it.
 *
 * This module is the one place that decides writable-vs-bundled, so no caller
 * has to know which environment it is in:
 *
 *   writablePath(...)  - somewhere the process may create and write files. On a
 *                        serverless host this is under /tmp; locally it is the
 *                        project directory, so local behaviour is unchanged.
 *   bundledPath(...)   - read-only data shipped WITH the deployment (the
 *                        committed seed and fixtures). Always the project dir.
 *
 * The split matters because the two are the same directory locally and
 * different directories in production, and every reader that has a committed
 * fallback (the store, the recorded fixtures) needs to read the bundled copy
 * while every writer needs the writable one.
 */

/**
 * Read-only serverless filesystem, where only /tmp is writable. Vercel and the
 * Lambda it runs on both set these; Netlify too. The env override exists so a
 * container deployment with a real writable disk can opt back in.
 */
export const IS_SERVERLESS = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY,
);

const WRITABLE_ROOT =
  process.env.GROUNDWORK_WRITABLE_DIR?.trim() ||
  (IS_SERVERLESS ? path.join("/tmp", "groundwork") : process.cwd());

/** A path the process is allowed to create and write to. */
export function writablePath(...segments: string[]): string {
  return path.join(WRITABLE_ROOT, ...segments);
}

/** A path to read-only data bundled with the deployment. */
export function bundledPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}
