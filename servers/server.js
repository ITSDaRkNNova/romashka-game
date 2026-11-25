
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  cleanupRooms();

  if (req.method === "GET" && req.url === "/rooms") {
    const list = getRooms();

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    return res.end(JSON.stringify(list));
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Pes Romashka server OK. Кімнат: " + rooms.size);
});

const wss = new WebSocketServer({
  server,
  maxPayload: 8 * 1024
});

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function newCode() {
  for (let k = 0; k < 50; k++) {
    let code = "";

    for (let i = 0; i < 4; i++) {
      code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    }

    if (!rooms.has(code)) return code;
  }

  return null;
}

const cleanName = n =>
  String(n || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Гравець";

const clampInt = (v, a, b, d) => {
  v = parseInt(v);
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d;
};

// налаштування кімнати від господаря (перевіряємо, щоб не прислали сміття)
const cleanSettings = st => {
  st = st && typeof st === "object" ? st : {};
  return {
    maxPlayers: 2,
    flowers: clampInt(st.flowers, 5, 30, 10),
    damage: clampInt(st.damage, 10, 100, 10)
  };
};

const send = (ws, data) => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
};

function removePlayer(ws) {
  const code = ws.room;
  if (!code) return;

  const room = rooms.get(code);

  ws.room = null;
  ws.role = null;

  if (!room) return;

  if (room.host === ws) {
    send(room.guest, { t: "left" });

    if (room.guest) {
      room.guest.room = null;
      room.guest.role = null;
    }

    rooms.delete(code);
    return;
  }

  if (room.guest === ws) {
    room.guest = null;
    send(room.host, { t: "left" });
  }

  if (!room.host && !room.guest) {
    rooms.delete(code);
  }
}

function cleanupRooms() {
  for (const [code, room] of rooms) {
    const hostAlive =
      room.host && room.host.readyState === 1;

    const guestAlive =
      room.guest && room.guest.readyState === 1;

    if (!hostAlive) {
      if (room.guest) {
        send(room.guest, { t: "left" });
        room.guest.room = null;
        room.guest.role = null;
      }

      rooms.delete(code);
      continue;
    }

    if (room.guest && !guestAlive) {
      room.guest.room = null;
      room.guest.role = null;
      room.guest = null;

      send(room.host, { t: "left" });
    }
  }
}

function getRooms() {
  cleanupRooms();

  const list = [];

  for (const [code, room] of rooms) {
    if (
      room.host?.readyState === 1 &&
      !room.guest
    ) {
      list.push({
        code,
        name: room.host.name || "Гравець",
        host: room.host.name || "Гравець",
        settings: room.settings,
        players: 1,
        maxPlayers: 2
      });
    }
  }

  return list;
}

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.room = null;
  ws.role = null;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    let m;

    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!m || typeof m.t !== "string") return;

    if (m.t === "create" && !ws.room) {
      const code = newCode();

      if (!code) {
        return send(ws, { t: "error", e: "busy" });
      }

      ws.room = code;
      ws.role = "host";
      ws.name = cleanName(m.name);

      const settings = cleanSettings(m.settings);

      rooms.set(code, {
        host: ws,
        guest: null,
        settings
      });

      return send(ws, {
        t: "created",
        code,
        settings
      });
    }

    if (m.t === "join" && !ws.room) {
      const code = String(m.code || "")
        .toUpperCase()
        .trim();

      const room = rooms.get(code);

      if (!room) {
        return send(ws, { t: "error", e: "no_room" });
      }

      if (
        room.guest ||
        !room.host ||
        room.host.readyState !== 1
      ) {
        return send(ws, { t: "error", e: "full" });
      }

      room.guest = ws;
      ws.room = code;
      ws.role = "guest";
      ws.name = cleanName(m.name);

      send(ws, {
        t: "joined",
        code,
        settings: room.settings,
        peer: room.host.name
      });

      send(room.host, {
        t: "peer",
        name: ws.name
      });

      return;
    }

    // список відкритих кімнат (гра надсилає "list")
    if (m.t === "list" || m.t === "list_rooms") {
      const list = getRooms();
      send(ws, { t: "rooms", rooms: list });
      return;
    }

    if (m.t === "leave") {
      removePlayer(ws);
      return send(ws, { t: "left" });
    }

    const room = rooms.get(ws.room);
    if (!room) return;

    const other =
      ws.role === "host" ? room.guest : room.host;

    send(other, m);
  });

  ws.on("close", () => removePlayer(ws));
  ws.on("error", () => removePlayer(ws));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });

  cleanupRooms();
}, 15000);

server.listen(PORT, () => {
  console.log("Server on port " + PORT);
});
