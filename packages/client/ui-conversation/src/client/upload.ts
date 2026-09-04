/** Browser helper to upload a non-image file to the host's temporary folder. */

/** One uploaded file result from the host /api/upload endpoint. */
export interface UploadFileResult {
  readonly ok: boolean
  readonly path: string
  readonly filename: string
  readonly size: number
}

/**
 * Upload a browser file to the server's temporary upload folder.
 * @param file - Dropped or pasted file to upload.
 * @returns Upload result containing the absolute path on the host.
 */
export async function uploadTempFile(file: File): Promise<UploadFileResult> {
  const url = `/api/upload?name=${encodeURIComponent(file.name)}`
  const response = await fetch(url, {
    method: 'POST',
    body: file,
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Upload failed with HTTP ${response.status}`)
  }
  const result = (await response.json()) as UploadFileResult & { readonly error?: string }
  if (!result.ok) {
    throw new Error(result.error || 'Upload failed')
  }
  return result
}
