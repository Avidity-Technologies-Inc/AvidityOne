export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export function getApiBaseUrl() {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname.startsWith("events.") || window.location.hostname.startsWith("support."))
  ) {
    return "/api";
  }
  return apiBaseUrl;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage = "";
    try {
      const payload = JSON.parse(text) as { message?: string | string[]; error?: string; statusCode?: number };
      const message = Array.isArray(payload.message) ? payload.message.join(" ") : payload.message;
      parsedMessage = message || payload.error || (payload.statusCode ? `Request failed with status ${payload.statusCode}` : "");
    } catch {
      parsedMessage = "";
    }
    if (!parsedMessage && /<!doctype html|<html[\s>]/i.test(text)) {
      parsedMessage =
        response.status === 504
          ? "The server timed out while processing the request. Try a smaller selection or try again."
          : `Request failed with status ${response.status}. The server returned an HTML error page instead of JSON.`;
    }
    throw new ApiError(parsedMessage || text || `Request failed with status ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
