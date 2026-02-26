import React, { useEffect, useRef } from "react";
import Phaser from "phaser";
import { io } from "socket.io-client";

export default function StudioGame() {
    const ref = useRef();

    useEffect(() => {
        const socket = io("http://localhost:3001");

        class Scene extends Phaser.Scene {
            constructor() {
                super("main");
                this.players = new Map();
            }

            create() {
                this.cameras.main.setBackgroundColor("#17151f");

                this.add.rectangle(700, 450, 1200, 700, 0x231f2f).setStrokeStyle(2, 0xffffff, 0.1);

                this.keys = this.input.keyboard.addKeys("W,A,S,D,ONE,TWO,THREE,FOUR");

                socket.emit("join", {
                    name: "Guest",
                    color: "#F4B6C2"
                });

                socket.on("welcome", (msg) => {
                    msg.players.forEach(p => this.addPlayer(p));
                });

                socket.on("player_joined", (p) => this.addPlayer(p));
                socket.on("player_left", ({ id }) => {
                    const s = this.players.get(id);
                    if (s) { s.destroy(); this.players.delete(id); }
                });

                socket.on("state", (msg) => {
                    msg.players.forEach(p => {
                        const s = this.players.get(p.id);
                        if (!s) return;
                        s.x = Phaser.Math.Linear(s.x, p.x, 0.15);
                        s.y = Phaser.Math.Linear(s.y, p.y, 0.15);
                    });
                });

                socket.on("emote", ({ id, type }) => {
                    const s = this.players.get(id);
                    if (!s) return;
                    const t = this.add.text(s.x, s.y - 40, type === "wave" ? "👋" : "✨").setOrigin(0.5);
                    this.tweens.add({
                        targets: t,
                        y: t.y - 20,
                        alpha: 0,
                        duration: 800,
                        onComplete: () => t.destroy()
                    });
                });
            }

            addPlayer(p) {
                const c = this.add.circle(p.x, p.y, 18, Phaser.Display.Color.HexStringToColor(p.color).color);
                this.players.set(p.id, c);
            }

            update() {
                const ix = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
                const iy = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

                socket.emit("intent", { ix, iy });

                if (Phaser.Input.Keyboard.JustDown(this.keys.ONE))
                    socket.emit("emote", { type: "wave" });
            }
        }

        const game = new Phaser.Game({
            type: Phaser.AUTO,
            width: window.innerWidth,
            height: window.innerHeight,
            parent: ref.current,
            scene: Scene
        });

        return () => game.destroy(true);
    }, []);

    return <div ref={ref} />;
}