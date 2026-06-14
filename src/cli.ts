#!/usr/bin/env node

/**
 * mer2excal — Mermaid → Excalidraw CLI
 *
 * Converts Mermaid diagrams to Excaildraw format (.excalidraw or .excalidraw.md)
 *
 * Usage:
 *   mer2excal <input.mmd>                      Output .excalidraw
 *   mer2excal <input.mmd> --md                 Output .excalidraw.md (Obsidian)
 *   cat diagram.mmd | mer2excal                Read from stdin
 *   mer2excal -d "graph TD; A-->B"             Inline definition
 *   mer2excal --font-family 2 --font-size 24   Custom fonts
 */

// ---- Polyfill browser APIs with jsdom BEFORE loading mermaid ----
import { execSync } from "child_process";
import { getDefaultFontBuffer } from "./defaultFont.js";
import * as os from "os";
import { JSDOM } from "jsdom";
// Font embedding removed - using system font 平方萌萌哒

function setupBrowserEnvironment(): void {
  const dom = new JSDOM("<!DOCTYPE html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });

  const win = dom.window as any;
  const doc = dom.window.document;

  // Core DOM globals
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.navigator = win.navigator;
  globalThis.Node = win.Node;
  globalThis.Element = win.Element;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.HTMLDivElement = win.HTMLDivElement;
  globalThis.SVGElement = win.SVGElement;
  globalThis.SVGSVGElement = win.SVGSVGElement;
  globalThis.Text = win.Text;
  globalThis.Comment = win.Comment;
  globalThis.DocumentFragment = win.DocumentFragment;
  globalThis.DOMParser = win.DOMParser;
  globalThis.XMLSerializer = win.XMLSerializer;
  globalThis.DOMRect = win.DOMRect;
  globalThis.CustomEvent = win.CustomEvent;
  globalThis.Event = win.Event;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.KeyboardEvent = win.KeyboardEvent;

  // FontFace polyfill for @excalidraw/utils
  // Load real font data for PingFangMengMeng
  const fontFaces: any[] = [];
  if (typeof globalThis.FontFace === "undefined") {
    globalThis.FontFace = class FontFace {
      family: string;
      source: string;
      descriptors: any;
      status: string = "loaded";
      loaded: Promise<any>;
      unicodeRange: string = "U+0-10FFFF";
      _fontData: ArrayBuffer | null = null;
      constructor(family: string, source: string, descriptors?: any) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
        if (descriptors?.unicodeRange) {
          this.unicodeRange = descriptors.unicodeRange;
        }
        this.loaded = this._loadFont();
      }
      async _loadFont(): Promise<FontFace> {
        // Try to load Excalifont font data
        if (this.family === "平方萌萌哒" && !this._fontData) {
          try {
            const fontPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "font", "PingFangMengMeng-2.ttf");
            if (fs.existsSync(fontPath)) {
              const fontBuffer = fs.readFileSync(fontPath);
              this._fontData = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
            }
          } catch (e) {
            // Font loading failed, continue without font data
          }
        }
        return this;
      }
      load(): Promise<FontFace> { return this.loaded; }
    } as any;
  }

  // document.fonts polyfill
  if (typeof document !== "undefined" && !(document as any).fonts) {
    (document as any).fonts = {
      add: (fontFace: any) => { fontFaces.push(fontFace); },
      check: () => true,
      load: () => Promise.resolve(fontFaces),
      ready: Promise.resolve(fontFaces),
      forEach: (cb: any) => { fontFaces.forEach(cb); },
      [Symbol.iterator]: () => fontFaces[Symbol.iterator](),
    };
  }

  // SVG methods jsdom doesn't implement — needed by mermaid
  if (typeof SVGElement !== "undefined") {
    if (!(SVGElement.prototype as any).getBBox) {
      (SVGElement.prototype as any).getBBox = function () {
        const tag = this.tagName?.toLowerCase();
        const attr = (n: string) => parseFloat(this.getAttribute?.(n) || "");
        if (["rect", "image"].includes(tag)) {
          return { x: attr("x"), y: attr("y"), width: attr("width") || 100, height: attr("height") || 50 };
        }
        if (tag === "foreignobject") {
          const w = attr("width"); const h = attr("height");
          if (w && h) return { x: attr("x"), y: attr("y"), width: w, height: h };
          // Try to estimate size from HTML content inside foreignObject
          const div = this.querySelector?.("div, span, p");
          if (div) {
            const text = div.textContent || "";
            const lines = text.split("\n").length || 1;
            const estW = Math.max(text.length * 8, 40);
            const estH = Math.max(lines * 20, 20);
            return { x: attr("x"), y: attr("y"), width: estW, height: estH };
          }
          return { x: attr("x"), y: attr("y"), width: 0, height: 0 };
        }
        if (tag === "circle") {
          const r = attr("r") || 50; const cx = attr("cx") || 50; const cy = attr("cy") || 50;
          return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
        }
        if (tag === "ellipse") {
          const rx = attr("rx") || 50; const ry = attr("ry") || 50; const cx = attr("cx") || 50; const cy = attr("cy") || 50;
          return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
        }
        if (tag === "line") {
          return {
            x: Math.min(attr("x1"), attr("x2")),
            y: Math.min(attr("y1"), attr("y2")),
            width: Math.abs(attr("x2") - attr("x1")) || 100,
            height: Math.abs(attr("y2") - attr("y1")) || 50,
          };
        }
        if (tag === "text" || tag === "tspan") {
          return { x: attr("x"), y: attr("y"), width: Math.max((this.textContent ?? "").length * 8, 1), height: 16 };
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const child of this.children || []) {
          if (child instanceof SVGElement) {
            const b = (child as any).getBBox();
            if (b.width || b.height) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height); }
          }
        }
        if (Number.isFinite(minX)) return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        return { x: 0, y: 0, width: 0, height: 0 };
      };
    }
    if (!(SVGElement.prototype as any).getBoundingClientRect) {
      (SVGElement.prototype as any).getBoundingClientRect = function () {
        const bbox = this.getBBox();
        const w = bbox.width || parseFloat(this.getAttribute?.("width") || "100");
        const h = bbox.height || parseFloat(this.getAttribute?.("height") || "50");
        return { x: bbox.x || 0, y: bbox.y || 0, width: w, height: h, top: bbox.y || 0, right: (bbox.x || 0) + w, bottom: (bbox.y || 0) + h, left: bbox.x || 0, toJSON() { return { x: bbox.x || 0, y: bbox.y || 0, width: w, height: h }; } };
      };
    }
    if (!(SVGElement.prototype as any).getComputedTextLength) {
      (SVGElement.prototype as any).getComputedTextLength = function () {
        return Math.max((this.textContent ?? "").length * 8, 1);
      };
    }
    if (!(SVGElement.prototype as any).getStartPositionOfChar) {
      (SVGElement.prototype as any).getStartPositionOfChar = function () { return { x: 0, y: 0 }; };
    }
    if (!(SVGElement.prototype as any).getEndPositionOfChar) {
      (SVGElement.prototype as any).getEndPositionOfChar = function () { return { x: 0, y: 0 }; };
    }
  }

  // RAF / CAF
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as any) as typeof globalThis.requestAnimationFrame;
  }
  if (typeof globalThis.cancelAnimationFrame === "undefined") {
    globalThis.cancelAnimationFrame = clearTimeout as any as typeof globalThis.cancelAnimationFrame;
  }

  // matchMedia
  if (typeof win.matchMedia === "undefined") {
    win.matchMedia = () => ({
      matches: false, media: "", onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // ResizeObserver
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  // CSSStyleSheet — mermaid uses it for CSS rule management
  if (typeof globalThis.CSSStyleSheet === "undefined") {
    function makeCSSRuleList(rules: string[]) {
      return {
        get length() { return rules.length; },
        item(i: number) { return rules[i] ?? null; },
        [Symbol.iterator]() { return rules[Symbol.iterator](); },
      };
    }
    (globalThis as any).CSSStyleSheet = class CSSStyleSheet {
      _rules: string[] = [];
      get cssRules() {
        return makeCSSRuleList(this._rules);
      }
      insertRule(rule: string, index?: number) {
        this._rules.splice(index ?? this._rules.length, 0, rule);
        return index ?? this._rules.length - 1;
      }
      deleteRule(index: number) { this._rules.splice(index, 1); }
    };
  }

  // document.fonts
  if (!doc.fonts) {
    Object.defineProperty(doc, "fonts", {
      value: {
        ready: Promise.resolve(new Set()),
        add: () => {}, remove: () => {}, clear: () => {},
        load: () => Promise.resolve([]), check: () => true,
        forEach: () => {}, has: () => true, size: 0,
      },
      configurable: true,
    });
  }

  // Image constructor
  if (typeof (globalThis as any).Image === "undefined") {
    (globalThis as any).Image = class Image {
      width = 0; height = 0; src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(width?: number, height?: number) {
        this.width = width ?? 0;
        this.height = height ?? 0;
        setTimeout(() => this.onload?.(), 0);
      }
    };
  }

  // Additional globals from jsdom window
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.devicePixelRatio = win.devicePixelRatio;
  if (typeof win.requestAnimationFrame !== "undefined") {
    globalThis.requestAnimationFrame = win.requestAnimationFrame;
  }
  if (typeof win.cancelAnimationFrame !== "undefined") {
    globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  }
  if (typeof win.devicePixelRatio === "undefined") {
    win.devicePixelRatio = 1;
  }
}

// ---- CLI logic ----

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ── Types ──────────────────────────────────────────────

type OutputFormat = "excalidraw" | "excalidraw-md" | "png" | "svg";

type ExcalidrawFontFamily = number | string; // 1/2/3 or local font name

interface CliOptions {
  inputFile?: string;
  outputFile?: string;
  inline?: string;
  fontSize: number;
  fontFamily: ExcalidrawFontFamily;
  format: OutputFormat;
  fontPath?: string;
  pretty: boolean;
  help: boolean;
  showVersion: boolean;
}

// ── Excalidraw element normalisation ───────────────────
// Obsidian Excalidraw plugin expects every element to carry all properties,
// including strokeColor, backgroundColor, roughness, seed, versionNonce, etc.
// The @excalidraw/mermaid-to-excalidraw library returns "skeleton" elements
// that are missing many of these — so we fill in defaults here.

const DEFAULT_APP_STATE = {
  viewBackgroundColor: "#ffffff",
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 1,
  currentItemOpacity: 100,
  currentItemFontFamily: 1,
  currentItemFontSize: 20,
  currentItemTextAlign: "left",
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: "arrow",
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  currentItemRoundness: "round",
  gridSize: null,
  gridColor: { Bold: "#C9C9C9FF", Regular: "#EDEDEDFF" },
  currentStrokeOptions: null,
  previousGridSize: null,
  frameRendering: { enabled: true, clip: true, name: true, outline: true },
};

let _seedCounter = Date.now() % 1000000;

function nextSeed(): number {
  _seedCounter = (_seedCounter + 1) % 1000000;
  return _seedCounter;
}

/**
 * Convert HTML <br> to newline, strip other simple HTML tags.
 */
function sanitizeLabelText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    // Strip Markdown: **bold**, *italic*, __bold__, _italic_, ~~strikethrough~~, `code`
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    // Strip link syntax: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * Estimate pixel width of a text line (rough approximation).
 */
function estimateTextWidth(text: string, fontSize: number): number {
  // CJK chars are roughly 1em wide, Latin ~0.6em
  let w = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) w += 1.0; // CJK / emoji
    else w += 0.6;
  }
  return w * fontSize;
}

