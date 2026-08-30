// Сервер реального времени для «Пульса зала».
//
// Зачем он вообще есть: раньше значения ползунка ходили через Supabase Realtime, но
// российские провайдеры глушат трансграничное WebSocket-соединение к supabase.co —
// рукопожатие проходит, десяток кадров проскакивает, дальше поток затухает, причём без
// разрыва и без ошибки. Для зала с мобильным интернетом это неприемлемо, поэтому канал
// переехал на собственный сервер, который ставится на хостинг внутри страны.
//
// Запуск: bun server/realtime.js   (переменные PORT и HOST — необязательные)
// Развёртывание на VPS: см. server/README.md
//
// Зависимостей нет: WebSocket-сервер и рассылка по темам встроены в Bun.

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

/** Ограничения: точка входа публичная, поэтому не доверяем ничему, что пришло снаружи. */
const MAX_ROOM_ID = 64;
const MAX_CLIENT_ID = 64;
const MAX_MESSAGE_BYTES = 1024;

/** @type {Map<string, Map<string, { role: string, ws: unknown }>>} */
const rooms = new Map();

const topicOf = (roomId) => `room:${roomId}`;

function voterIds(roomId) {
  const members = rooms.get(roomId);
  if (!members) return [];
  const ids = [];
  for (const [id, member] of members) {
    if (member.role === "voter") ids.push(id);
  }
  return ids;
}

/** Список участников нужен всем сразу: и тем, кто уже в комнате, и тому, кто только вошёл. */
function publishParticipants(server, roomId) {
  server.publish(topicOf(roomId), JSON.stringify({ t: "p", ids: voterIds(roomId) }));
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  fetch(req, server) {
    const url = new URL(req.url);

    // Пинг для мониторинга и для проверки, что до сервера вообще доходит.
    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });

    const roomId = (url.searchParams.get("room") ?? "").slice(0, MAX_ROOM_ID);
    const clientId = (url.searchParams.get("id") ?? "").slice(0, MAX_CLIENT_ID);
    const role = url.searchParams.get("role") === "host" ? "host" : "voter";
    if (!roomId || !clientId) return new Response("room and id are required", { status: 400 });

    if (server.upgrade(req, { data: { roomId, clientId, role } })) return undefined;
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  },

  websocket: {
    // Мобильная сеть рвёт простаивающие соединения молча, поэтому клиент шлёт ping каждые
    // 20 секунд. Порог с запасом, чтобы одна потерянная посылка не убивала соединение.
    idleTimeout: 120,
    maxPayloadLength: MAX_MESSAGE_BYTES,

    open(ws) {
      const { roomId, clientId, role } = ws.data;
      let members = rooms.get(roomId);
      if (!members) {
        members = new Map();
        rooms.set(roomId, members);
      }
      // Переподключение с тем же id вытесняет прошлое соединение, а не двоит участника.
      members.set(clientId, { role, ws });
      ws.subscribe(topicOf(roomId));
      ws.send(JSON.stringify({ t: "p", ids: voterIds(roomId) }));
      publishParticipants(server, roomId);
    },

    message(ws, raw) {
      let msg;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }

      if (msg.t === "ping") {
        ws.send(JSON.stringify({ t: "pong" }));
        return;
      }

      if (msg.t === "v") {
        const value = Number(msg.v);
        if (!Number.isFinite(value)) return;
        const clamped = Math.max(-100, Math.min(100, Math.round(value)));
        // ws.publish не возвращает сообщение отправителю — ему оно не нужно.
        ws.publish(
          topicOf(ws.data.roomId),
          JSON.stringify({ t: "v", id: ws.data.clientId, v: clamped }),
        );
      }
    },

    close(ws) {
      const { roomId, clientId } = ws.data;
      const members = rooms.get(roomId);
      if (!members) return;
      // Не удаляем запись, если её уже перезаписало новое соединение того же участника.
      if (members.get(clientId)?.ws === ws) members.delete(clientId);
      if (members.size === 0) rooms.delete(roomId);
      else publishParticipants(server, roomId);
    },
  },
});

console.log(
  `Пульс зала: сервер реального времени слушает ws://${server.hostname}:${server.port}/ws`,
);
