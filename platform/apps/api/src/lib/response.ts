export function ok<T>(data: T) {
  return { success: true as const, data }
}

export function fail(code: string, message: string, details?: unknown) {
  return {
    success: false as const,
    error: { code, message, ...(details !== undefined && { details }) },
  }
}
