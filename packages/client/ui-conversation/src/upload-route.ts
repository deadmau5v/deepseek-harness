/**
 * Host-side upload route registration for browser file intake.
 * Accepts files dragged or pasted into the composer and saves them to a temporary
 * uploads directory on the host, returning the absolute path.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Exact route path mounted on the API transport. */
export const UPLOAD_ROUTE_PATH = '/api/upload'

interface UploadConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly string[]
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

function connectionOf(ctx: Context): UploadConnection | undefined {
  return Reflect.get(ctx, 'connection') as UploadConnection | undefined
}

/**
 * Sanitize an uploaded filename to prevent directory traversal or control characters.
 * @param raw - untrusted client filename parameter.
 * @returns cleaned safe filename.
 */
export function sanitizeUploadFilename(raw: string): string {
  const base = basename(raw.trim()).replace(/[\0\r\n]/g, '')
  return base === '' || base === '.' || base === '..' ? 'upload' : base
}

/**
 * Resolve the temporary upload root directory.
 * @returns absolute directory path.
 */
export function resolveUploadDir(): string {
  if (process.platform !== 'win32') {
    return '/tmp/dsh-uploads'
  }
  return join(tmpdir(), 'dsh-uploads')
}

/**
 * Resolve a unique target file path by appending an incrementing index if the file exists.
 * @param dir - destination directory.
 * @param filename - safe filename.
 * @returns unique absolute path to write.
 */
export async function resolveUniqueUploadPath(dir: string, filename: string): Promise<string> {
  const ext = extname(filename)
  const nameWithoutExt = basename(filename, ext)
  let candidate = join(dir, filename)
  let index = 1
  while (true) {
    try {
      await stat(candidate)
      candidate = join(dir, `${nameWithoutExt}_${index}${ext}`)
      index += 1
    } catch {
      return candidate
    }
  }
}

/**
 * Register the authenticated /api/upload route on the injected connection service.
 * @param ctx - Context carrying the connection service.
 */
export function registerUploadRoute(ctx: Context): void {
  const connection = connectionOf(ctx)
  if (connection === undefined) return

  connection.fetch.register({
    path: UPLOAD_ROUTE_PATH,
    methods: ['POST'],
    fetch: async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url)
        const nameParam = url.searchParams.get('name') ?? 'upload'
        const filename = sanitizeUploadFilename(nameParam)
        const uploadDir = resolveUploadDir()

        await mkdir(uploadDir, { recursive: true })
        const targetPath = await resolveUniqueUploadPath(uploadDir, filename)

        const arrayBuffer = await request.arrayBuffer()
        await writeFile(targetPath, Buffer.from(arrayBuffer))

        return Response.json({
          ok: true,
          path: targetPath,
          filename: basename(targetPath),
          size: arrayBuffer.byteLength,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json(
          { ok: false, error: message },
          { status: 500 },
        )
      }
    },
  })
}