/**
 * Normalise a single Excalidraw element skeleton to the full format
 * that the Obsidian Excalidraw plugin (and excalidraw.com) expect.
 *
 * NOTE: The library's "label" property is internal format, NOT the
 * standard Excalidraw bound-text format.  We strip it here and create
 * standalone text elements in normalizeElements() instead.
 */
function normalizeElement(el: any, _fontFamily: ExcalidrawFontFamily): any {
  const out: any = {
    // Copy props but EXCLUDE label (library-internal, not Excalidraw)
    id: el.id,
    type: el.type,
    x: el.x ?? 0,
    y: el.y ?? 0,
    width: el.width ?? 0,
    height: el.height ?? 0,

    // Mandatory defaults
    angle: 0,
    strokeColor: el.strokeColor ?? "#1e1e1e",
    backgroundColor: el.backgroundColor ?? "transparent",
    fillStyle: el.fillStyle ?? "solid",
    strokeStyle: el.strokeStyle ?? "solid",
    strokeWidth: el.strokeWidth ?? 2,
    roughness: 1,
    opacity: 100,
    groupIds: el.groupIds ?? [],
    frameId: null,
    roundness: el.roundness ?? null,
    seed: nextSeed(),
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: el.link ?? null,
    locked: false,
  };

  // Arrow / line specific
  if (out.type === "arrow" || out.type === "line") {
    out.points = el.points ?? [[0, 0], [0, 0]];
    out.lastCommittedPoint = null;
    out.start = el.start ?? null;
    out.end = el.end ?? null;
    out.startBinding = el.start ? { elementId: el.start.id, focus: 0, gap: 0 } : null;
    out.endBinding = el.end ? { elementId: el.end.id, focus: 0, gap: 0 } : null;
    out.startArrowhead = el.startArrowhead ?? null;
    out.endArrowhead = el.endArrowhead ?? (out.type === "arrow" ? "arrow" : null);
  }

  // Image specific
  if (out.type === "image") {
    out.status = "saved";
    out.scale = [1, 1];
  }

  return out;
}

/**
 * Normalise all elements, converting the library's inline labels into
 * standalone Excalidraw text elements bound to their containers.
 *
 * This matches the approach in the Obsidian plugin (main.ts): the
 * container does NOT keep a "label" prop; text goes to a separate
 * element positioned at the container's centre.
 */
