import * as THREE from 'three';

// Faktury gleby generowane w przeglądarce na płótnie, bez plików z obrazkami.

export function soilTexture(hex, grain, plowed = false) {
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(hex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  const shade = (k) => { const c = base.clone().multiplyScalar(k); return `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`; };
  for (let i = 0; i < 1400; i++) {           // plamy wilgoci i próchnicy
    ctx.globalAlpha = .08;
    ctx.fillStyle = shade(.6 + Math.random() * .7);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 2 + Math.random() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 5000 * grain; i++) {   // ziarna
    ctx.globalAlpha = .5;
    ctx.fillStyle = shade(.55 + Math.random() * .9);
    const r = Math.random() * grain * 1.3;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  if (plowed) {                               // bruzdy na powierzchni pola bez uprawy
    ctx.globalAlpha = .18;
    for (let y = 0; y < size; y += 16) { ctx.fillStyle = shade(.55); ctx.fillRect(0, y, size, 5); }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(.35, .35);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
