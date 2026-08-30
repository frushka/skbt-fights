import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { joinRoom, realtimeUrl, type ConnectionState, type RoomConnection } from "@/lib/realtime";
import { createClientId, roomChannelName } from "@/lib/room";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Подключение…",
  connected: "Комната в эфире",
  reconnecting: "Переподключение…",
};

export const Route = createFileRoute("/dashboard/$roomId")({
  head: () => ({
    meta: [
      { title: "Панель ведущего — Пульс зала" },
      {
        name: "description",
        content: "Живой график настроения аудитории и QR-код для подключения участников.",
      },
      { property: "og:title", content: "Панель ведущего — Пульс зала" },
      {
        property: "og:description",
        content: "Смотрите суммарное настроение зала в реальном времени.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { roomId } = Route.useParams();
  const [values, setValues] = useState<Record<string, number>>({});
  const [participants, setParticipants] = useState(0);
  const [voteUrl, setVoteUrl] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const clientIdRef = useRef(createClientId());
  const roomRef = useRef<RoomConnection | null>(null);
  const configured = realtimeUrl() !== null;

  useEffect(() => {
    setVoteUrl(`${window.location.origin}/vote/${roomId}`);
  }, [roomId]);

  useEffect(() => {
    const room = joinRoom(roomChannelName(roomId), clientIdRef.current, "host", {
      onValue: (id, value) => setValues((prev) => ({ ...prev, [id]: value })),
      onParticipants: (ids) => {
        setParticipants(ids.length);
        // Ушедших убираем из суммы, иначе их последнее значение висело бы в среднем вечно.
        setValues((prev) => {
          const alive = new Set(ids);
          const result: Record<string, number> = {};
          for (const key of Object.keys(prev)) {
            if (alive.has(key)) result[key] = prev[key] ?? 0;
          }
          return result;
        });
      },
      onState: (state) => {
        setConnection(state);
        // Пока связи нет, показывать старые цифры нельзя — они выглядят как живые.
        if (state === "reconnecting") {
          setParticipants(0);
          setValues({});
        }
      },
    });
    roomRef.current = room;

    return () => {
      roomRef.current = null;
      room.close();
    };
  }, [roomId]);

  const sum = useMemo(() => Object.values(values).reduce((acc, v) => acc + v, 0), [values]);
  const total = participants > 0 ? sum / participants : 0;
  const scale = 100;
  const ratio = Math.max(-1, Math.min(1, total / scale));
  const positive = total >= 0;

  if (!configured) return <NotConfigured />;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-6">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="card-panel flex items-center gap-4">
            <div className="rounded-xl bg-foreground p-2">
              {voteUrl ? (
                <QRCodeSVG value={voteUrl} size={104} bgColor="transparent" fgColor="#0b1020" />
              ) : (
                <div className="size-[104px]" />
              )}
            </div>
            <div className="max-w-[15rem]">
              <p className="text-sm font-semibold">Сканируйте, чтобы голосовать</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{voteUrl}</p>
              <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                Код комнаты: <span className="font-bold text-foreground">{roomId}</span>
              </p>
            </div>
          </div>

          <div className="card-panel text-right">
            <p className="text-sm text-muted-foreground">Количество участников</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{participants}</p>
            <p
              className={`mt-1 text-xs ${
                connection === "reconnecting" ? "text-negative" : "text-muted-foreground"
              }`}
            >
              {CONNECTION_LABEL[connection]}
            </p>
          </div>
        </header>

        <section className="mt-8 flex flex-1 flex-col items-center justify-center">
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Настроение зала
          </p>
          <p
            className={`mt-2 text-6xl font-bold tabular-nums ${positive ? "text-positive" : "text-negative"}`}
          >
            {total > 0 ? "+" : ""}
            {Math.round(total)}
          </p>

          <div className="relative mt-8 flex h-[52vh] w-40 flex-col items-center">
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
              <div
                className={`absolute left-0 right-0 transition-all duration-150 ease-linear ${positive ? "bg-bar-positive" : "bg-bar-negative"}`}
                style={
                  positive
                    ? { bottom: "50%", height: `${ratio * 50}%` }
                    : { top: "50%", height: `${-ratio * 50}%` }
                }
              />
            </div>
            <div className="pointer-events-none absolute -right-24 flex h-full flex-col justify-between py-0 text-xs text-muted-foreground">
              <span>+100</span>
              <span>0</span>
              <span>−100</span>
            </div>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">Шкала фиксирована: +100 … −100</p>
        </section>
      </div>
    </main>
  );
}

/** Лучше честно сказать про недостающую настройку, чем показать пустой график как рабочий. */
function NotConfigured() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">Сервер не настроен</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Не задана переменная сборки <code>VITE_REALTIME_URL</code> — адрес сервера реального
          времени. Инструкция по развёртыванию: <code>server/README.md</code>.
        </p>
      </div>
    </main>
  );
}
