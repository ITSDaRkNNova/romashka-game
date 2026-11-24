// Сервер кімнат для гри «Пес Ромашка» (гра з другом).
// Він нічого не рахує, лише з'єднує двох гравців і пересилає їм повідомлення.
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const rooms = new Map(); // код -> { host, guest }

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Pes Romashka server OK. Кімнат: " + rooms.size);
});
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // без I та O
function newCode() {
  for (let k = 0; k < 50; k++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
// нік: до 16 символів, без < та >
const cleanName = (n) => String(n || "").replace(/[<>]/g, "").trim().slice(0, 16) || "Гравець";
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.role = null;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;

    if (m.t === "create" && !ws.room) {
      const code = newCode();
      if (!code) return send(ws, { t: "error", e: "busy" });
      rooms.set(code, { host: ws, guest: null });
      ws.room = code; ws.role = "host"; ws.name = cleanName(m.name);
      return send(ws, { t: "created", code });
    }

    if (m.t === "join" && !ws.room) {
      const code = String(m.code || "").toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: "error", e: "no_room" });
      if (r.guest) return send(ws, { t: "error", e: "full" });
      r.guest = ws; ws.room = code; ws.role = "guest"; ws.name = cleanName(m.name);
      send(ws, { t: "joined", code, peer: r.host.name });
      send(r.host, { t: "peer", name: ws.name });
      return;
    }

    // усе інше (позиції, ромашки, стан пса) просто пересилаємо другому гравцю
    const r = rooms.get(ws.room);
    if (!r) return;
    const other = ws.role === "host" ? r.guest : r.host;
    send(other, m);
  });

  ws.on("close", () => {
    const r = rooms.get(ws.room);
    if (!r) return;
    const other = ws.role === "host" ? r.guest : r.host;
    send(other, { t: "left" });
    if (other) { other.room = null; other.role = null; }
    rooms.delete(ws.room);
  });
});

// прибираємо «мертві» з'єднання
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log("Server on port " + PORT));
        
