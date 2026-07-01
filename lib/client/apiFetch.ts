export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let data: unknown = {};

  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} (${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(data) ?? `${fallbackMessage} (${response.status})`);
  }

  return data as T;
}

function readErrorMessage(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const error = data.error;
    return typeof error === "string" ? error : null;
  }
  return null;
}