function normalizeElements(
  elements: any[],
  fontFamily: ExcalidrawFontFamily,
): any[] {
  const normalized: any[] = [];
  for (const el of elements) {
    // 1. Normalise the container/arrow element itself
    const n = normalizeElement(el, fontFamily);
    normalized.push(n);

    // 2. If element has an inline label, create a bound text element
    if (el.label?.text) {
      const text = sanitizeLabelText(el.label.text);
      const fontSize = el.label.fontSize ?? 16;

      // Find the longest line to estimate width
      const lines = text.split("\n");
      const maxLineWidth = Math.max(...lines.map((l: string) => estimateTextWidth(l, fontSize)));
      const lineCount = lines.length;
      const textHeight = fontSize * lineCount * 1.25;

      // Expand container to contain its text (width capped, height
      // always enough to show every line).  Keeping top‑left fixed
      // minimises disruption to arrows.
      const CONTAINER_PAD = 14;
      const MAX_WIDTH = 500;
      const neededW = Math.min(Math.max(n.width, maxLineWidth + CONTAINER_PAD * 2), MAX_WIDTH);
      const neededH = Math.max(n.height, textHeight + CONTAINER_PAD * 2);
      n.width = neededW;
      n.height = neededH;

      // Check if this is a subgraph element
      const isSubgraph = el.groupIds?.some((gid: string) => {
        const m = gid.match(/^subgraph_group_(.+)$/);
        return m && m[1] === el.id;
      }) ?? false;

      // Position text: top-aligned for subgraphs, centered for others
      const cx = n.x + n.width / 2;
      let cy: number;
      let verticalAlign: string;
      
      if (isSubgraph) {
        // Top-align with small padding
        const TOP_PADDING = 8;
        cy = n.y + TOP_PADDING + textHeight / 2;
        verticalAlign = "top";
      } else {
        // Center-align
        cy = n.y + n.height / 2;
        verticalAlign = "middle";
      }

      const txt: any = {
        id: `${el.id}_text`,
        type: "text",
        x: cx - maxLineWidth / 2,
        y: cy - textHeight / 2,
        width: maxLineWidth,
        height: textHeight,
        angle: 0,
        strokeColor: el.label.strokeColor ?? "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: el.groupIds ?? [],
        frameId: null,
        roundness: null,
        seed: nextSeed(),
        versionNonce: nextSeed(),
        isDeleted: false,
        boundElements: [],
        updated: 1,
        link: null,
        locked: false,
        text,
        fontSize,
        fontFamily: el.label.fontFamily ?? 5,
        textAlign: "center",
        verticalAlign,
        baseline: 13,
        containerId: el.id,
        originalText: text,
        lineHeight: 1.25,
      };
      normalized.push(txt);

      // Link container → text via boundElements
      n.boundElements.push({ type: "text", id: txt.id });
    }
  }

  return normalized;
}

// ── ELK‑style layered graph layout ─────────────────────
// Replaces manual overlap resolution.  The algorithm:
// 1. Parses the Mermaid direction (LR / TD / etc.) to decide layout axis.
// 2. Builds a directed graph (containers = nodes, arrows = edges).
// 3. Assigns layers via topological sort (BFS from source nodes).
// 4. Positions nodes layer‑by‑layer with configurable spacing.
// 5. Snaps arrow endpoints to element edges using line‑intersection.

function parseMermaidDirection(def: string): "RIGHT" | "LEFT" | "DOWN" | "UP" {
  const m = def.match(/flowchart\s+(LR|RL|TD|TB|BT)/i);
  if (!m) return "RIGHT"; // default for flowcharts
  switch (m[1].toUpperCase()) {
    case "LR": return "RIGHT";
    case "RL": return "LEFT";
    case "TD":
    case "TB": return "DOWN";
    case "BT": return "UP";
    default: return "RIGHT";
  }
}

/** Intersection of line segment [pOut, pIn] with the padded rect of `el`. */
function intersectElementWithLine(
  el: { x: number; y: number; width: number; height: number },
  pOut: [number, number],
  pIn: [number, number],
  gap: number,
): [number, number] | null {
  const left = el.x - gap;
  const top = el.y - gap;
  const right = el.x + el.width + gap;
  const bottom = el.y + el.height + gap;
  const dx = pIn[0] - pOut[0];
  const dy = pIn[1] - pOut[1];

  const candidates: { x: number; y: number; t: number }[] = [];

  const add = (x: number, y: number, rt: number) => {
    if (rt >= 0 && rt <= 1 && x >= left - 0.5 && x <= right + 0.5 && y >= top - 0.5 && y <= bottom + 0.5) {
      candidates.push({ x, y, t: rt });
    }
  };

  if (dx !== 0) {
    let rt = (left - pOut[0]) / dx;
    add(left, pOut[1] + rt * dy, rt);
    rt = (right - pOut[0]) / dx;
    add(right, pOut[1] + rt * dy, rt);
  }
  if (dy !== 0) {
    let rt = (top - pOut[1]) / dy;
    add(pOut[0] + rt * dx, top, rt);
    rt = (bottom - pOut[1]) / dy;
    add(pOut[0] + rt * dx, bottom, rt);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t - b.t);
  return [candidates[0].x, candidates[0].y];
}

function parseSubgraphDirection(sgId: string, definition: string): "RIGHT" | "LEFT" | "DOWN" | "UP" {
  // Find the subgraph block and look for a direction statement inside it
  const escaped = sgId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sgRegex = new RegExp(`subgraph\\s+${escaped}[\\s\\S]*?end`, "i");
  const sgBlock = definition.match(sgRegex);
  if (sgBlock) {
    const dirMatch = sgBlock[0].match(/direction\s+(LR|RL|TD|TB|BT)/i);
    if (dirMatch) {
      switch (dirMatch[1].toUpperCase()) {
        case "LR": return "RIGHT";
        case "RL": return "LEFT";
        case "TD": case "TB": return "DOWN";
        case "BT": return "UP";
      }
    }
  }
  // Default: inherit main direction or RIGHT
  try { return parseMermaidDirection(definition); } catch { return "RIGHT"; }
}

/**
 * Layout a group of nodes (e.g. children within a subgraph) using
 * a simple layered approach.  Nodes are positioned in‑place.
 */
function layoutNodeGroup(
  nodes: any[],
  edges: any[],
  direction: "RIGHT" | "LEFT" | "DOWN" | "UP",
  nodeSpacing: number,
  layerGap: number,
  originPad: number,
): void {
  if (nodes.length === 0) return;

  const isHorizontal = direction === "RIGHT" || direction === "LEFT";

  // Build adjacency
  const nodeIdSet = new Set(nodes.map((n: any) => n.id));
  const outAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) { outAdj.set(n.id, []); inDeg.set(n.id, 0); }
  for (const e of edges) {
    if (!nodeIdSet.has(e.start?.id) || !nodeIdSet.has(e.end?.id)) continue;
    outAdj.get(e.start.id)!.push(e.end.id);
    inDeg.set(e.end.id, (inDeg.get(e.end.id) ?? 0) + 1);
  }

  // Topological BFS → layer assignment
  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) { layerOf.set(id, 0); queue.push(id); }
  }
  if (queue.length === 0) { layerOf.set(nodes[0].id, 0); queue.push(nodes[0].id); }

  const procCount = new Map<string, number>();
  const maxProc = nodes.length + 1;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const c = (procCount.get(id) ?? 0) + 1;
    procCount.set(id, c);
    if (c > maxProc) continue;
    for (const tid of outAdj.get(id) ?? []) {
      const nl = (layerOf.get(id) ?? 0) + 1;
      if (!layerOf.has(tid) || (layerOf.get(tid) ?? 0) < nl) {
        layerOf.set(tid, nl);
        if (!queue.includes(tid)) queue.push(tid);
      }
    }
  }
  for (const n of nodes) { if (!layerOf.has(n.id)) layerOf.set(n.id, 0); }

  const maxLayer = Math.max(...layerOf.values(), 0);
  const layers: any[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) layers[layerOf.get(n.id) ?? 0].push(n);

  // Sort within each layer by original secondary‑axis position
  for (const layer of layers) {
    layer.sort((a: any, b: any) => (isHorizontal ? (a.y ?? 0) - (b.y ?? 0) : (a.x ?? 0) - (b.x ?? 0)));
  }

  // Position nodes layer by layer
  let primaryPos = 0;
  for (const layer of layers) {
    const secDims = layer.map((n: any) => (isHorizontal ? n.height : n.width));
    const totalSec = secDims.reduce((s: number, d: number) => s + d, 0) + nodeSpacing * Math.max(layer.length - 1, 0);
    let secPos = -totalSec / 2;

    for (const node of layer) {
      const d = isHorizontal ? node.height : node.width;
      if (isHorizontal) { node.y = secPos; } else { node.x = secPos; }
      secPos += d + nodeSpacing;
    }
    for (const node of layer) {
      if (isHorizontal) { node.x = primaryPos; } else { node.y = primaryPos; }
    }
    const maxPri = Math.max(...layer.map((n: any) => (isHorizontal ? n.width : n.height)), 0);
    primaryPos += maxPri + layerGap;
  }

  // Shift so that the minimum x,y starts at originPad
  let minX = Infinity, minY = Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
  const offX = originPad - minX;
  const offY = originPad - minY;
  for (const n of nodes) { n.x += offX; n.y += offY; }
}

