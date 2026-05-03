import WebSocket, { WebSocketServer } from "ws";

type JsonPayload = unknown;

export const sendJson = (socket: WebSocket, payload: JsonPayload): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
};

export const broadcast = (wss: WebSocketServer, payload: JsonPayload): void => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    client.send(JSON.stringify(payload));
  }
};

export const attachWebSocketServer = (server) => {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  wss.on("connection", (socket) => {
    sendJson(socket, { type: "welcome" });
    socket.on("error", console.error);
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: "match_create", data: match });
  }

  return { broadcastMatchCreated };
};
