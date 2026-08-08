import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createRoomId } from "@/lib/room";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Пульс зала — живой замер настроения аудитории" },
      {
        name: "description",
        content:
          "Создайте комнату, покажите QR-код залу и наблюдайте настроение аудитории в реальном времени.",
      },
      { property: "og:title", content: "Пульс зала — живой замер настроения аудитории" },
      {
        property: "og:description",
        content: "Мгновенный замер настроения зала: QR-код, слайдер и живой график.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative z-10 w-full max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-muted-foreground">
          Пульс зала
        </p>
        <h1 className="mt-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
          Настроение аудитории <span className="text-gradient">в прямом эфире</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Зал двигает слайдер — вы видите общий пульс мгновенно. Без регистрации и без лишних
          настроек.
        </p>
        <button
          onClick={() => navigate({ to: "/dashboard/$roomId", params: { roomId: createRoomId() } })}
          className="btn-hero mt-10"
        >
          Создать комнату
        </button>
        <p className="mt-6 text-sm text-muted-foreground">
          Комната живёт, пока открыта эта страница
        </p>
      </div>
    </main>
  );
}
