import { QueryClient, QueryFunction } from "@tanstack/react-query";

function readHubDbFromStorage(): string | null {
  try {
    const saved = localStorage.getItem("fishtokri_hub");
    if (saved) {
      const { subHub } = JSON.parse(saved);
      return subHub?.dbName ?? null;
    }
  } catch {}
  return null;
}

let activeHubDb: string | null = readHubDbFromStorage();

export function setActiveHubDb(dbName: string | null) {
  activeHubDb = dbName;
}

export function getActiveHubDb(): string | null {
  return activeHubDb;
}

export function getHubHeaders(): Record<string, string> {
  return activeHubDb ? { "X-Hub-DB": activeHubDb } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { ...getHubHeaders() };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      headers: getHubHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Individual live-data queries opt into their own refresh interval.
      // Do not poll every API query globally (especially /api/customer/me).
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
