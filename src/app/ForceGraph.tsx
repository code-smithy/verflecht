"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "@/lib/graph";
import { connectedWithin } from "@/lib/network";

type Props = {
  graph: Graph;
  selected: string | null;
  focusDistance: number;
  onSelect: (id: string) => void;
};

type SimNode = Graph["nodes"][number] & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
};

type View = { x: number; y: number; scale: number };

const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function ForceGraph({ graph, selected, focusDistance, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const viewRef = useRef<View>({ x: 0, y: 0, scale: 1 });
  const selectedRef = useRef(selected);
  const focusedRef = useRef<Set<string> | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const [zoom, setZoom] = useState(100);

  const focused = useMemo(
    () => (selected ? connectedWithin(graph, selected, focusDistance) : null),
    [focusDistance, graph, selected],
  );

  useEffect(() => {
    selectedRef.current = selected;
    focusedRef.current = focused;
    drawRef.current();
  }, [focused, selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const degrees = new Map<string, number>();
    graph.edges.forEach((edge) => {
      degrees.set(edge.subject_id, (degrees.get(edge.subject_id) ?? 0) + 1);
      degrees.set(edge.object_id, (degrees.get(edge.object_id) ?? 0) + 1);
    });
    const nodes = graph.nodes.map((node) => {
      const seed = hash(node.id);
      const angle = ((seed % 3600) / 3600) * Math.PI * 2;
      const distance = 35 + ((seed >>> 12) % 280);
      const degree = degrees.get(node.id) ?? 0;
      return {
        ...node,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        degree,
        radius: clamp(4.5 + Math.sqrt(degree) * 0.72, 5, 12),
      };
    });
    nodesRef.current = nodes;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.edges
      .map((edge) => ({
        source: nodeById.get(edge.subject_id),
        target: nodeById.get(edge.object_id),
      }))
      .filter((link): link is { source: SimNode; target: SimNode } =>
        Boolean(link.source && link.target),
      );

    let width = 0;
    let height = 0;
    let frame = 0;
    let animation = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context || !width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const view = viewRef.current;
      context.save();
      context.translate(width / 2 + view.x, height / 2 + view.y);
      context.scale(view.scale, view.scale);

      const active = selectedRef.current;
      const focusedIds = focusedRef.current;
      context.lineWidth = 0.85 / view.scale;
      for (const link of links) {
        const directlyConnected =
          active && (link.source.id === active || link.target.id === active);
        const inFocus =
          !focusedIds || (focusedIds.has(link.source.id) && focusedIds.has(link.target.id));
        context.strokeStyle = directlyConnected
          ? "rgba(28, 106, 171, .9)"
          : focusedIds
            ? inFocus
              ? "rgba(86, 125, 157, .38)"
              : "rgba(145, 164, 180, .045)"
            : "rgba(123, 149, 170, .27)";
        context.lineWidth = (directlyConnected ? 2.2 : inFocus ? 0.95 : 0.7) / view.scale;
        context.beginPath();
        context.moveTo(link.source.x, link.source.y);
        context.lineTo(link.target.x, link.target.y);
        context.stroke();
      }

      const labelScale = clamp(1 / view.scale, 0.75, 1.4);
      for (const node of nodes) {
        const isSelected = node.id === active;
        const isFaded = Boolean(focusedIds && !focusedIds.has(node.id));
        context.globalAlpha = isFaded ? 0.13 : 1;
        context.beginPath();
        context.arc(node.x, node.y, node.radius + (isSelected ? 3 : 0), 0, Math.PI * 2);
        context.fillStyle = node.type === "PERSON" ? "#1769aa" : "#b55227";
        context.fill();
        context.lineWidth = (isSelected ? 3 : 1.7) / view.scale;
        context.strokeStyle = isSelected ? "#132433" : "#ffffff";
        context.stroke();
      }
      context.globalAlpha = 1;

      const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const labelNodes = [...nodes].sort(
        (a, b) =>
          Number(b.id === active || b.id === hoveredRef.current) -
            Number(a.id === active || a.id === hoveredRef.current) || b.degree - a.degree,
      );
      for (const node of labelNodes) {
        const isSelected = node.id === active;
        const isHovered = node.id === hoveredRef.current;
        const isFaded = Boolean(focusedIds && !focusedIds.has(node.id));
        if (isFaded && !isHovered) continue;
        context.globalAlpha = isFaded ? 0.35 : 1;
        const fontSize = 11 * labelScale;
        context.font = `${isSelected || isHovered ? 700 : 550} ${fontSize}px Arial, Helvetica, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.lineWidth = 3.8 / view.scale;
        context.strokeStyle = "rgba(255,255,255,.96)";
        context.fillStyle = "#17202a";
        const name = node.name.length > 27 ? `${node.name.slice(0, 26)}…` : node.name;
        const labelY = node.y + node.radius + 5 / view.scale;
        const halfWidth = context.measureText(name).width / 2 + 3 / view.scale;
        const box = {
          left: node.x - halfWidth,
          right: node.x + halfWidth,
          top: labelY - 1 / view.scale,
          bottom: labelY + fontSize + 3 / view.scale,
        };
        const collides = occupied.some(
          (placed) =>
            box.left < placed.right &&
            box.right > placed.left &&
            box.top < placed.bottom &&
            box.bottom > placed.top,
        );
        if (collides && !isSelected && !isHovered) continue;
        occupied.push(box);
        context.strokeText(name, node.x, labelY);
        context.fillText(name, node.x, labelY);
      }
      context.globalAlpha = 1;
      context.restore();
    };
    drawRef.current = draw;

    const resize = () => {
      const bounds = wrap.getBoundingClientRect();
      width = Math.max(320, bounds.width);
      height = Math.max(440, bounds.height);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const tick = () => {
      const heat = Math.max(0.08, 1 - frame / 360);
      const cells = new Map<string, SimNode[]>();
      const cellSize = 86;
      for (const node of nodes) {
        const key = `${Math.floor(node.x / cellSize)},${Math.floor(node.y / cellSize)}`;
        const bucket = cells.get(key) ?? [];
        bucket.push(node);
        cells.set(key, bucket);
      }
      for (const node of nodes) {
        const cx = Math.floor(node.x / cellSize);
        const cy = Math.floor(node.y / cellSize);
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            for (const other of cells.get(`${cx + ox},${cy + oy}`) ?? []) {
              if (other === node) continue;
              const dx = node.x - other.x;
              const dy = node.y - other.y;
              const distanceSquared = dx * dx + dy * dy + 1;
              if (distanceSquared > cellSize * cellSize) continue;
              const force = (48 * heat) / distanceSquared;
              node.vx += dx * force;
              node.vy += dy * force;
            }
          }
        }
        node.vx -= node.x * 0.00045 * heat;
        node.vy -= node.y * 0.00045 * heat;
      }
      for (const link of links) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = link.source.type === "PERSON" && link.target.type === "PERSON" ? 72 : 52;
        const force = (distance - target) * 0.0032 * heat;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        link.source.vx += fx;
        link.source.vy += fy;
        link.target.vx -= fx;
        link.target.vy -= fy;
      }
      for (const node of nodes) {
        node.vx *= 0.86;
        node.vy *= 0.86;
        node.x += node.vx;
        node.y += node.vy;
      }
      frame += 1;
      draw();
      if (!reducedMotion && frame < 520) animation = requestAnimationFrame(tick);
    };
    if (reducedMotion) {
      for (let i = 0; i < 90; i += 1) tick();
    } else {
      animation = requestAnimationFrame(tick);
    }

    let pointerId: number | null = null;
    let dragged: SimNode | null = null;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    const worldPoint = (clientX: number, clientY: number) => {
      const bounds = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return {
        x: (clientX - bounds.left - width / 2 - view.x) / view.scale,
        y: (clientY - bounds.top - height / 2 - view.y) / view.scale,
      };
    };
    const nodeAt = (clientX: number, clientY: number) => {
      const point = worldPoint(clientX, clientY);
      return [...nodes]
        .reverse()
        .find(
          (node) =>
            Math.hypot(node.x - point.x, node.y - point.y) <=
            node.radius + 8 / viewRef.current.scale,
        );
    };
    const pointerDown = (event: PointerEvent) => {
      pointerId = event.pointerId;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      dragged = nodeAt(event.clientX, event.clientY) ?? null;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-grabbing");
    };
    const pointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        const hovered = nodeAt(event.clientX, event.clientY) ?? null;
        hoveredRef.current = hovered?.id ?? null;
        canvas.classList.toggle("is-hovering-node", Boolean(hovered));
        draw();
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (dragged) {
        const point = worldPoint(event.clientX, event.clientY);
        dragged.x = point.x;
        dragged.y = point.y;
        dragged.vx = 0;
        dragged.vy = 0;
      } else {
        viewRef.current.x += dx;
        viewRef.current.y += dy;
      }
      lastX = event.clientX;
      lastY = event.clientY;
      draw();
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (dragged && !moved) onSelect(dragged.id);
      pointerId = null;
      dragged = null;
      canvas.classList.remove("is-grabbing");
    };
    const pointerLeave = () => {
      hoveredRef.current = null;
      canvas.classList.remove("is-hovering-node");
      draw();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const before = worldPoint(event.clientX, event.clientY);
      const view = viewRef.current;
      view.scale = clamp(view.scale * Math.exp(-event.deltaY * 0.001), 0.35, 3.5);
      const bounds = canvas.getBoundingClientRect();
      view.x = event.clientX - bounds.left - width / 2 - before.x * view.scale;
      view.y = event.clientY - bounds.top - height / 2 - before.y * view.scale;
      setZoom(Math.round(view.scale * 100));
      draw();
    };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [graph, onSelect]);

  const changeZoom = (factor: number) => {
    const view = viewRef.current;
    view.scale = clamp(view.scale * factor, 0.35, 3.5);
    setZoom(Math.round(view.scale * 100));
    drawRef.current();
  };
  const resetView = () => {
    viewRef.current = { x: 0, y: 0, scale: 1 };
    setZoom(100);
    drawRef.current();
  };

  return (
    <div className="force-graph" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Interactive network. Drag nodes to rearrange them, drag the background to pan, and scroll to zoom."
      />
      <div className="graph-controls" aria-label="Graph zoom controls">
        <button aria-label="Zoom out" onClick={() => changeZoom(0.8)}>
          −
        </button>
        <button onClick={resetView} aria-label="Reset graph view">
          {zoom}%
        </button>
        <button aria-label="Zoom in" onClick={() => changeZoom(1.25)}>
          +
        </button>
      </div>
      <p className="graph-hint">Drag nodes to explore · drag the canvas to pan · scroll to zoom</p>
    </div>
  );
}
