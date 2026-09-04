import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  registerUploadRoute,
  resolveUniqueUploadPath,
  resolveUploadDir,
  sanitizeUploadFilename,
  UPLOAD_ROUTE_PATH,
} from '../src/upload-route.ts'
import { uploadTempFile } from '../src/client/upload.ts'

describe('upload-route host utilities', () => {
  it('sanitizes unsafe filename inputs', () => {
    expect(sanitizeUploadFilename('../../secret.zip')).toBe('secret.zip')
    expect(sanitizeUploadFilename('foo/bar/baz.tar.gz')).toBe('baz.tar.gz')
    expect(sanitizeUploadFilename('   padded.zip   ')).toBe('padded.zip')
    expect(sanitizeUploadFilename('')).toBe('upload')
    expect(sanitizeUploadFilename('.')).toBe('upload')
    expect(sanitizeUploadFilename('..')).toBe('upload')
    expect(sanitizeUploadFilename('null\0byte.txt')).toBe('nullbyte.txt')
  })

  it('resolves upload dir', () => {
    const dir = resolveUploadDir()
    expect(typeof dir).toBe('string')
    expect(dir.length).toBeGreaterThan(0)
    expect(dir).toContain('dsh-uploads')
  })

  it('resolves unique path by appending index when target exists', async () => {
    const dir = resolveUploadDir()
    const first = await resolveUniqueUploadPath(dir, 'test-nonexistent-unique.zip')
    expect(first).toBe(join(dir, 'test-nonexistent-unique.zip'))
  })

  it('registers /api/upload route on connection service and handles file writes', async () => {
    const ctx = new Context()
    let registeredRoute: {
      readonly path: string
      readonly methods: readonly string[]
      readonly fetch: (request: Request) => Promise<Response>
    } | undefined

    const fakeConnection = {
      fetch: {
        register: (route: typeof registeredRoute) => {
          registeredRoute = route
          return Promise.resolve()
        },
      },
    }

    Reflect.set(ctx, 'connection', fakeConnection)
    registerUploadRoute(ctx)

    expect(registeredRoute).toBeDefined()
    expect(registeredRoute?.path).toBe(UPLOAD_ROUTE_PATH)
    expect(registeredRoute?.methods).toContain('POST')

    const fileContent = 'sample binary or zip content'
    const request = new Request('http://127.0.0.1/api/upload?name=test-package.zip', {
      method: 'POST',
      body: Buffer.from(fileContent),
    })

    const response = await registeredRoute!.fetch(request)
    expect(response.status).toBe(200)

    const result = (await response.json()) as { ok: boolean; path: string; filename: string; size: number }
    expect(result.ok).toBe(true)
    expect(result.filename).toBe('test-package.zip')
    expect(result.size).toBe(Buffer.byteLength(fileContent))

    const written = await readFile(result.path, 'utf8')
    expect(written).toBe(fileContent)

    // Clean up written test file
    await rm(result.path, { force: true })
  })

  it('handles server exceptions by returning 500 status', async () => {
    const ctx = new Context()
    let registeredRoute: {
      readonly fetch: (request: Request) => Promise<Response>
    } | undefined

    Reflect.set(ctx, 'connection', {
      fetch: {
        register: (route: typeof registeredRoute) => {
          registeredRoute = route
          return Promise.resolve()
        },
      },
    })

    registerUploadRoute(ctx)

    // A broken request that throws on arrayBuffer
    const fakeRequest = {
      url: 'http://127.0.0.1/api/upload?name=bad.zip',
      arrayBuffer: () => Promise.reject(new Error('simulated arrayBuffer failure')),
    } as unknown as Request

    const response = await registeredRoute!.fetch(fakeRequest)
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('simulated arrayBuffer failure')
  })
})

describe('uploadTempFile client helper', () => {
  it('posts file to /api/upload and returns result', async () => {
    const testFile = new File(['content'], 'sample.zip', { type: 'application/zip' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ok: true,
        path: '/tmp/dsh-uploads/sample.zip',
        filename: 'sample.zip',
        size: 7,
      }), { status: 200 }),
    )

    try {
      const result = await uploadTempFile(testFile)
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/upload?name=sample.zip',
        expect.objectContaining({ method: 'POST', body: testFile }),
      )
      expect(result.ok).toBe(true)
      expect(result.path).toBe('/tmp/dsh-uploads/sample.zip')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('throws on non-ok HTTP status or error payload', async () => {
    const testFile = new File(['content'], 'bad.zip', { type: 'application/zip' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    )

    try {
      await expect(uploadTempFile(testFile)).rejects.toThrow('Internal Server Error')
    } finally {
      fetchSpy.mockRestore()
    }

    const fetchSpy2 = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'disk full' }), { status: 200 }),
    )

    try {
      await expect(uploadTempFile(testFile)).rejects.toThrow('disk full')
    } finally {
      fetchSpy2.mockRestore()
    }
  })
})