function layeredLayout(elements: any[], definition: string): void {
  // ── Spacing constants ──
  const INNER_NODE_SPACING = 60;   // Between nodes within a subgraph (secondary axis)
  const INNER_LAYER_GAP = 80;      // Between layers within a subgraph (primary axis)
  const SUBGRAPH_PADDING = 35;     // Padding inside subgraph rectangles
  const HIGH_LEVEL_SPACING = 120;  // Between high‑level units on secondary axis
  const HIGH_LEVEL_GAP = 120;      // Between high‑level layers on primary axis
  const FLAT_NODE_SPACING = 80;    // For flat (no‑subgraph) diagrams
  const FLAT_LAYER_GAP = 100;

  const mainDir = parseMermaidDirection(definition);
  const mainIsH = mainDir === "RIGHT" || mainDir === "LEFT";

  const byId = new Map<string, any>();
  for (const el of elements) byId.set(el.id, el);

  // ── 0. Identify subgraph rectangles ──
  const subgraphIds = new Set<string>();
  const subgraphChildren = new Map<string, string[]>();
  for (const el of elements) {
    if (el.type === "rectangle" && el.groupIds?.length > 0) {
      for (const gid of el.groupIds) {
        const m = gid.match(/^subgraph_group_(.+)$/);
        if (m && m[1] === el.id) { subgraphIds.add(el.id); break; }
      }
    }
  }
  for (const el of elements) {
    if (el.type === "rectangle" && !subgraphIds.has(el.id) && el.groupIds?.length > 0) {
      for (const gid of el.groupIds) {
        const m = gid.match(/^subgraph_group_(.+)$/);
        if (m) {
          const sgId = m[1];
          if (subgraphIds.has(sgId)) {
            if (!subgraphChildren.has(sgId)) subgraphChildren.set(sgId, []);
            subgraphChildren.get(sgId)!.push(el.id);
            break;
          }
        }
      }
    }
  }

  // ── Collect all content nodes and edges ──
  const allContentNodes = elements.filter(
    (el) => el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId) && !subgraphIds.has(el.id),
  );
  const allEdges = elements.filter(
    (el) => (el.type === "arrow" || el.type === "line") && el.start?.id && el.end?.id,
  );

  // Map each content node → its parent subgraph (if any)
  const nodeToSg = new Map<string, string>();
  for (const [sgId, childIds] of subgraphChildren) {
    for (const cid of childIds) nodeToSg.set(cid, sgId);
  }

  const hasSubgraphs = subgraphIds.size > 0;

  if (!hasSubgraphs) {
    // ── FLAT LAYOUT (no subgraphs) ──
    // Same algorithm as before: single‑level layered layout
    const nodes = allContentNodes;
    const outEdges = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const n of nodes) { outEdges.set(n.id, []); inDegree.set(n.id, 0); }
    for (const e of allEdges) {
      if (!outEdges.has(e.start.id)) outEdges.set(e.start.id, []);
      outEdges.get(e.start.id)!.push(e.end.id);
      inDegree.set(e.end.id, (inDegree.get(e.end.id) ?? 0) + 1);
    }
    const layerOf = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) { layerOf.set(id, 0); queue.push(id); }
    }
    if (queue.length === 0 && nodes.length > 0) {
      layerOf.set(nodes[0].id, 0); queue.push(nodes[0].id);
    }
    const processCount = new Map<string, number>();
    const maxProcessPerNode = nodes.length + 1;
    while (queue.length > 0) {
      const id = queue.shift()!;
      const count = (processCount.get(id) ?? 0) + 1;
      processCount.set(id, count);
      if (count > maxProcessPerNode) continue;
      for (const tid of outEdges.get(id) ?? []) {
        const nl = (layerOf.get(id) ?? 0) + 1;
        if (!layerOf.has(tid) || (layerOf.get(tid) ?? 0) < nl) {
          layerOf.set(tid, nl);
          if (!queue.includes(tid)) queue.push(tid);
        }
      }
    }
    for (const n of nodes) { if (!layerOf.has(n.id)) layerOf.set(n.id, 0); }
    const maxLayer = Math.max(...layerOf.values(), 0);
    const layers: any[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const n of nodes) layers[layerOf.get(n.id) ?? 0].push(n);
    for (const layer of layers) layer.sort((a: any, b: any) => (a.y ?? 0) - (b.y ?? 0));

    let primaryPos = 0;
    for (const layer of layers) {
      const secDims = layer.map((n: any) => (mainIsH ? n.height : n.width));
      const totalSec = secDims.reduce((s: number, d: number) => s + d, 0) + FLAT_NODE_SPACING * (layer.length - 1);
      let secPos = -totalSec / 2;
      for (const node of layer) {
        const d = mainIsH ? node.height : node.width;
        if (mainIsH) { node.y = secPos; } else { node.x = secPos; }
        secPos += d + FLAT_NODE_SPACING;
      }
      for (const node of layer) {
        if (mainIsH) { node.x = primaryPos; } else { node.y = primaryPos; }
      }
      const maxPri = Math.max(...layer.map((n: any) => (mainIsH ? n.width : n.height)), 0);
      primaryPos += maxPri + FLAT_LAYER_GAP;
    }

    // Shift to (8,8)
    let minX = Infinity, minY = Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
    const offX = 8 - minX; const offY = 8 - minY;
    for (const n of nodes) { n.x += offX; n.y += offY; }
  } else {
    // ── HIERARCHICAL LAYOUT (with subgraphs) ──

    // ── Phase 1: Internal layout for each subgraph ──
    for (const [sgId, childIds] of subgraphChildren) {
      const children = childIds.map((id: string) => byId.get(id)).filter(Boolean);
      if (children.length === 0) continue;

      const sgDir = parseSubgraphDirection(sgId, definition);
      const childIdSet = new Set(childIds);
      const internalEdges = allEdges.filter(
        (e: any) => childIdSet.has(e.start?.id) && childIdSet.has(e.end?.id),
      );

      layoutNodeGroup(children, internalEdges, sgDir, INNER_NODE_SPACING, INNER_LAYER_GAP, SUBGRAPH_PADDING);
    }

    // ── Phase 2: Calculate subgraph bounding boxes ──
    const sgBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }>();
    for (const [sgId, childIds] of subgraphChildren) {
      const children = childIds.map((id: string) => byId.get(id)).filter(Boolean);
      if (children.length === 0) {
        sgBounds.set(sgId, { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 });
        continue;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of children) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + c.width);
        maxY = Math.max(maxY, c.y + c.height);
      }
      const LABEL_HEIGHT = 25;
      const w = (maxX - minX) + SUBGRAPH_PADDING * 2;
      const h = (maxY - minY) + SUBGRAPH_PADDING * 2 + LABEL_HEIGHT;
      sgBounds.set(sgId, { minX, minY, maxX, maxY, width: w, height: h });
    }

    // ── Phase 3: Build high‑level graph ──
    // High‑level units: each subgraph + each standalone node
    interface HighUnit {
      id: string;
      width: number;
      height: number;
      isSubgraph: boolean;
      sgId?: string;       // for subgraph units
      nodeId?: string;     // for standalone node units
    }
    const units: HighUnit[] = [];
    const unitById = new Map<string, HighUnit>();

    for (const sgId of subgraphIds) {
      const bounds = sgBounds.get(sgId);
      if (!bounds) continue;
      const u: HighUnit = { id: sgId, width: bounds.width, height: bounds.height, isSubgraph: true, sgId };
      units.push(u);
      unitById.set(sgId, u);
    }
    const standaloneNodes = allContentNodes.filter((n: any) => !nodeToSg.has(n.id));
    for (const n of standaloneNodes) {
      const u: HighUnit = { id: n.id, width: n.width, height: n.height, isSubgraph: false, nodeId: n.id };
      units.push(u);
      unitById.set(n.id, u);
    }

    // Map each content node to its high‑level unit
    const nodeToUnit = new Map<string, string>();
    for (const [sgId] of subgraphChildren) {
      const children = subgraphChildren.get(sgId) ?? [];
      for (const cid of children) nodeToUnit.set(cid, sgId);
    }
    for (const n of standaloneNodes) nodeToUnit.set(n.id, n.id);

    // Build high‑level edges
    const hlOutEdges = new Map<string, string[]>();
    const hlInDeg = new Map<string, number>();
    for (const u of units) { hlOutEdges.set(u.id, []); hlInDeg.set(u.id, 0); }

    const hlEdgeSet = new Set<string>(); // deduplicate
    for (const e of allEdges) {
      const srcUnit = nodeToUnit.get(e.start?.id);
      const tgtUnit = nodeToUnit.get(e.end?.id);
      if (!srcUnit || !tgtUnit || srcUnit === tgtUnit) continue;
      const key = `${srcUnit}->${tgtUnit}`;
      if (hlEdgeSet.has(key)) continue;
      hlEdgeSet.add(key);
      if (!hlOutEdges.has(srcUnit)) hlOutEdges.set(srcUnit, []);
      hlOutEdges.get(srcUnit)!.push(tgtUnit);
      hlInDeg.set(tgtUnit, (hlInDeg.get(tgtUnit) ?? 0) + 1);
    }

    // Topological BFS → high‑level layers
    const hlLayerOf = new Map<string, number>();
    const hlQueue: string[] = [];
    for (const [id, deg] of hlInDeg) {
      if (deg === 0) { hlLayerOf.set(id, 0); hlQueue.push(id); }
    }
    if (hlQueue.length === 0 && units.length > 0) {
      hlLayerOf.set(units[0].id, 0); hlQueue.push(units[0].id);
    }
    const hlProcCount = new Map<string, number>();
    const hlMaxProc = units.length + 1;
    while (hlQueue.length > 0) {
      const id = hlQueue.shift()!;
      const c = (hlProcCount.get(id) ?? 0) + 1;
      hlProcCount.set(id, c);
      if (c > hlMaxProc) continue;
      for (const tid of hlOutEdges.get(id) ?? []) {
        const nl = (hlLayerOf.get(id) ?? 0) + 1;
        if (!hlLayerOf.has(tid) || (hlLayerOf.get(tid) ?? 0) < nl) {
          hlLayerOf.set(tid, nl);
          if (!hlQueue.includes(tid)) hlQueue.push(tid);
        }
      }
    }
    for (const u of units) { if (!hlLayerOf.has(u.id)) hlLayerOf.set(u.id, 0); }

    const hlMaxLayer = Math.max(...hlLayerOf.values(), 0);
    const hlLayers: HighUnit[][] = Array.from({ length: hlMaxLayer + 1 }, () => []);
    for (const u of units) hlLayers[hlLayerOf.get(u.id) ?? 0].push(u);

    // Sort within each high‑level layer
    for (const layer of hlLayers) {
      layer.sort((a, b) => {
        // Sort by original position of the first child / node
        const aEl = a.isSubgraph ? byId.get(a.sgId!) : byId.get(a.nodeId!);
        const bEl = b.isSubgraph ? byId.get(b.sgId!) : byId.get(b.nodeId!);
        return mainIsH ? ((aEl?.y ?? 0) - (bEl?.y ?? 0)) : ((aEl?.x ?? 0) - (bEl?.x ?? 0));
      });
    }

    // Position high‑level units layer by layer
    let hlPrimaryPos = 0;
    const unitPositions = new Map<string, { x: number; y: number }>();

    for (const layer of hlLayers) {
      const secDims = layer.map((u) => mainIsH ? u.height : u.width);
      const totalSec = secDims.reduce((s, d) => s + d, 0) + HIGH_LEVEL_SPACING * Math.max(layer.length - 1, 0);
      let secPos = -totalSec / 2;

      for (const u of layer) {
        const d = mainIsH ? u.height : u.width;
        const pos = { x: 0, y: 0 };
        if (mainIsH) {
          pos.y = secPos;
          pos.x = hlPrimaryPos;
        } else {
          pos.x = secPos;
          pos.y = hlPrimaryPos;
        }
        unitPositions.set(u.id, pos);
        secPos += d + HIGH_LEVEL_SPACING;
      }

      const maxPri = Math.max(...layer.map((u) => mainIsH ? u.width : u.height), 0);
      hlPrimaryPos += maxPri + HIGH_LEVEL_GAP;
    }

    // ── Phase 4: Apply positions ──
    // For standalone nodes: set position directly
    for (const n of standaloneNodes) {
      const pos = unitPositions.get(n.id);
      if (pos) { n.x = pos.x; n.y = pos.y; }
    }

    // For subgraph children: shift from internal‑layout positions to absolute positions
    for (const [sgId, childIds] of subgraphChildren) {
      const pos = unitPositions.get(sgId);
      if (!pos) continue;
      const bounds = sgBounds.get(sgId);
      if (!bounds) continue;

      // The internal layout placed children starting at SUBGRAPH_PADDING offset.
      // The high‑level unit's top‑left is at `pos`.
      // Children's internal positions are relative to (0,0) with SUBGRAPH_PADDING offset.
      // We need to shift them so that the subgraph's top‑left is at `pos`.
      const shiftX = pos.x - 0; // internal layout starts at SUBGRAPH_PADDING, which maps to pos.x
      const shiftY = pos.y - 0;

      // But we need to account for the LABEL_HEIGHT at the top of the subgraph
      const LABEL_HEIGHT = 25;

      for (const cid of childIds) {
        const child = byId.get(cid);
        if (!child) continue;
        child.x = child.x + shiftX;
        child.y = child.y + shiftY + LABEL_HEIGHT;
      }
    }

    // Shift entire diagram to start near (8, 8)
    let globalMinX = Infinity, globalMinY = Infinity;
    for (const n of allContentNodes) {
      globalMinX = Math.min(globalMinX, n.x);
      globalMinY = Math.min(globalMinY, n.y);
    }
    const gOffX = 8 - globalMinX;
    const gOffY = 8 - globalMinY;
    for (const n of allContentNodes) { n.x += gOffX; n.y += gOffY; }

    // ── Phase 5: Position subgraph rectangles to wrap children ──
    for (const sgId of subgraphIds) {
      const sgEl = byId.get(sgId);
      if (!sgEl) continue;
      const childIds = subgraphChildren.get(sgId) ?? [];
      if (childIds.length === 0) continue;

      let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
      for (const cid of childIds) {
        const child = byId.get(cid);
        if (!child) continue;
        cMinX = Math.min(cMinX, child.x);
        cMinY = Math.min(cMinY, child.y);
        cMaxX = Math.max(cMaxX, child.x + child.width);
        cMaxY = Math.max(cMaxY, child.y + child.height);
      }

      const LABEL_HEIGHT = 25;
      sgEl.x = cMinX - SUBGRAPH_PADDING;
      sgEl.y = cMinY - SUBGRAPH_PADDING - LABEL_HEIGHT;
      sgEl.width = (cMaxX - cMinX) + SUBGRAPH_PADDING * 2;
      sgEl.height = (cMaxY - cMinY) + SUBGRAPH_PADDING * 2 + LABEL_HEIGHT;
    }
  }

  // ── 6. Sync text positions ──
  const allPositioned = elements.filter(
    (el) => el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId),
  );
  for (const node of allPositioned) {
    if (!node.boundElements) continue;
    for (const be of node.boundElements) {
      if (be.type === "text") {
        const te = byId.get(be.id);
        if (te) {
          te.x = node.x + node.width / 2 - te.width / 2;
          if (subgraphIds.has(node.id)) {
            const TOP_PADDING = 8;
            te.y = node.y + TOP_PADDING;
          } else {
            te.y = node.y + node.height / 2 - te.height / 2;
          }
        }
      }
    }
  }

  // ── 7. Normalise arrow endpoints ──
  const GAP = 2;
  for (const arrow of allEdges) {
    const startEl = byId.get(arrow.start?.id);
    const endEl = byId.get(arrow.end?.id);
    if (!startEl || !endEl) continue;

    const sCX = startEl.x + startEl.width / 2;
    const sCY = startEl.y + startEl.height / 2;
    const eCX = endEl.x + endEl.width / 2;
    const eCY = endEl.y + endEl.height / 2;

    const si = intersectElementWithLine(startEl, [eCX, eCY], [sCX, sCY], GAP);
    if (si) { arrow.x = si[0]; arrow.y = si[1]; }

    const ei = intersectElementWithLine(endEl, [arrow.x, arrow.y], [eCX, eCY], GAP);
    if (ei) {
      arrow.points = [[0, 0], [ei[0] - arrow.x, ei[1] - arrow.y]];
    } else {
      arrow.points = [[0, 0], [eCX - arrow.x, eCY - arrow.y]];
    }

    arrow.startBinding = { elementId: arrow.start.id, focus: 0, gap: GAP };
    arrow.endBinding = { elementId: arrow.end.id, focus: 0, gap: GAP };
  }

  // ── 8. Add bidirectional arrow bindings to containers ──
  for (const arrow of allEdges) {
    for (const endId of [arrow.start?.id, arrow.end?.id]) {
      if (!endId) continue;
      const el = byId.get(endId);
      if (el && !el.boundElements?.some((b: any) => b.id === arrow.id)) {
        el.boundElements.push({ type: "arrow", id: arrow.id });
      }
    }
  }
}


