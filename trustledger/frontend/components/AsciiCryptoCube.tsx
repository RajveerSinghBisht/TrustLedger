"use client";

import React, { useEffect, useRef } from "react";

interface AsciiCryptoCubeProps {
  className?: string;
}

export function AsciiCryptoCube({ className = "w-full h-full" }: AsciiCryptoCubeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let isIntersecting = true;
    let angle = 0;

    const chars = "░▒▓█0123456789ABCDEF#$[]*·";

    const handleResize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Regular tetrahedron vertices in 3D
    const vertices = [
      { x: 0, y: 1, z: 0 },
      { x: -0.943, y: -0.333, z: -0.5 },
      { x: 0.943, y: -0.333, z: -0.5 },
      { x: 0, y: -0.333, z: 1 },
    ];

    const edges = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [2, 3],
      [3, 1],
    ];

    const faces = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 1],
      [1, 3, 2],
    ];

    const rotY = (p: { x: number; y: number; z: number }, t: number) => ({
      x: p.x * Math.cos(t) - p.z * Math.sin(t),
      y: p.y,
      z: p.x * Math.sin(t) + p.z * Math.cos(t),
    });

    const rotX = (p: { x: number; y: number; z: number }, t: number) => ({
      x: p.x,
      y: p.y * Math.cos(t) - p.z * Math.sin(t),
      z: p.y * Math.sin(t) + p.z * Math.cos(t),
    });

    const rotZ = (p: { x: number; y: number; z: number }, t: number) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
      z: p.z,
    });

    const render = () => {
      if (!isIntersecting || document.hidden) {
        animId = requestAnimationFrame(render);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      const centerX = w / 2;
      const centerY = h / 2;
      const scale = 0.65 * Math.min(w, h);

      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);

      const baseColor = isDark ? "250, 250, 249" : "20, 17, 15";

      const points: Array<{ x: number; y: number; z: number; char: string }> = [];

      // Edge points
      edges.forEach(([iA, iB]) => {
        const vA = vertices[iA];
        const vB = vertices[iB];
        for (let t = 0; t <= 1; t += 0.08) {
          let p = {
            x: vA.x + (vB.x - vA.x) * t,
            y: vA.y + (vB.y - vA.y) * t,
            z: vA.z + (vB.z - vA.z) * t,
          };
          p = rotZ(rotX(rotY(p, 0.4 * angle), 0.3 * angle), 0.2 * angle);
          const charIdx = Math.floor(((p.z + 1.5) / 3) * (chars.length - 1));
          points.push({
            x: centerX + p.x * scale,
            y: centerY - p.y * scale,
            z: p.z,
            char: chars[Math.min(charIdx, chars.length - 1)],
          });
        }
      });

      // Face points (sparse for high performance)
      faces.forEach(([iA, iB, iC]) => {
        const vA = vertices[iA];
        const vB = vertices[iB];
        const vC = vertices[iC];
        for (let u = 0; u <= 1; u += 0.2) {
          for (let v = 0; v <= 1 - u; v += 0.2) {
            const wCoord = 1 - u - v;
            let p = {
              x: vA.x * u + vB.x * v + vC.x * wCoord,
              y: vA.y * u + vB.y * v + vC.y * wCoord,
              z: vA.z * u + vB.z * v + vC.z * wCoord,
            };
            p = rotZ(rotX(rotY(p, 0.4 * angle), 0.3 * angle), 0.2 * angle);
            const charIdx = Math.floor(((p.z + 1.5) / 3) * (chars.length - 1));
            points.push({
              x: centerX + p.x * scale,
              y: centerY - p.y * scale,
              z: p.z,
              char: chars[Math.min(charIdx, chars.length - 1)],
            });
          }
        }
      });

      points.sort((a, b) => a.z - b.z);

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const alpha = Math.min(Math.max(0.15 + (pt.z + 1.5) * 0.25, 0.1), 0.9);
        ctx.fillStyle = `rgba(${baseColor}, ${alpha})`;
        ctx.fillText(pt.char, pt.x, pt.y);
      }

      if (!prefersReducedMotion) {
        angle += 0.012;
      }

      animId = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    animId = requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block" }}
      aria-hidden="true"
    />
  );
}
