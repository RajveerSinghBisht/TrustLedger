"use client";

import React, { useEffect, useRef } from "react";

interface AsciiSphereProps {
  className?: string;
}

export function AsciiSphere({ className = "w-full h-full" }: AsciiSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let isIntersecting = true;
    let angle = 0;

    // Cryptographic and block ASCII character set
    const chars = "░▒▓█0123456789ABCDEF#$[]*·";

    // Handle high-DPI crispness with max 2x clamp for smooth 60fps performance
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

    // Render loop
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
      const radius = 0.52 * Math.min(w, h);

      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Read current text color to match light/dark theme dynamically
      const isDark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);

      const baseColor = isDark ? "250, 250, 249" : "8, 5, 3";

      const points: Array<{ x: number; y: number; z: number; char: string }> = [];

      // Step increments optimized for 60fps lightweight calculation (< 0.15ms)
      const stepPhi = 0.22;
      const stepTheta = 0.22;

      for (let p = 0; p < 2 * Math.PI; p += stepPhi) {
        for (let t = 0; t < Math.PI; t += stepTheta) {
          const rx = Math.sin(t) * Math.cos(p + 0.5 * angle);
          const ry = Math.sin(t) * Math.sin(p + 0.5 * angle);
          const rz = Math.cos(t);

          // 3D Euler rotation matrix
          const u = 0.3 * angle;
          const mx = rx * Math.cos(u) - rz * Math.sin(u);
          const my = rx * Math.sin(u) + rz * Math.cos(u);

          const v = 0.2 * angle;
          const nx = ry * Math.cos(v) - my * Math.sin(v);
          const ny = ry * Math.sin(v) + my * Math.cos(v);

          const charIdx = Math.floor(((ny + 1) / 2) * (chars.length - 1));
          points.push({
            x: centerX + mx * radius,
            y: centerY + nx * radius,
            z: ny,
            char: chars[Math.max(0, Math.min(chars.length - 1, charIdx))],
          });
        }
      }

      // Painter's algorithm depth sort
      points.sort((a, b) => a.z - b.z);

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const alpha = Math.min(Math.max(0.15 + (pt.z + 1) * 0.4, 0.1), 0.95);
        ctx.fillStyle = `rgba(${baseColor}, ${alpha})`;
        ctx.fillText(pt.char, pt.x, pt.y);
      }

      if (!prefersReducedMotion) {
        angle += 0.015;
      }

      animId = requestAnimationFrame(render);
    };

    // IntersectionObserver to pause rendering when off-screen
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