// ── Font handling for PNG/SVG export ────────────────────


// ── Browser detection for Playwright ────────────────────


// ── Browser headless screenshot ────────────────────

async function renderSvgToPngWithBrowser(svgString: string, outPath?: string): Promise<Buffer | void> {
  const detected = detectSystemBrowser();
  if (!detected) {
    console.error("Error: No supported browser found (Chrome, Edge, or Firefox).");
    console.error("Please install one of them to enable PNG export.");
    process.exit(1);
  }

  console.error(`Using ${detected === "chrome" ? "Chrome" : detected === "msedge" ? "Edge" : "Firefox"} for PNG rendering...`);

  // 从 SVG 中提取 viewBox 或 width/height
  let svgWidth = 1920;
  let svgHeight = 1080;
  
  const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/);
    if (parts.length === 4) {
      svgWidth = Math.ceil(parseFloat(parts[2]));
      svgHeight = Math.ceil(parseFloat(parts[3]));
    }
  } else {
    const widthMatch = svgString.match(/width="([^"]+)"/);
    const heightMatch = svgString.match(/height="([^"]+)"/);
    if (widthMatch) svgWidth = Math.ceil(parseFloat(widthMatch[1]));
    if (heightMatch) svgHeight = Math.ceil(parseFloat(heightMatch[1]));
  }
  
  // 添加一些边距
  svgWidth += 40;
  svgHeight += 40;

  // 创建临时 HTML 文件
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mer2excal-"));
  const tmpHtml = path.join(tmpDir, "diagram.html");
  const tmpPng = path.join(tmpDir, "output.png");

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 20px; padding: 0; background: white; }
    svg { display: block; }
  </style>
  <script>
    // 等待字体加载完成
    document.fonts.ready.then(() => {
      document.documentElement.classList.add('fonts-loaded');
    });
  </script>
