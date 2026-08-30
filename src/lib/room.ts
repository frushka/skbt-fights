export const ROOM_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function createRoomId(length = 6) {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += ROOM_ID_ALPHABET[(bytes[i] ?? 0) % ROOM_ID_ALPHABET.length];
  }
  return out;
}

export function createClientId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function roomChannelName(roomId: string) {
  return `mood-room-${roomId}`;
}

export const RETURN_DURATION_MS = 5000;

/**
 * Пауза между broadcast-сообщениями участника.
 *
 * Supabase Realtime ограничивает клиента 10 событиями в секунду (лимит проекта по умолчанию,
 * клиент создаётся без `realtime.params.eventsPerSecond`). При превышении сервер обрывает канал,
 * и участник этого не замечает — отправка молча уходит в никуда.
 *
 * 150 мс дают ~6.7 сообщения в секунду. Запас нужен не для красоты: в тот же лимит попадают
 * presence-события (`track` при подключении), поэтому упираться в 10 нельзя. На глаз движение
 * при этом остаётся живым — столбик у ведущего сглаживает разницу CSS-переходом.
 */
export const BROADCAST_INTERVAL_MS = 150;

export type ThrottledSender = {
  /** Отправить значение. `force` шлёт немедленно, минуя интервал. */
  send: (value: number, force?: boolean) => void;
  /** Снять отложенную отправку (вызывать при размонтировании). */
  cancel: () => void;
};

/**
 * Ограничивает частоту отправки, но не теряет последнее значение: то, что не прошло по интервалу,
 * запоминается и уходит по таймеру. Без этого хвоста финальная позиция ползунка (или ноль в конце
 * анимации возврата) могла бы не доехать до ведущего вовсе.
 */
export function createThrottledSender(
  emit: (value: number) => void,
  intervalMs = BROADCAST_INTERVAL_MS,
): ThrottledSender {
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    if (pending === null) return;
    const value = pending;
    pending = null;
    lastSentAt = Date.now();
    emit(value);
  };

  return {
    send(value, force = false) {
      pending = value;
      const wait = intervalMs - (Date.now() - lastSentAt);
      if (force || wait <= 0) {
        clearTimer();
        flush();
        return;
      }
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          flush();
        }, wait);
      }
    },
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
