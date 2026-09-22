"use client";

import React, { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let isVisible = true;
    let isIntersecting = true;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];

    // Extract colors from computed CSS variables
    let accentColor = "#0ea5e9";
    let borderColor = "#1f242c";

    function updateColors() {
      const styles = getComputedStyle(document.documentElement);
      accentColor = styles.getPropertyValue("--accent").trim() || "#0ea5e9";
      borderColor = styles.getPropertyValue("--border").trim() || "#1f242c";
    }

    function parseRgb(color: string): [number, number, number] {
      if (color.startsWith("#")) {
        let hex = color.slice(1);
        if (hex.length === 3) {
          hex = hex.split("").map((c) => c + c).join("");
        }
        const num = parseInt(hex, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
      }
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
      }
      return [14, 165, 233];
    }

    function initNodes() {
      const isMobile = width < 640;
      const count = isMobile ? 32 : 55;
      nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          radius: Math.random() * 1.5 + 1.2,
        });
      }
    }

    function resize() {
      if (!canvas) return;
      const parent = canvas.parentElement;
      width = parent ? parent.clientWidth : window.innerWidth;
      height = parent ? parent.clientHeight : 500;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx!.scale(dpr, dpr);
      updateColors();
      initNodes();
      if (prefersReducedMotion) {
        drawScene();
      }
    }

    function drawScene() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const [rA, gA, bA] = parseRgb(accentColor);
      const [rB, gB, bB] = parseRgb(borderColor);

      // Draw subtle tactical crosshairs (+) at grid points
      const gridSize = 120;
      ctx.strokeStyle = `rgba(${rB}, ${gB}, ${bB}, 0.2)`;
      ctx.lineWidth = 1;
      for (let x = gridSize; x < width; x += gridSize) {
        for (let y = gridSize; y < height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x - 4, y);
          ctx.lineTo(x + 4, y);
          ctx.moveTo(x, y - 4);
          ctx.lineTo(x, y + 4);
          ctx.stroke();
        }
      }

      const maxDistance = width < 640 ? 90 : 130;

      // Draw connecting lines between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.hypot(dx, dy);

          if (dist < maxDistance) {
            const alpha = (1 - dist / maxDistance) * 0.35;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(${rA}, ${gA}, ${bA}, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw nodes with technical radar rings
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rA}, ${gA}, ${bA}, 0.8)`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rA}, ${gA}, ${bA}, 0.25)`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    function animate() {
      if (!isVisible || !isIntersecting) return;

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0) {
          node.x = 0;
          node.vx *= -1;
        } else if (node.x > width) {
          node.x = width;
          node.vx *= -1;
        }

        if (node.y < 0) {
          node.y = 0;
          node.vy *= -1;
        } else if (node.y > height) {
          node.y = height;
          node.vy *= -1;
        }
      }

      drawScene();
      animationFrameId = requestAnimationFrame(animate);
    }

    const themeObserver = new MutationObserver(() => {
      updateColors();
      if (prefersReducedMotion) {
        drawScene();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && isIntersecting && !prefersReducedMotion) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry.isIntersecting;
        if (isIntersecting && isVisible && !prefersReducedMotion) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = requestAnimationFrame(animate);
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    window.addEventListener("resize", resize);
    resize();

    if (!prefersReducedMotion) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      drawScene();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Blueprint grid overlay */}
      <div className="absolute inset-0 grid-blueprint opacity-20" />
      {/* Radial spotlight effect */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 50% at 50% 30%, rgba(14, 165, 233, 0.08) 0%, transparent 70%)",
        }}
      />
      {/* Smooth bottom fade out */}
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-(--bg)" />
    </div>
  );
}
