import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  RETURN_DURATION_MS,
  createClientId,
  createThrottledSender,
  roomChannelName,
  type ThrottledSender,
} from "@/lib/room";

type ConnectionState = "connecting" | "connected" | "reconnecting";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Подключение…",
  connected: "Подключено",
  reconnecting: "Переподключение…",
};

/** Задержки перед повторным подключением: последняя повторяется, пока канал не поднимется. */
const RETRY_DELAYS_MS = [1000, 2000, 5000];

export const Route = createFileRoute("/vote/$roomId")({
  head: () => ({
    meta: [
      { title: "Голосование — Пульс зала" },
      {
        name: "description",
        content: "Двигайте слайдер, чтобы показать своё отношение прямо сейчас.",
      },
      { property: "og:title", content: "Голосование — Пульс зала" },
      { property: "og:description", content: "Ваш голос виден ведущему в реальном времени." },
    ],
  }),
  component: Vote,
});

function Vote() {
  const { roomId } = Route.useParams();
  const [value, setValue] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [dragging, setDragging] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientIdRef = useRef(createClientId());
  const rafRef = useRef<number | null>(null);
  const senderRef = useRef<ThrottledSender | null>(null);
  const valueRef = useRef(0);

  const send = useCallback((next: number, force = false) => {
    valueRef.current = next;
    senderRef.current?.send(next, force);
  }, []);

  useEffect(() => {
    const sender = createThrottledSender((next) => {
      channelRef.current?.send({
        type: "broadcast",
        event: "value",
        payload: { id: clientIdRef.current, value: Math.round(next) },
      });
    });
    senderRef.current = sender;

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) return;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 5000;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    // Пересоздаём канал целиком, а не переподписываем старый: у закрытого канала обработчики
    // ошибок навешиваются заново при каждой подписке и начали бы копиться.
    const connect = () => {
      if (disposed) return;
      if (channel) {
        const stale = channel;
        channel = null;
        channelRef.current = null;
        void supabase.removeChannel(stale);
      }

      const next = supabase.channel(roomChannelName(roomId), {
        config: { presence: { key: clientIdRef.current }, broadcast: { self: false } },
      });
      channel = next;
      channelRef.current = next;

      next.subscribe(async (status) => {
        // Отставшее событие от канала, который мы уже заменили или размонтировали.
        if (disposed || channelRef.current !== next) return;

        if (status === "SUBSCRIBED") {
          attempt = 0;
          setConnection("connected");
          await next.track({ role: "voter" });
          // Заново объявляем текущее положение: ведущий мог пропустить его, пока канала не было.
          sender.send(valueRef.current, true);
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("reconnecting");
          scheduleRetry();
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      sender.cancel();
      senderRef.current = null;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [roomId]);

  const stopAnimation = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const startReturn = (from: number) => {
    stopAnimation();
    if (from === 0) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / RETURN_DURATION_MS);
      const next = from * (1 - t);
      setValue(next);
      send(next, t === 1);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const valueFromEvent = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const raw = ((center - clientY) / (rect.height / 2)) * 100;
    return Math.max(-100, Math.min(100, raw));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    stopAnimation();
    setDragging(true);
    const next = valueFromEvent(e.clientY);
    setValue(next);
    send(next, true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const next = valueFromEvent(e.clientY);
    setValue(next);
    send(next);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    startReturn(value);
  };

  const percent = (1 - (value + 100) / 200) * 100;
  const positive = value >= 0;

  return (
    <main className="relative flex min-h-screen touch-none flex-col overflow-hidden px-6 py-6">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative z-10 flex flex-1 flex-col items-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Комната {roomId}</p>
        <p
          className={`mt-1 text-xs ${
            connection === "reconnecting" ? "text-negative" : "text-muted-foreground"
          }`}
        >
          {CONNECTION_LABEL[connection]}
        </p>

        <p className="mt-6 text-center text-lg font-semibold text-positive">Мне очень нравится</p>

        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative my-4 w-28 flex-1 cursor-grab select-none rounded-full border border-border bg-card active:cursor-grabbing"
        >
          <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-border" />
          <div
            className={`absolute left-1/2 w-2 -translate-x-1/2 rounded-full ${positive ? "bg-bar-positive" : "bg-bar-negative"}`}
            style={
              positive
                ? { bottom: "50%", height: `${(value / 100) * 50}%` }
                : { top: "50%", height: `${(-value / 100) * 50}%` }
            }
          />
          <div
            className="pointer-events-none absolute left-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-thumb text-lg font-bold tabular-nums shadow-thumb"
            style={{ top: `${percent}%` }}
          >
            {value > 0 ? "+" : ""}
            {Math.round(value)}
          </div>
        </div>

        <p className="text-center text-lg font-semibold text-negative">Мне очень не нравится</p>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Отпустите — ползунок сам вернётся к нулю за 5 секунд
        </p>
      </div>
    </main>
  );
}
