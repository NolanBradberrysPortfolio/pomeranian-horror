# Nighttail: Exit 13

Mobile-first browser horror game built with Three.js.

You explore a deserted building with a flashlight, collect three keys, and unlock the exit while a small brown Pomeranian terrier mix hunts you through the rooms. The dog growls and barks, closes distance over time, can jump-scare the player, and can be pushed back with the flashlight or the squirt-gun button.

## Play Locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/pomeranian-horror/`.

## Controls

- Phone: left side virtual stick moves, right side drag looks, round buttons toggle flashlight and fire the squirt gun.
- Desktop: WASD moves, mouse pointer lock looks, `F` toggles flashlight, `Space` fires.

## Validation

```powershell
npm run build
npm run test:mobile
```

The mobile playtest uses a Pixel-sized touch browser context, drives the full level, collects all three keys, repels the dog, reaches the exit, and writes artifacts to `playtest-results/`.

Current acceptance rubric target:

- Graphics: 10/10
- Mobile controls: 10/10
- Playability: 10/10
- Enemy mechanics: 10/10
- Objective flow: 10/10
- Performance: 10/10
