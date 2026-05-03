import type { Server as HttpServer } from "node:http";
import type { RawData } from "ws";
import WebSocket, { WebSocketServer } from "ws";

type JsonPayload = unknown;
type MatchId = number;
type SubscribedSocket = WebSocket & {
  subscriptions: Set<MatchId>;
};

type BroadcastMatchCreated = (match: JsonPayload) => void;
type BroadcastCommentary = (matchId: MatchId, comment: JsonPayload) => void;

type WebSocketServerHandlers = {
  broadcastMatchCreated: BroadcastMatchCreated;
  broadcastCommentary: BroadcastCommentary;
};

type ClientMessage =
  | {
      type: "subscribe";
      matchId: MatchId;
    }
  | {
      type: "unsubscribe";
      matchId: MatchId;
    };

const matchSubscribers = new Map<MatchId, Set<SubscribedSocket>>();

const subscribe = (matchId: MatchId, socket: SubscribedSocket): void => {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }

  matchSubscribers.get(matchId)?.add(socket);
};

const unsubscribe = (matchId: MatchId, socket: SubscribedSocket): void => {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) {
    return;
  }

  subscribers.delete(socket);

  if (subscribers.size === 0) {
    matchSubscribers.delete(matchId);
  }
};

const cleanUpSubscriptions = (socket: SubscribedSocket): void => {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
};

export const sendJson = (socket: WebSocket, payload: JsonPayload): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
};

export const broadcastToAll = (
  wss: WebSocketServer,
  payload: JsonPayload,
): void => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    client.send(JSON.stringify(payload));
  }
};

const broadcastToMatch = (matchId: MatchId, payload: JsonPayload): void => {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const message = JSON.stringify(payload);

  for (const client of subscribers) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
};

const isClientMessage = (value: unknown): value is ClientMessage => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ClientMessage>;

  return (
    (message.type === "subscribe" || message.type === "unsubscribe") &&
    Number.isInteger(message.matchId)
  );
};

const handleMessage = (socket: SubscribedSocket, data: RawData): void => {
  let message: unknown;

  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    sendJson(socket, { type: "error", message: "Invalid JSON" });
    return;
  }

  if (!isClientMessage(message)) {
    sendJson(socket, { type: "error", message: "Invalid message" });
    return;
  }

  if (message.type === "subscribe") {
    subscribe(message.matchId, socket);
    socket.subscriptions.add(message.matchId);
    sendJson(socket, { type: "subscribed", matchId: message.matchId });
  }

  if (message.type === "unsubscribe") {
    unsubscribe(message.matchId, socket);
    socket.subscriptions.delete(message.matchId);
    sendJson(socket, { type: "unsubscribed", matchId: message.matchId });
  }
};

export const attachWebSocketServer = (
  server: HttpServer,
): WebSocketServerHandlers => {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  wss.on("connection", (socket) => {
    const subscribedSocket = socket as SubscribedSocket;
    subscribedSocket.subscriptions = new Set();

    sendJson(subscribedSocket, { type: "welcome" });

    socket.on("message", (data) => {
      handleMessage(subscribedSocket, data);
    });

    socket.on("error", () => {
      socket.terminate();
    });

    socket.on("close", () => {
      cleanUpSubscriptions(subscribedSocket);
    });

    socket.on("error", console.error);
  });

  function broadcastMatchCreated(match: JsonPayload): void {
    broadcastToAll(wss, { type: "match_create", data: match });
  }

  function broadcastCommentary(matchId: MatchId, comment: JsonPayload): void {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  }

  return { broadcastMatchCreated, broadcastCommentary };
};
