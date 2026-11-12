import * as THREE from 'three';
import { Tile, type GameMap } from '../sim/map';
import { COLORS } from './palette';

/** The ground for the minimap: one pixel per tile, coloured like the terrain, with dunes shaded. */
export function minimapTerrain(map: GameMap): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = map.width;
  cv.height = map.height;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(map.width, map.height);
  const c = new THREE.Color();
  const tint = (hex: number): THREE.Color => c.setHex(hex).offsetHSL(map.tint.hue, map.tint.sat, map.tint.light);
  for (let tz = 0; tz < map.height; tz++) {
    for (let tx = 0; tx < map.width; tx++) {
      switch (map.tileAt(tx, tz)) {
        case Tile.Rock:
          tint(COLORS.rockMesh);
          break;
        case Tile.Fertile:
          c.setHex(0x6f8f3c);
          break;
        case Tile.Water:
          c.setHex(COLORS.water);
          break;
        case Tile.Oil:
          tint(0x2f2924);
          break;
        case Tile.Ruin:
          tint(0xa19b8e);
          break;
        default:
          tint(0xd2b177);
      }
      // Light from the north-west: slopes facing it are brighter.
      const h = map.vertexHeight(tx, tz);
      const shade = 1 + (h - map.vertexHeight(tx + 1, tz + 1)) * 0.12;
      const k = (tz * map.width + tx) * 4;
      img.data[k] = Math.min(255, c.r * 255 * shade);
      img.data[k + 1] = Math.min(255, c.g * 255 * shade);
      img.data[k + 2] = Math.min(255, c.b * 255 * shade);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
