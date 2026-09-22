"use client";

import React, { useEffect, useRef } from "react";

interface AsciiWaveFieldProps {
  className?: string;
}

export function AsciiWaveField({ className = "w-full h-full" }: AsciiWaveFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let isIntersecting = true;
    let time = 0;

    const glyphs = "·∘○◯◌●◉";

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
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);

      const baseColor = isDark ? "250, 250, 249" : "8, 5, 3";

      // Grid spacing for wave simulation
      const cell = 24;
      const cols = Math.floor(w / cell);
      const rows = Math.floor(h / cell);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.5) * cell;
          const y = (r + 0.5) * cell;

          const wave =
            (Math.sin(0.2 * c + 2 * time) * Math.cos(0.15 * r + time) +
              Math.sin((c + r) * 0.1 + 1.5 * time) +
              Math.cos(0.1 * c - 0.1 * r + 0.8 * time)) /
            3;

          const norm = (wave + 1) / 2; // [0, 1]
          const glyphIdx = Math.floor(norm * (glyphs.length - 1));
          const alpha = 0.12 + 0.45 * norm;

          ctx.fillStyle = `rgba(${baseColor}, ${alpha})`;
          ctx.fillText(glyphs[Math.min(glyphIdx, glyphs.length - 1)], x, y);
        }
      }

      if (!prefersReducedMotion) {
        time += 0.02;
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
