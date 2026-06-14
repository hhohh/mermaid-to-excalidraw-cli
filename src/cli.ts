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
import { JSDOM } from "jsdom";

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
  if (typeof globalThis.FontFace === "undefined") {
    globalThis.FontFace = class FontFace {
      family: string;
      source: string;
      descriptors: any;
      status: string = "loaded";
      loaded: Promise<any>;
      unicodeRange: string = "U+0-10FFFF";
      constructor(family: string, source: string, descriptors?: any) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
        if (descriptors?.unicodeRange) {
          this.unicodeRange = descriptors.unicodeRange;
        }
        this.loaded = Promise.resolve(this);
      }
      load(): Promise<FontFace> { return Promise.resolve(this); }
    } as any;
  }

  // document.fonts polyfill
  if (typeof document !== "undefined" && !(document as any).fonts) {
    (document as any).fonts = {
      add: () => {},
      check: () => true,
      load: () => Promise.resolve([]),
      ready: Promise.resolve([]),
      forEach: () => {},
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

type OutputFormat = "excalidraw" | "excalidraw-md" | "png";

type ExcalidrawFontFamily = number | string; // 1/2/3 or local font name

interface CliOptions {
  inputFile?: string;
  outputFile?: string;
  inline?: string;
  fontSize: number;
  fontFamily: ExcalidrawFontFamily;
  format: OutputFormat;
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

function layeredLayout(elements: any[], definition: string): void {
  const NODE_SPACING = 100;
  const LAYER_GAP = 100;
  const SUBGRAPH_PADDING = 30;

  const direction = parseMermaidDirection(definition);
  const isHorizontal = direction === "RIGHT" || direction === "LEFT";
  const isForward = direction === "RIGHT" || direction === "DOWN";

  const byId = new Map<string, any>();
  for (const el of elements) byId.set(el.id, el);

  // ── 0. Identify subgraph rectangles ──
  // Subgraph rectangles have groupIds containing "subgraph_group_<ID>"
  // and their id matches the <ID> part.
  const subgraphIds = new Set<string>();
  const subgraphChildren = new Map<string, string[]>();
  for (const el of elements) {
    if (el.type === "rectangle" && el.groupIds?.length > 0) {
      for (const gid of el.groupIds) {
        const m = gid.match(/^subgraph_group_(.+)$/);
        if (m && m[1] === el.id) {
          subgraphIds.add(el.id);
          break;
        }
      }
    }
  }
  // Build subgraph -> children mapping
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

  // ── 1. Collect nodes (containers) and edges (arrows) ──
  // Exclude subgraph rectangles from independent positioning
  const nodes = elements.filter(
    (el) => el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId) && !subgraphIds.has(el.id),
  );
  const edges = elements.filter(
    (el) => (el.type === "arrow" || el.type === "line") && el.start?.id && el.end?.id,
  );

  // ── 2. Build graph ──
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) { outEdges.set(n.id, []); inDegree.set(n.id, 0); }
  for (const e of edges) {
    if (!outEdges.has(e.start.id)) outEdges.set(e.start.id, []);
    outEdges.get(e.start.id)!.push(e.end.id);
    inDegree.set(e.end.id, (inDegree.get(e.end.id) ?? 0) + 1);
  }

  // ── 3. Assign layers (topological BFS from sources) ──
  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) { layerOf.set(id, 0); queue.push(id); }
  }
  if (queue.length === 0 && nodes.length > 0) {
    layerOf.set(nodes[0].id, 0); queue.push(nodes[0].id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const tid of outEdges.get(id) ?? []) {
      const nl = (layerOf.get(id) ?? 0) + 1;
      if (!layerOf.has(tid) || (layerOf.get(tid) ?? 0) < nl) {
        layerOf.set(tid, nl);
        if (!queue.includes(tid)) queue.push(tid);
      }
    }
  }
  for (const n of nodes) { if (!layerOf.has(n.id)) layerOf.set(n.id, 0); }

  const maxLayer = Math.max(...layerOf.values());
  const layers: any[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) layers[layerOf.get(n.id) ?? 0].push(n);

  // ── 4. Position nodes ──
  for (const layer of layers) layer.sort((a: any, b: any) => (a.y ?? 0) - (b.y ?? 0));

  let primaryPos = 0;

  for (const layer of layers) {
    const secDims = layer.map((n: any) => (isHorizontal ? n.height : n.width));
    const totalSec = secDims.reduce((s: number, d: number) => s + d, 0) + NODE_SPACING * (layer.length - 1);

    let secPos = -totalSec / 2;

    for (const node of layer) {
      const d = isHorizontal ? node.height : node.width;
      if (isHorizontal) {
        node.y = secPos;
      } else {
        node.x = secPos;
      }
      secPos += d + NODE_SPACING;
    }

    for (const node of layer) {
      if (isHorizontal) {
        node.x = primaryPos;
      } else {
        node.y = primaryPos;
      }
    }

    const maxPri = Math.max(...layer.map((n: any) => (isHorizontal ? n.width : n.height)), 0);
    primaryPos += maxPri + LAYER_GAP;
  }

  // ── 5. Shift entire diagram to start near (8, 8) ──
  let minX = Infinity, minY = Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  const offX = 8 - minX;
  const offY = 8 - minY;
  for (const n of nodes) { n.x += offX; n.y += offY; }

  // ── 5b. Position subgraph rectangles to wrap their children ──
  for (const sgId of subgraphIds) {
    const sgEl = byId.get(sgId);
    if (!sgEl) continue;
    const childIds = subgraphChildren.get(sgId) ?? [];
    if (childIds.length === 0) continue;

    let childMinX = Infinity, childMinY = Infinity;
    let childMaxX = -Infinity, childMaxY = -Infinity;
    for (const cid of childIds) {
      const child = byId.get(cid);
      if (!child) continue;
      childMinX = Math.min(childMinX, child.x);
      childMinY = Math.min(childMinY, child.y);
      childMaxX = Math.max(childMaxX, child.x + child.width);
      childMaxY = Math.max(childMaxY, child.y + child.height);
    }

    const LABEL_HEIGHT = 25;
    sgEl.x = childMinX - SUBGRAPH_PADDING;
    sgEl.y = childMinY - SUBGRAPH_PADDING - LABEL_HEIGHT;
    sgEl.width = (childMaxX - childMinX) + SUBGRAPH_PADDING * 2;
    sgEl.height = (childMaxY - childMinY) + SUBGRAPH_PADDING * 2 + LABEL_HEIGHT;
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
          // Subgraph labels: top-aligned; others: centered
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

  // ── 7. Normalise arrow endpoints (intersectElementWithLine) ──
  const GAP = 2;
  for (const arrow of edges) {
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
  for (const arrow of edges) {
    for (const endId of [arrow.start?.id, arrow.end?.id]) {
      if (!endId) continue;
      const el = byId.get(endId);
      if (el && !el.boundElements?.some((b: any) => b.id === arrow.id)) {
        el.boundElements.push({ type: "arrow", id: arrow.id });
      }
    }
  }
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
  -t, --format <type>        Output format: excalidraw (default) | excalidraw-md
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
      case "-t": case "--format": {
        const val = argv[++i];
        if (val === "md" || val === "excalidraw-md") opts.format = "excalidraw-md";
        else if (val === "excalidraw") opts.format = "excalidraw";
        else if (val === "png") opts.format = "png";
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
    const excalidrawData = buildExcalidrawJson(result.elements, result.files, opts.fontFamily, definition);
    const svgElement = await exportToSvg(excalidrawData);
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
    
    // 使用 @resvg/resvg-wasm 转换为 PNG
    const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
    // 初始化 WASM（从内置的 wasm 二进制加载）
    const wasmUrl = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
    const wasmResponse = await fetch(wasmUrl);
    const wasmBytes = await wasmResponse.arrayBuffer();
    await initWasm(wasmBytes);
    
    const resvg = new Resvg(svgString, {
      fitTo: { mode: "original" },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    
    if (outPath) {
      fs.writeFileSync(outPath, pngBuffer);
      console.error(`✓ Written to ${outPath}`);
    } else {
      process.stdout.write(pngBuffer);
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

  const ext = opts.format === "png" ? ".png" : ".excalidraw";
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
