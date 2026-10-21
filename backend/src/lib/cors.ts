export const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function handleOptions(): Response {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
    });
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        if (!headers.has(key)) {
            headers.set(key, value);
        }
    }

    if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json; charset=utf-8");
    }

    if (!headers.has("Cache-Control")) {
        headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    }

    return new Response(JSON.stringify(data), {
        ...init,
        headers,
    });
}