</head>
<body>${svgString}</body>
</html>`;

  fs.writeFileSync(tmpHtml, htmlContent, "utf-8");

  try {
    // 获取浏览器可执行文件路径
    const browserPath = getBrowserPath(detected);
    if (!browserPath) {
      throw new Error(`Could not find ${detected} executable`);
    }

    // 构建命令
    let cmd: string;
    if (detected === "firefox") {
      // Firefox 的 headless 截图命令
      cmd = `"${browserPath}" --headless --window-size=${svgWidth},${svgHeight} --screenshot "${tmpPng}" "${tmpHtml}"`;
    } else {
      // Chrome/Edge 的 headless 截图命令（使用新 headless 模式）
      // 设置窗口大小以匹配 SVG 尺寸，添加 --run-all-compositor-stages-before-draw 确保字体渲染完成
      // 使用 --force-device-scale-factor=2 提高分辨率（2倍缩放）
      cmd = `"${browserPath}" --headless=new --disable-gpu --window-size=${svgWidth},${svgHeight} --force-device-scale-factor=2 --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --screenshot="${tmpPng}" "file://${tmpHtml}"`;
    }

    execSync(cmd, { stdio: "pipe", timeout: 30000 });

    // 读取生成的 PNG
    if (!fs.existsSync(tmpPng)) {
      throw new Error("Browser failed to generate PNG");
    }

    const pngBuffer = fs.readFileSync(tmpPng);

    if (outPath) {
      fs.writeFileSync(outPath, pngBuffer);
      console.error(`✓ Written to ${outPath}`);
    } else {
      return pngBuffer;
    }
  } finally {
    // 清理临时文件
    try {
      fs.unlinkSync(tmpHtml);
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

function getBrowserPath(browser: "chrome" | "msedge" | "firefox"): string | null {
  const platform = os.platform();
  
  const paths: Record<string, string[]> = {
    chrome: platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : platform === "win32"
      ? ["C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
    msedge: platform === "darwin"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : platform === "win32"
      ? ["C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe"]
      : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
    firefox: platform === "darwin"
      ? ["/Applications/Firefox.app/Contents/MacOS/firefox"]
      : platform === "win32"
      ? ["C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe"]
      : ["/usr/bin/firefox"],
  };

  for (const p of paths[browser] || []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}


// ── Default font path ────────────────────────────────────

function getDefaultFontPath(): string {
  // 字体已嵌入到代码中，返回特殊标记
  return "embedded";
}

function detectSystemBrowser(): "chrome" | "msedge" | "firefox" | null {
  const platform = os.platform();

  const browsers: Array<{ name: "chrome" | "msedge" | "firefox"; paths: string[] }> = [
    {
      name: "chrome",
      paths: platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
    },
    {
      name: "msedge",
      paths: platform === "darwin"
        ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : platform === "win32"
        ? [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
    },
    {
      name: "firefox",
      paths: platform === "darwin"
        ? ["/Applications/Firefox.app/Contents/MacOS/firefox"]
        : platform === "win32"
        ? [
            "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
            "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
          ]
        : ["/usr/bin/firefox"],
    },
  ];

  for (const browser of browsers) {
    for (const p of browser.paths) {
      if (fs.existsSync(p)) {
        return browser.name;
      }
    }
  }
  return null;
}


function isFontFile(fontPath: string): boolean {
  const ext = path.extname(fontPath).toLowerCase();
  return ['.ttf', '.otf', '.woff', '.woff2', '.ttc'].includes(ext);
}

function getFontFamilyName(fontPath: string): string {
  if (fontPath === "embedded") {
    // 嵌入的字体名称
    return "平方萌萌哒";
  }
  try {
    const result = execSync(`fc-scan --format '%{family[0]}\\n' "${fontPath}"`, { encoding: "utf-8", timeout: 5000 });
    const name = result.trim();
    if (name) return name;
  } catch {}
  return "CustomFont";
}



function handleFontInSvg(svgString: string, fontSpec?: string): string {
  // 情况 1: 未指定字体 → 使用系统回退 sans-serif
  if (!fontSpec) {
    return svgString;
  }
  
  // 情况 2: 指定了字体（文件或嵌入）→ 嵌入到 SVG
  if (fontSpec === "embedded" || isFontFile(fontSpec)) {
    let fontBase64: string;
    let absFontPath: string;
    
    if (fontSpec === "embedded") {
      // 使用嵌入的字体
      const fontBuffer = getDefaultFontBuffer();
      fontBase64 = Buffer.from(fontBuffer).toString('base64');
      absFontPath = "embedded";
    } else {
      // 使用外部字体文件
      absFontPath = path.resolve(fontSpec);
      if (!fs.existsSync(absFontPath)) {
        console.error(`Warning: Font file not found: ${absFontPath}`);
        return svgString;
      }
      const fontBuffer = fs.readFileSync(absFontPath);
      fontBase64 = fontBuffer.toString('base64');
    }
    
    try {
      
      // 确定字体格式
      const fontFormat = absFontPath === "embedded" ? 'truetype' :
                         absFontPath.endsWith('.woff2') ? 'woff2' : 
                         absFontPath.endsWith('.woff') ? 'woff' : 
                         absFontPath.endsWith('.otf') ? 'opentype' : 'truetype';
      
      // 确定 MIME 类型
      const mimeType = fontFormat === 'woff2' ? 'font/woff2' :
                       fontFormat === 'woff' ? 'font/woff' :
                       fontFormat === 'opentype' ? 'font/otf' : 'font/ttf';
      
      // 生成 data URL（只嵌入一次）
      const dataUrl = `data:${mimeType};base64,${fontBase64}`;
      
      // 获取真实字体名称
      const realFontName = getFontFamilyName(absFontPath);
      
      // 生成 @font-face 规则（使用真实字体名称）
      const fontFaceCss = `@font-face { font-family: "${realFontName}"; src: url("${dataUrl}") format("${fontFormat}"); }`;
      
      if (svgString.includes("<style")) {
        svgString = svgString.replace(/<style([^>]*)>/, `<style$1>${fontFaceCss}`);
      } else if (svgString.includes("</svg>")) {
        svgString = svgString.replace("</svg>", `<defs><style>${fontFaceCss}</style></defs></svg>`);
      }
    } catch (e) {
      console.error('Warning: Failed to embed font');
    }
    return svgString;
  }
  
  // 情况 3: 指定了系统字体名 → 修改 font-family 属性
  svgString = svgString.replace(/font-family="sans-serif"/g, `font-family="${fontSpec}"`);
  return svgString;
}

// ── SVG generation (shared by PNG and SVG export) ────────────────────

async function generateSvgString(
  result: any,
  opts: CliOptions,
  definition: string,
  exportToSvg: any,
): Promise<string> {
  const excalidrawData = buildExcalidrawJson(result.elements, result.files, opts.fontFamily, definition);
  const svgElement = await exportToSvg({
    ...excalidrawData,
    skipInliningFonts: true,
  });
  let svgString = new XMLSerializer().serializeToString(svgElement);
  
  // 修复重复的 xmlns 属性
  const xmlnsMatches = svgString.match(/xmlns="[^"]*"/g);
  if (xmlnsMatches && xmlnsMatches.length > 1) {
    const seen = new Set<string>();
    svgString = svgString.replace(/xmlns="[^"]*"/g, (match) => {
      if (seen.has(match)) return "";
      seen.add(match);
      return match;
    });
  }
  
  // 统一字体名称
  let fontFamilyValue: string;
  if (!opts.fontPath) {
    fontFamilyValue = 'sans-serif';
  } else if (opts.fontPath === "embedded" || isFontFile(opts.fontPath)) {
    const realFamily = getFontFamilyName(opts.fontPath);
    fontFamilyValue = `${realFamily}, sans-serif`;
  } else {
    fontFamilyValue = opts.fontPath;
  }
  svgString = svgString.replace(/font-family="[^"]*"/g, `font-family="${fontFamilyValue}"`);
  
  // 处理字体（嵌入或引用）
  svgString = handleFontInSvg(svgString, opts.fontPath);
  
  return svgString;
}

// ── Output builders ───────────────────────────────────

function buildExcalidrawJson(
  elements: any[],
  files: any,
  fontFamily: ExcalidrawFontFamily,
  definition: string,
) {
  const normalized = normalizeElements(elements, fontFamily);
  layeredLayout(normalized, definition);
  return {
    type: "excalidraw",
    version: 2,
    source: "mer2excal",
    elements: normalized,
    files: files ?? {},
    appState: {
      ...DEFAULT_APP_STATE,
      currentItemFontFamily: typeof fontFamily === "number" ? fontFamily : 5,
    },
  };
}

function buildExcalidrawMdContent(
  elements: any[],
  files: any,
  fontFamily: ExcalidrawFontFamily,
  pretty: boolean,
  definition: string,
): string {
  const json = buildExcalidrawJson(elements, files, fontFamily, definition);
  const jsonStr = pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
  return `---
