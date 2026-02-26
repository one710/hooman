/**
 * WebSocket route for live transcription. Client connects to /ws/transcribe?token=...;
 * upgrade/auth handled here; business logic in chats/realtime-service.
 */
import type { IncomingMessage } from "http";
import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getConfig } from "../config.js";
import { isWebAuthEnabled } from "../env.js";
import { verifyToken } from "../middleware/auth-jwt.js";
import { handleRealtimeConnection } from "../chats/realtime-service.js";

const TRANSCRIBE_WS_PATH = "/ws/transcribe";

function getTokenFromRequest(req: IncomingMessage): string | null {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(q);
  return params.get("token");
}

export function attachTranscribeWs(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path !== TRANSCRIBE_WS_PATH) return;

    const token = getTokenFromRequest(req);
    if (isWebAuthEnabled()) {
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      verifyToken(token)
        .then((payload) => {
          if (!payload) {
            socket.write(
              "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
            );
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        })
        .catch(() => {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
        });
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage) => {
    const config = getConfig();
    handleRealtimeConnection(clientWs, config);
  });
}
