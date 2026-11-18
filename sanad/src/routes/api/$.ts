import { createFileRoute } from '@tanstack/react-router';

// REST API for the Sanad backend (auth, CV agent, jobs agent).
// The handler is imported lazily so no server code reaches the browser bundle.
const handle = async ({ request }: { request: Request }) => (await import('@/server/http/api')).handleApiRequest(request);

export const Route = createFileRoute('/api/$')({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle, HEAD: handle } },
});
