export const ROOM_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function createRoomId(length = 6) {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += ROOM_ID_ALPHABET[bytes[i] % ROOM_ID_ALPHABET.length];
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