excalidraw-plugin: raw
tags: [excalidraw]
---

==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

## Drawing
\`\`\`json
${jsonStr}
\`\`\`
%%`;
}

// ── CLI helpers ───────────────────────────────────────

function printHelp(): void {
  console.log(`
mer2excal — Convert Mermaid diagrams to Excalidraw format

Usage:
  mer2excal [input] [options]

Arguments:
  input.mmd / input.md        Mermaid file (.mmd) or Markdown file (.md)

Options:
  -o, --output <file>        Write output to file
  -d, --definition <str>     Inline Mermaid definition
  -t, --format <type>        Output format: excalidraw (default) | excalidraw-md | png | svg
  --font <path>              Font file path for SVG/PNG export (e.g., font/MyFont.ttf)
  --md                       Shortcut for --format excalidraw-md
  -f, --font-size <n>        Font size in px (default: 20)
  --font-family <id|name>    Font: 1=Virgil, 2=Helvetica, 3=Cascadia, or local name
  -p, --pretty               Pretty-print JSON
  -v, --version              Show version
  -h, --help                 Show this help

Output formats:
  excalidraw       .excalidraw — pure JSON, open in excalidraw.com
  excalidraw-md    .excalidraw.md — for Obsidian Excalidraw plugin

Examples:
  mer2excal diagram.mmd                 → diagram.excalidraw
  mer2excal diagram.mmd --md            → diagram.excalidraw.md
  mer2excal diagram.mmd --font-family 2 → Helvetica font
  mer2excal -d "graph TD; A-->B" --md -p  → inline + Obsidian + pretty

Markdown:
  mer2excal doc.md                      → doc/001.excalidraw, doc/002.excalidraw, ...
`);
}

