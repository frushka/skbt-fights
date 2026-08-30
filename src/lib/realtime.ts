/**
 * Клиент собственного сервера реального времени (см. server/realtime.js).
 *
 * Заменил Supabase Realtime: трансграничное соединение к supabase.co глушится российскими
 * провайдерами — поток затухает молча, без разрыва и без ошибки, и зал с мобильным
 * интернетом остаётся без связи.
 *
 * Адрес сервера задаётся переменной сборки VITE_REALTIME_URL, например
 * `wss://realtime.example.ru/ws`. Без неё приложение честно сообщает, что не настроено,
 * вместо тихой поломки.
 */

export type ConnectionState = "connecting" | "connected" | "reconnecting";

export type RoomMessage =
  { t: "v"; id: string; v: number } | { t: "p"; ids: string[] } | { t: "pong" };

export type RoomHandlers = {
  onValue?: (clientId: string, value: number) => void;
  onParticipants?: (ids: string[]) => void;
  onState?: (state: ConnectionState) => void;
};

export type RoomConnection = {
  send: (value: number) => void;
  close: () => void;
};

/** Задержки перед повторным подключением: последняя повторяется, пока связь не поднимется. */
const RETRY_DELAYS_MS = [1000, 2000, 5000];

/** Держит NAT мобильного оператора открытым и позволяет заметить онемевшее соединение. */
const PING_INTERVAL_MS = 20000;

/** Если pong не пришёл за это время, считаем связь мёртвой и переподключаемся. */
const PONG_TIMEOUT_MS = 10000;

export function realtimeUrl(): string | null {
  const url = import.meta.env["VITE_REALTIME_URL"];
  return typeof url === "string" && url.length > 0 ? url : null;
}

export function joinRoom(
  roomId: string,
  clientId: string,
  role: "host" | "voter",
  handlers: RoomHandlers,
): RoomConnection {
  const base = realtimeUrl();
  let socket: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (pingTimer !== null) clearInterval(pingTimer);
    if (pongTimer !== null) clearTimeout(pongTimer);
    retryTimer = pingTimer = pongTimer = null;
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null) return;
    handlers.onState?.("reconnecting");
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 5000;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const dropAndRetry = () => {
    if (pingTimer !== null) clearInterval(pingTimer);
    if (pongTimer !== null) clearTimeout(pongTimer);
    pingTimer = pongTimer = null;
    const stale = socket;
    socket = null;
    stale?.close();
    scheduleRetry();
  };

  const startHeartbeat = (ws: WebSocket) => {
    pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ t: "ping" }));
      // Ответа нет — значит соединение живо только на бумаге. Именно так выглядела
      // фильтрация трафика: сокет «открыт», а данные уже не ходят.
      if (pongTimer === null) pongTimer = setTimeout(dropAndRetry, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  };

  const connect = () => {
    if (disposed || !base) return;

    const url = new URL(base);
    url.searchParams.set("room", roomId);
    url.searchParams.set("id", clientId);
    url.searchParams.set("role", role);

    const ws = new WebSocket(url.toString());
    socket = ws;

    ws.onopen = () => {
      if (disposed || socket !== ws) return;
      attempt = 0;
      handlers.onState?.("connected");
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      if (disposed || socket !== ws) return;
      let msg: RoomMessage;
      try {
        msg = JSON.parse(String(event.data)) as RoomMessage;
      } catch {
        return;
      }

      if (msg.t === "pong") {
        if (pongTimer !== null) clearTimeout(pongTimer);
        pongTimer = null;
        return;
      }
      if (msg.t === "v") handlers.onValue?.(msg.id, msg.v);
      else if (msg.t === "p") handlers.onParticipants?.(msg.ids);
    };

    ws.onclose = () => {
      if (disposed || socket !== ws) return;
      socket = null;
      scheduleRetry();
    };

    // onerror всегда сопровождается onclose — отдельная обработка только дублировала бы retry.
    ws.onerror = () => {};
  };

  if (base) {
    handlers.onState?.("connecting");
    connect();
  }

  return {
    send(value) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "v", v: Math.round(value) }));
      }
    },
    close() {
      disposed = true;
      clearTimers();
      socket?.close();
      socket = null;
    },
  };
}
