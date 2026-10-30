export function joinProviderUrl(baseUrl: string, requiredPrefix: string, path: string) {
  let normalizedBase = (baseUrl || '').trim().replace(/\/+$/, '')
  // Accept a pasted Ark endpoint as well as the host or API prefix.
  if (requiredPrefix === '/api/v3') {
    normalizedBase = normalizedBase.replace(/\/(?:responses|chat\/completions|images\/generations|contents\/generations\/tasks)$/, '')
  }
  const normalizedPrefix = normalizeSegment(requiredPrefix)
  const normalizedPath = normalizeSegment(path)

  if (!normalizedBase) {
    return `${normalizedPrefix}${normalizedPath}`
  }

  try {
    const url = new URL(normalizedBase)
    const currentPath = url.pathname.replace(/\/+$/, '')
    const mergedPrefix = currentPath.endsWith(normalizedPrefix)
      ? currentPath
      : `${currentPath}${normalizedPrefix}`

    url.pathname = `${mergedPrefix}${normalizedPath}`.replace(/\/{2,}/g, '/')
    return url.toString()
  } catch {
    const basePath = normalizedBase.endsWith(normalizedPrefix)
      ? normalizedBase
      : `${normalizedBase}${normalizedPrefix}`
    return `${basePath}${normalizedPath}`
  }
}

function normalizeSegment(segment: string) {
  if (!segment) return ''
  return segment.startsWith('/') ? segment : `/${segment}`
}
