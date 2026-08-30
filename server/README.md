# Сервер реального времени

Значения ползунка ходят через собственный WebSocket-сервер (`realtime.js`), а не через
Supabase. Причина: российские провайдеры глушат трансграничное соединение с `supabase.co` —
рукопожатие проходит, первые кадры доходят, дальше поток затухает **без разрыва и без ошибки**.
На экране всё выглядит подключённым, а числа замирают. Через VPN тот же код работает
безупречно — но просить зал включить VPN нельзя.

Отсюда требование: сервер должен стоять на хостинге **внутри страны**, чтобы трафик зрителей
не пересекал границу.

## Что понадобится

- VPS у российского хостера (Timeweb, Selectel, Beget, Яндекс Облако) — хватит самого младшего
  тарифа, нагрузка тут копеечная;
- домен или поддомен, направленный A-записью на IP этого VPS;
- TLS обязателен: сайт открывается по `https`, а браузер не пустит с него незащищённый `ws://`.

## Установка

Всё ниже выполняется на VPS по SSH от root.

**1. Bun** — сервер написан под него, зависимостей нет вовсе:

```sh
curl -fsSL https://bun.sh/install | bash
ln -sf /root/.bun/bin/bun /usr/local/bin/bun
```

**2. Код сервера:**

```sh
mkdir -p /opt/pulse
# скопируйте сюда server/realtime.js из репозитория, например:
#   scp server/realtime.js root@<ip>:/opt/pulse/realtime.js
```

**3. Автозапуск** — служба systemd, чтобы сервер поднимался после перезагрузки и падений:

```sh
cat > /etc/systemd/system/pulse.service <<'EOF'
[Unit]
Description=Pulse realtime server
After=network.target

[Service]
ExecStart=/usr/local/bin/bun /opt/pulse/realtime.js
Environment=PORT=8787
Environment=HOST=127.0.0.1
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pulse
systemctl status pulse
```

Сервер слушает только `127.0.0.1` — наружу его выставляет Caddy, он же берёт на себя TLS.

**4. Caddy** — веб-сервер, который сам получает и продлевает сертификат:

```sh
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Конфигурация — подставьте свой домен:

```sh
cat > /etc/caddy/Caddyfile <<'EOF'
realtime.example.ru {
	reverse_proxy 127.0.0.1:8787
}
EOF

systemctl reload caddy
```

Caddy сам выпустит сертификат Let's Encrypt при первом обращении. Порты 80 и 443 должны быть
открыты в фаерволе хостера.

**5. Проверка:**

```sh
curl https://realtime.example.ru/health   # ожидается: ok
```

## Подключение сайта к серверу

Адрес сервера попадает в сборку через переменную `VITE_REALTIME_URL`. Задаётся один раз в
GitLab: **Settings → CI/CD → Variables → Add variable**

| Поле             | Значение                       |
| ---------------- | ------------------------------ |
| Key              | `VITE_REALTIME_URL`            |
| Value            | `wss://realtime.example.ru/ws` |
| Protect variable | снять галочку                  |

Обратите внимание на схему `wss://` (не `https://`) и на путь `/ws` в конце.

После этого запустите пайплайн заново (**Build → Pipelines → New pipeline**) — переменная
подставляется на этапе сборки, у уже собранного сайта её не поменять.

Пока переменная не задана, приложение честно показывает «Сервер не настроен» вместо
неработающего ползунка.

## Протокол

Клиент подключается к `wss://<домен>/ws?room=<комната>&id=<клиент>&role=host|voter`.

| Направление     | Сообщение                     | Смысл                                      |
| --------------- | ----------------------------- | ------------------------------------------ |
| клиент → сервер | `{"t":"v","v":42}`            | текущее значение ползунка                  |
| клиент → сервер | `{"t":"ping"}`                | каждые 20 с: держит NAT оператора открытым |
| сервер → клиент | `{"t":"v","id":"...","v":42}` | значение другого участника                 |
| сервер → клиент | `{"t":"p","ids":[...]}`       | список участников (без ведущего)           |
| сервер → клиент | `{"t":"pong"}`                | ответ на ping                              |

Ничего не хранится: комната существует, пока в ней есть хотя бы одно соединение.

Отправитель своё же значение обратно не получает, комнаты изолированы друг от друга, значения
обрезаются до диапазона −100…+100, размер сообщения ограничен — точка входа публичная.

Если `pong` не приходит за 10 секунд, клиент считает соединение мёртвым и переподключается.
Это защита ровно от того сценария, что был с Supabase: сокет формально открыт, а данные уже
не ходят.

## Обслуживание

```sh
systemctl restart pulse      # перезапуск
journalctl -u pulse -f       # логи
```

Обновление: скопировать новый `realtime.js` в `/opt/pulse/` и перезапустить службу.
