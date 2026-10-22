import i18n from '../i18n'

export class ApiError extends Error {
  status: number
  data: Record<string, unknown> | null

  constructor(status: number, data: Record<string, unknown> | null) {
    super(typeof data?.detail === 'string' ? data.detail : `HTTP ${status}`)
    this.status = status
    this.data = data
  }

  get code(): string | undefined {
    return typeof this.data?.code === 'string' ? this.data.code : undefined
  }

  /** Field errors from DRF: { field: ["message"] }. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const [field, value] of Object.entries(this.data ?? {})) {
      if (Array.isArray(value) && typeof value[0] === 'string') errors[field] = value[0]
      else if (typeof value === 'string' && field !== 'detail' && field !== 'code') errors[field] = value
    }
    return errors
  }
}

export class NetworkError extends Error {}

function readCookie(name: string): string {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

type Query = Record<string, string | number | boolean | null | undefined>

export function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': i18n.language }
  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (method !== 'GET') headers['X-CSRFToken'] = readCookie('csrftoken')

  let response: Response
  try {
    response = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new NetworkError('network')
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
}

/** Human-readable message for any thrown error. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return i18n.t('common.errorNetwork')
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors())
    if (typeof error.data?.detail === 'string') return error.data.detail
    if (fields.length) return fields[0]
  }
  return i18n.t('common.errorGeneric')
}
