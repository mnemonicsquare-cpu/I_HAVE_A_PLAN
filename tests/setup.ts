import { preview } from "vite";

// Own the HTTP server in the runner process: no orphan shell processes on Windows.
export default async function setup() {
  if (process.env.APP_URL) return;
  const server = await preview({
    preview: {
      host: "127.0.0.1",
      port: Number(process.env.TEST_PORT || 4174),
      strictPort: true,
    },
  });
  return async () => {
    if ('closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