function parseArgs(): CliOptions {
  const argv = process.argv;
  const opts: CliOptions = {
    fontSize: 20,
    fontFamily: 5,
    format: "excalidraw",
    pretty: false,
    help: false,
    showVersion: false,
  };
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h": case "--help": opts.help = true; break;
      case "-v": case "--version": opts.showVersion = true; break;
      case "-p": case "--pretty": opts.pretty = true; break;
      case "--md": opts.format = "excalidraw-md"; break;
      case "--png": opts.format = "png"; break;
      case "--svg": opts.format = "svg"; break;
      case "--font": opts.fontPath = argv[++i]; break;
      case "-t": case "--format": {
        const val = argv[++i];
        if (val === "md" || val === "excalidraw-md") opts.format = "excalidraw-md";
        else if (val === "excalidraw") opts.format = "excalidraw";
        else if (val === "png") opts.format = "png";
        else if (val === "svg") opts.format = "svg";
        else { console.error(`Unknown format: ${val}`); process.exit(1); }
        break;
      }
      case "-o": case "--output": opts.outputFile = argv[++i]; break;
      case "-d": case "--definition": opts.inline = argv[++i]; break;
      case "-f": case "--font-size": opts.fontSize = parseInt(argv[++i], 10) || 20; break;
      case "--font-family": {
        const raw = argv[++i];
        const n = parseInt(raw, 10);
        opts.fontFamily = isNaN(n) ? raw : n;
        break;
      }
      default:
        if (arg.startsWith("-")) { console.error(`Unknown option: ${arg}`); process.exit(1); }
        positional.push(arg);
    }
  }

  if (positional.length > 0) opts.inputFile = positional[0];
  return opts;
}

async function readInput(opts: CliOptions): Promise<string> {
  if (opts.inline) return opts.inline;
  if (opts.inputFile) return fs.readFileSync(opts.inputFile, "utf-8");
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }
  console.error("No input provided. Pipe a diagram or use -d/--definition.");
  process.exit(1);
}

function guessOutputPath(inputFile?: string, format?: OutputFormat): string | undefined {
  if (!inputFile) return undefined;
  const p = path.parse(inputFile);
  let ext = ".excalidraw";
  if (format === "excalidraw-md") ext = ".excalidraw.md";
  else if (format === "png") ext = ".png";
  else if (format === "svg") ext = ".svg";
  return path.join(p.dir, `${p.name}${ext}`);
}

// ── Markdown support ──────────────────────────────────

function isMarkdownFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

function extractMermaidBlocks(content: string): string[] {
  const blocks: string[] = [];
  // Match ```mermaid ... ``` blocks (lazy match between delimiters)
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

async function convertSingleDiagram(
  definition: string,
  parseMermaidToExcalidraw: any,
  exportToSvg: any,
  opts: CliOptions,
  outPath?: string,
): Promise<void> {
  const result = await parseMermaidToExcalidraw(definition, {
    themeVariables: { fontSize: `${opts.fontSize}px` },
  });

  if (opts.format === "png") {
    // 复用 SVG 生成逻辑
    const svgString = await generateSvgString(result, opts, definition, exportToSvg);
    
    // 使用 Playwright 渲染 SVG 为 PNG（支持 @font-face）
    const pngBuffer = await renderSvgToPngWithBrowser(svgString, outPath);
    if (!outPath && pngBuffer) {
      process.stdout.write(pngBuffer);
    }
    return;
  }

  if (opts.format === "svg") {
    // 复用 SVG 生成逻辑
    const svgString = await generateSvgString(result, opts, definition, exportToSvg);
    
    if (outPath) {
      fs.writeFileSync(outPath, svgString, "utf-8");
      console.error(`✓ Written to ${outPath}`);
    } else {
      console.log(svgString);
    }
    return;
  }

  if (opts.format === "excalidraw-md") {
    const content = buildExcalidrawMdContent(result.elements, result.files, opts.fontFamily, opts.pretty, definition);
    if (outPath) {
      fs.writeFileSync(outPath, content, "utf-8");
      console.error(`✓ Written to ${outPath}`);
    } else {
      console.log(content);
    }
  } else {
    const json = buildExcalidrawJson(result.elements, result.files, opts.fontFamily, definition);
    const jsonStr = opts.pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
    if (outPath) {
      fs.writeFileSync(outPath, jsonStr, "utf-8");
      console.error(`✓ Written to ${outPath}`);
    } else {
      console.log(jsonStr);
    }
  }
}

async function convertMarkdownFile(
  inputFile: string,
  parseMermaidToExcalidraw: any,
  exportToSvg: any,
  opts: CliOptions,
): Promise<void> {
  const content = fs.readFileSync(inputFile, "utf-8");
  const blocks = extractMermaidBlocks(content);

  if (blocks.length === 0) {
    console.error("No mermaid code blocks found in markdown file.");
    process.exit(1);
  }

  const p = path.parse(inputFile);
  const outDir = path.join(p.dir, p.name);
  fs.mkdirSync(outDir, { recursive: true });

  const ext = opts.format === "png" ? ".png" : opts.format === "svg" ? ".svg" : ".excalidraw";
  for (let i = 0; i < blocks.length; i++) {
    const num = String(i + 1).padStart(3, "0");
    const outPath = path.join(outDir, `${num}${ext}`);
    console.error(`[${i + 1}/${blocks.length}] Converting block ${num}...`);
    await convertSingleDiagram(blocks[i], parseMermaidToExcalidraw, exportToSvg, opts, outPath);
  }
  console.error(`✓ ${blocks.length} diagram(s) written to ${outDir}/`);
}

// ── Main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // 如果没有指定字体，使用默认字体
  if (!opts.fontPath) {
    opts.fontPath = getDefaultFontPath();
  }

  if (opts.help) { printHelp(); return; }
  if (opts.showVersion) {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      console.log(`mer2excal v${pkg.version}`);
    } catch { console.log("mer2excal v1.0.0"); }
    return;
  }

  // 1. jsdom
  setupBrowserEnvironment();

  // 2. Dynamic import (after jsdom setup for browser API compatibility)
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const excalidrawUtils = await import("@excalidraw/utils") as any;
  const exportToSvg = excalidrawUtils.exportToSvg;

  // 3. Handle markdown input
  if (opts.inputFile && isMarkdownFile(opts.inputFile)) {
    await convertMarkdownFile(opts.inputFile, parseMermaidToExcalidraw, exportToSvg, opts);
    return;
  }

  // 4. Read single-diagram input
  const definition = await readInput(opts);
  if (!definition.trim()) { console.error("Error: Empty definition"); process.exit(1); }

  // 5. Convert & write
  const outPath = opts.outputFile || guessOutputPath(opts.inputFile, opts.format);
  await convertSingleDiagram(definition, parseMermaidToExcalidraw, exportToSvg, opts, outPath);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
