"use client";

import type { ReactNode } from "react";

/** Scroll container that keeps the header pinned. */
export function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-auto ${className}`}>{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  // `w-max min-w-full` lets a wide grid scroll inside TableWrap instead of
  // squeezing every column until the values wrap onto three lines.
  return <table className="w-max min-w-full border-collapse text-2xs">{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-chrome">
      <tr className="border-b border-line-strong">{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = "left",
  width,
  className = "",
  onClick,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      style={width ? { width } : undefined}
      onClick={onClick}
      className={`label whitespace-nowrap px-2 py-1.5 font-medium ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${onClick ? "cursor-pointer select-none hover:text-ink-dim" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

export function TR({
  children,
  onClick,
  selected = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line-soft ${onClick ? "cursor-pointer" : ""} ${
        selected ? "bg-accent-wash" : "row-hover"
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  mono = false,
  className = "",
  colSpan,
  title,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={`whitespace-nowrap px-2 py-1.5 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${mono ? "font-mono tabular" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
