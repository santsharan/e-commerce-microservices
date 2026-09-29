import type { ReactNode } from "react";
import { Input } from "@/components/atoms/input";

export function Field({
  label,
  name,
  type = "text",
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        name={name}
        type={type}
        required
        autoComplete={type === "password" ? "current-password" : "email"}
      />
      {hint === undefined ? null : <span className="block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-md space-y-4 rounded-lg border border-stone-200 bg-white p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}
