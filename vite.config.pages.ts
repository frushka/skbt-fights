// Сборка статической версии сайта для GitLab Pages.
//
// Основной vite.config.ts не трогаем — по нему собирается SSR-деплой Lovable/Cloudflare.
// Здесь та же обёртка @lovable.dev/vite-tanstack-config, но с тремя отличиями:
//
//   nitro: false     — не собирать серверный бандл (Cloudflare Worker). GitLab Pages умеет
//                      отдавать только статику, сервер запускать негде.
//   spa.enabled      — TanStack Start не рендерит страницы на сервере, а один раз
//                      пререндерит оболочку приложения в dist/client/_shell.html;
//                      весь роутинг дальше работает на клиенте.
//   server.host      — обёртка по умолчанию слушает на "::" (IPv6). Пререндер поднимает
//                      локальный сервер, и в CI-контейнерах без IPv6 это падает с
//                      EAFNOSUPPORT. Явный IPv4-хост делает сборку предсказуемой.
//
// Результат сборки: dist/client — это и есть готовый статический сайт.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  vite: { server: { host: "127.0.0.1" } },
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true },
  },
});
