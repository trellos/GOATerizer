/**
 * Entry point.
 *
 * The app does nothing that needs permission until the player presses Play on
 * the start screen: no AudioContext, no microphone, no transport.
 */

import { GameApp } from "./app/game-app.js";
import "./styles.css";

const app = new GameApp();
void app.start();

// Handy for the browser-validation suite and for poking at state in a console.
// It exposes the app, not the internals: everything on it is already public.
(window as unknown as { goaterizer?: GameApp }).goaterizer = app;
