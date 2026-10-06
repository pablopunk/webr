import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'assets/brand/icon.png');
const out = resolve(root, 'public');
const tile = '#f8f8f7';

const magick = (...args: string[]) => execFileSync('magick', args, { stdio: 'inherit' });
const trimmedMark = (size: number, file: string) => magick(source, '-trim', '+repage', '-resize', `${size}x${size}`, '-background', 'none', '-gravity', 'center', '-extent', `${size}x${size}`, file);
const paddedOnTile = (size: number, padding: number, file: string) => magick(source, '-trim', '+repage', '-resize', `${size - padding * 2}x${size - padding * 2}`, '-background', tile, '-gravity', 'center', '-extent', `${size}x${size}`, file);

mkdirSync(out, { recursive: true });
trimmedMark(64, resolve(out, 'brand-mark.png'));
trimmedMark(32, resolve(out, 'favicon-32.png'));
trimmedMark(16, resolve(out, 'favicon-16.png'));
magick(resolve(out, 'favicon-16.png'), resolve(out, 'favicon-32.png'), resolve(out, 'favicon.ico'));
paddedOnTile(180, 8, resolve(out, 'apple-touch-icon.png'));
paddedOnTile(192, 9, resolve(out, 'icon-192.png'));
paddedOnTile(512, 24, resolve(out, 'icon-512.png'));
paddedOnTile(512, 51, resolve(out, 'icon-maskable-512.png'));

writeFileSync(resolve(out, 'manifest.webmanifest'), `${JSON.stringify({
  name: 'Webr', short_name: 'Webr', id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: tile, theme_color: tile,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2)}\n`);
