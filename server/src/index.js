import { createServer } from "node:http";
import { Server } from "socket.io";

const httpServer = createServer();

const io = new Server(httpServer, {
    cors: { origin: ["http://localhost:5173"] }
});

const PORT = 3001;

const players = new Map();

const WORLD = { w: 1400, h: 900 };

function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}

io.on("connection", (socket) => {

    socket.on("join", ({ name, color }) => {
        const p = {
            id: socket.id,
            name: name || "Guest",
            color,
            x: WORLD.w / 2 + Math.random() * 40,
            y: WORLD.h / 2 + Math.random() * 40,
            ix: 0,
            iy: 0
        };

        players.set(socket.id, p);

        socket.join("studio");

        socket.emit("welcome", {
            selfId: socket.id,
            world: WORLD,
            players: Array.from(players.values())
        });

        socket.to("studio").emit("player_joined", p);
    });

    socket.on("intent", ({ ix, iy }) => {
        const p = players.get(socket.id);
        if (!p) return;

        p.ix = clamp(ix, -1, 1);
        p.iy = clamp(iy, -1, 1);
    });

    socket.on("emote", ({ type }) => {
        io.to("studio").emit("emote", {
            id: socket.id,
            type
        });
    });

    socket.on("disconnect", () => {
        players.delete(socket.id);
        io.to("studio").emit("player_left", { id: socket.id });
    });
});

// floaty movement loop
setInterval(() => {
    for (const p of players.values()) {
        p.x += p.ix * 6;
        p.y += p.iy * 6;

        p.x = clamp(p.x, 40, WORLD.w - 40);
        p.y = clamp(p.y, 40, WORLD.h - 40);
    }

    io.to("studio").emit("state", {
        players: Array.from(players.values()).map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y
        }))
    });
}, 50);

httpServer.listen(PORT, () => {
    console.log("Server running on", PORT);
});