"use client";

import React, { ReactNode, useEffect, useState } from "react";

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`relative rounded-lg border border-(--border) bg-(--surface) p-6 transition-all duration-200 ${
        interactive
          ? "hover:border-(--accent)/60 hover:shadow-lg hover:shadow-(--accent)/5 hover:-translate-y-0.5 cursor-pointer"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  tag,
}: {
  title: string;
  description?: string;
  tag?: string;
}) {
  return (
    <div className="mb-6">
      {tag && (
        <span className="sys-tag mb-2 inline-flex text-[9px]">
          <span className="w-1 h-1 rounded-full bg-(--accent)" />
          {tag}
        </span>
      )}
      <h1 className="text-xl font-bold tracking-tight text-(--text-primary)">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm text-(--text-muted) max-w-2xl leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-mono font-medium uppercase tracking-wider text-(--text-muted) mb-1.5">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-(--text-faint) mt-1 leading-normal">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`input-base ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`input-base ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`input-base font-mono ${props.className ?? ""}`}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const styles = {
    primary:
      "bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-semibold shadow-sm hover:shadow-md hover:shadow-(--accent)/20",
    secondary:
      "border border-(--border) text-(--text-primary) hover:bg-(--surface-hover) hover:border-(--border-hover)",
    danger:
      "bg-(--danger) hover:opacity-90 text-white font-semibold shadow-sm hover:shadow-md hover:shadow-(--danger)/20",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-xs font-mono uppercase tracking-wider transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function JsonView({ data }: { data: unknown }) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between border-t border-x border-(--border) bg-(--bg) px-3 py-1.5 rounded-t text-[10px] font-mono text-(--text-faint)">
        <span>TELEMETRY_PAYLOAD.JSON</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-(--success)" />
          FORMATTED
        </span>
      </div>
      <pre className="scroll-thin max-h-96 overflow-y-auto overflow-x-auto rounded-b bg-(--surface) border border-(--border) p-3.5 text-xs text-(--success) font-mono whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-(--surface) to-transparent rounded-b"
        aria-hidden="true"
      />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded border border-(--danger-border) bg-(--danger-bg) px-3.5 py-2.5 text-xs font-mono text-(--danger) flex items-start gap-2">
      <span className="font-bold shrink-0">[ERR]</span>
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-(--success-border) bg-(--success-bg) px-3.5 py-2.5 text-xs font-mono text-(--success) flex items-start gap-2">
      <span className="font-bold shrink-0">[CONFIRMED]</span>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "red" | "blue";
}) {
  const styles = {
    neutral: "bg-(--surface-hover) text-(--text-primary) border border-(--border)",
    green: "bg-(--success-bg) text-(--success) border border-(--success-border)",
    red: "bg-(--danger-bg) text-(--danger) border border-(--danger-border)",
    blue: "bg-(--accent)/15 text-(--accent) border border-(--accent)/30",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono tracking-wider uppercase font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-current/30 border-t-current animate-spin ${className}`}
      aria-hidden="true"
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center border border-dashed border-(--border) rounded-lg bg-(--surface)/30 ${className}`}
    >
      {icon && <div className="mb-3 text-(--text-muted)">{icon}</div>}
      <p className="text-xs font-mono uppercase tracking-wider text-(--text-primary)">
        {title}
      </p>
      {description && (
        <p className="text-xs text-(--text-muted) mt-1 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

export function FadeIn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`transition-all duration-200 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      } ${className}`}
    >
      {children}
    </div>
  );
}
