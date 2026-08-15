// GET /health — เช็คว่า Worker ทำงานปกติ (pattern มาตรฐานของระบบ production)
export function handleHealth(): Response {
    return Response.json({ status: "ok" });
}
